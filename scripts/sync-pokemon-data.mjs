import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const FILES = [
  'pokemon.csv',
  'pokemon_stats.csv',
  'pokemon_species_names.csv',
  'pokemon_forms.csv',
  'pokemon_abilities.csv',
  'abilities.csv',
  'ability_names.csv',
];
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

const [pokemonRows, statRows, nameRows, formRows, pokemonAbilityRows, abilityRows, abilityNameRows, usageData] = await Promise.all([
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

const speedAbilityRules = {
  'speed-boost': { factor: 1.5, condition: '턴 종료 후 +1 (1턴 기준)' },
  'swift-swim': { factor: 2, condition: '비가 내릴 때' },
  chlorophyll: { factor: 2, condition: '햇살이 강할 때' },
  'motor-drive': { factor: 1.5, condition: '전기 기술을 받으면 +1' },
  unburden: { factor: 2, condition: '지닌 도구를 소모하면' },
  'quick-feet': { factor: 1.5, condition: '상태 이상일 때' },
  'slow-start': { factor: 0.5, condition: '등장 후 5턴 동안' },
  'weak-armor': { factor: 2, condition: '물리 기술을 받으면 +2' },
  'sand-rush': { factor: 2, condition: '모래바람일 때' },
  rattled: { factor: 1.5, condition: '특정 공격을 받으면 +1' },
  'slush-rush': { factor: 2, condition: '설경일 때' },
  'surge-surfer': { factor: 2, condition: '일렉트릭필드일 때' },
  'steam-engine': { factor: 4, condition: '불꽃·물 기술을 받으면 +6' },
  protosynthesis: { factor: 1.5, condition: '스피드가 가장 높고 고대활성 발동 시' },
  'quark-drive': { factor: 1.5, condition: '스피드가 가장 높고 쿼크차지 발동 시' },
  'anger-shell': { factor: 1.5, condition: 'HP가 절반 이하가 되면 +1' },
};

const abilitySlugById = new Map(abilityRows.map((row) => [Number(row.id), row.identifier]));
const koreanAbilityById = new Map(
  abilityNameRows.filter((row) => row.local_language_id === '3').map((row) => [Number(row.ability_id), row.name]),
);
const pokemonAbilitiesById = new Map();
for (const row of pokemonAbilityRows) {
  const pokemonId = Number(row.pokemon_id);
  const abilityId = Number(row.ability_id);
  const slug = abilitySlugById.get(abilityId);
  const rule = speedAbilityRules[slug];
  if (!rule) continue;
  const abilities = pokemonAbilitiesById.get(pokemonId) ?? [];
  abilities.push({
    slug,
    name: koreanAbilityById.get(abilityId) ?? slug,
    factor: rule.factor,
    condition: rule.condition,
    hidden: row.is_hidden === '1',
  });
  pokemonAbilitiesById.set(pokemonId, abilities);
}

const megaFormsBySpecies = new Map();
for (const form of formRows.filter((row) => row.is_mega === '1')) {
  const megaRow = pokemonRows.find((row) => row.id === form.pokemon_id);
  if (!megaRow) continue;
  const id = Number(megaRow.id);
  const speciesId = Number(megaRow.species_id);
  const megaSuffix = megaRow.identifier.split('-mega')[1]?.replace(/^-/, '').toUpperCase();
  const megaForms = megaFormsBySpecies.get(speciesId) ?? [];
  megaForms.push({
    id,
    slug: megaRow.identifier,
    name: `메가${megaSuffix ? ` ${megaSuffix}` : ''}`,
    baseSpeed: speedByPokemon.get(id),
    sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
    speedAbilities: pokemonAbilitiesById.get(id) ?? [],
  });
  megaFormsBySpecies.set(speciesId, megaForms);
}

function createPokemon(row, koreanName, englishName) {
  const id = Number(row.id);
  const speciesId = Number(row.species_id);
  return {
    id,
    slug: row.identifier,
    koreanName,
    englishName,
    baseSpeed: speedByPokemon.get(id),
    sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
    speedAbilities: pokemonAbilitiesById.get(id) ?? [],
    megaForms: row.is_default === '1' ? (megaFormsBySpecies.get(speciesId) ?? []) : [],
  };
}

const pokemon = defaultPokemon
  .map((row) => {
    const speciesId = Number(row.species_id);
    if (!speedByPokemon.get(Number(row.id))) return null;
    return createPokemon(
      row,
      koreanBySpecies.get(speciesId) ?? englishBySpecies.get(speciesId) ?? row.identifier,
      englishBySpecies.get(speciesId) ?? row.identifier,
    );
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

  return createPokemon(
    pokemonRow,
    formName ? `${koreanBase} (${formName})` : koreanBase,
    formName ? `${englishBase} (${suffix})` : englishBase,
  );
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
    megaFormCount: [...megaFormsBySpecies.values()].flat().length,
    speedAbilityPokemonCount: pokemon.filter((item) => item.speedAbilities.length > 0).length,
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
