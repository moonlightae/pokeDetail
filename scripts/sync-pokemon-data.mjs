import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const FILES = ['pokemon.csv', 'pokemon_stats.csv', 'pokemon_species_names.csv'];
const DOUBLE_USAGE_URL = 'https://pokemon.yodams.com/api/usage-battle-unified.php';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...data] = rows;
  return data.map((columns) => Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ''])));
}

async function fetchCsv(filename) {
  const response = await fetch(`${BASE}/${filename}`);
  if (!response.ok) throw new Error(`${filename} 다운로드 실패 (${response.status})`);
  return parseCsv(await response.text());
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`JSON 다운로드 실패 (${response.status}): ${url}`);
  return response.json();
}

const [pokemonRows, statRows, nameRows, usageData] = await Promise.all([
  ...FILES.map(fetchCsv),
  fetchJson(DOUBLE_USAGE_URL),
]);
const defaultPokemon = pokemonRows.filter((row) => row.is_default === '1');
const pokemonRowBySlug = new Map(pokemonRows.map((row) => [row.identifier, row]));
const defaultRowBySpecies = new Map(defaultPokemon.map((row) => [Number(row.species_id), row]));
const speedByPokemon = new Map(
  statRows.filter((row) => row.stat_id === '6').map((row) => [Number(row.pokemon_id), Number(row.base_stat)]),
);

const koreanBySpecies = new Map(
  nameRows.filter((row) => row.local_language_id === '3').map((row) => [Number(row.pokemon_species_id), row.name]),
);
const englishBySpecies = new Map(
  nameRows.filter((row) => row.local_language_id === '9').map((row) => [Number(row.pokemon_species_id), row.name]),
);

const pokemon = defaultPokemon
  .map((row) => {
    const id = Number(row.id);
    const speciesId = Number(row.species_id);
    const baseSpeed = speedByPokemon.get(id);
    if (!baseSpeed) return null;
    return {
      id,
      slug: row.identifier,
      koreanName: koreanBySpecies.get(speciesId) ?? englishBySpecies.get(speciesId) ?? row.identifier,
      englishName: englishBySpecies.get(speciesId) ?? row.identifier,
      baseSpeed,
      sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.id - b.id);

const currentSeason = usageData.seasons?.[usageData.defaultSeason] ?? usageData;
const doubleUsage = currentSeason.double ?? usageData.double;
const formLabels = {
  alola: '알로라', galar: '가라르', hisui: '히스이', paldea: '팔데아',
  male: '수컷', female: '암컷', wash: '워시폼', heat: '히트폼', frost: '프로스트폼',
  fan: '스핀폼', mow: '커트폼', dusk: '황혼의 모습', midnight: '한밤중의 모습',
  eternal: '영원의 꽃', school: '군집의 모습', zen: '달마모드',
};

function resolveRankingPokemon(row) {
  const speciesId = Math.floor(Number(row.pokemonId) / 1000);
  const pokemonRow = pokemonRowBySlug.get(row.slug)
    ?? pokemonRowBySlug.get(`${row.slug}-male`)
    ?? defaultRowBySpecies.get(speciesId);
  if (!pokemonRow) return null;

  const id = Number(pokemonRow.id);
  const resolvedSpeciesId = Number(pokemonRow.species_id);
  const defaultSlug = defaultRowBySpecies.get(resolvedSpeciesId)?.identifier ?? '';
  const lastSlugPart = pokemonRow.identifier.split('-').at(-1) ?? '';
  const suffix = pokemonRow.identifier.startsWith(`${defaultSlug}-`)
    ? pokemonRow.identifier.slice(defaultSlug.length + 1)
    : (formLabels[lastSlugPart] ? lastSlugPart : '');
  const formName = suffix.split('-').map((part) => formLabels[part] ?? part).join(' ');
  const koreanBase = koreanBySpecies.get(resolvedSpeciesId) ?? englishBySpecies.get(resolvedSpeciesId) ?? pokemonRow.identifier;
  const englishBase = englishBySpecies.get(resolvedSpeciesId) ?? pokemonRow.identifier;

  return {
    id,
    slug: pokemonRow.identifier,
    koreanName: formName ? `${koreanBase} (${formName})` : koreanBase,
    englishName: formName ? `${englishBase} (${suffix})` : englishBase,
    baseSpeed: speedByPokemon.get(id),
    sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
  };
}

const doubleRanking = (doubleUsage?.rows ?? [])
  .map((row) => ({ rank: Number(row.rank), pokemon: resolveRankingPokemon(row) }))
  .filter((row) => row.pokemon?.baseSpeed)
  .sort((a, b) => a.rank - b.rank)
  .slice(0, 100);

const output = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'PokeAPI/pokeapi CSV snapshot',
    sourceUrl: 'https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv',
    count: pokemon.length,
  },
  rankings: {
    double: {
      source: '포케챔스',
      sourceUrl: 'https://pokemon.yodams.com/stats/double',
      season: usageData.defaultSeason,
      updated: doubleUsage?.meta?.updated ?? doubleUsage?.meta?.date ?? null,
      regulation: doubleUsage?.meta?.regulation ?? null,
      rows: doubleRanking,
    },
  },
  pokemon,
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(projectRoot, 'public/data/pokemon.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`, 'utf8');
console.log(`${pokemon.length}마리의 로컬 포켓몬 인덱스를 생성했습니다: ${outputPath}`);
