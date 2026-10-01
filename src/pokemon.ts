export type SpeedAbility = {
  slug: string;
  name: string;
  factor: number;
  condition: string;
  hidden: boolean;
};

export type MegaForm = {
  id: number;
  slug: string;
  name: string;
  baseSpeed: number;
  sprite: string;
  speedAbilities: SpeedAbility[];
};

export type Pokemon = {
  id: number;
  slug: string;
  koreanName: string;
  englishName: string;
  baseSpeed: number;
  sprite: string;
  speedAbilities: SpeedAbility[];
  megaForms: MegaForm[];
};

export type PokemonData = {
  meta: {
    generatedAt: string;
    source: string;
    sourceUrl: string;
    count: number;
    megaFormCount: number;
    speedAbilityPokemonCount: number;
  };
  rankings: {
    double: {
      source: string;
      sourceUrl: string;
      season: string;
      updated: string | null;
      regulation: string | null;
      rows: Array<{ rank: number; pokemon: Pokemon }>;
    };
  };
  pokemon: Pokemon[];
};

export const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[.'’\s_-]/g, '');

export function buildIndex(pokemon: Pokemon[]) {
  const index = new Map<string, Pokemon>();
  pokemon.forEach((item) => {
    [item.koreanName, item.englishName, item.slug, String(item.id)].forEach((key) => index.set(normalize(key), item));
  });
  return index;
}

export function findMatches(pokemon: Pokemon[], index: Map<string, Pokemon>, query: string, limit = 6) {
  const needle = normalize(query);
  if (!needle) return [];
  const exact = index.get(needle);
  const matches = pokemon.filter((pokemon) =>
    [pokemon.koreanName, pokemon.englishName, pokemon.slug, String(pokemon.id)]
      .some((value) => normalize(value).includes(needle)),
  );
  return exact ? [exact, ...matches.filter((item) => item.id !== exact.id)].slice(0, limit) : matches.slice(0, limit);
}

export async function loadPokemonData() {
  const response = await fetch('/data/pokemon.json');
  if (!response.ok) throw new Error('데이터 파일을 불러오지 못했습니다.');
  const data = await response.json() as PokemonData;
  const rankingForms = data.rankings.double.rows.map((row) => row.pokemon);
  const pokemon = [...new Map([...data.pokemon, ...rankingForms].map((pokemon) => [pokemon.id, pokemon])).values()];
  return { data, pokemon, index: buildIndex(pokemon) };
}
