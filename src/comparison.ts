import { calculateRange, calculateSpeed } from './calculator';
import type { Pokemon, SpeedAbility } from './pokemon';

type SpeedRange = ReturnType<typeof calculateRange>;
type VariantTrack = {
  kind: 'ability';
  label: string;
  detail: string;
  range: SpeedRange;
  sprite?: string;
};

type DisplayChip = {
  key: string;
  name: string;
  sprite: string;
  mega: boolean;
  pokemonId?: number;
  pickRank?: number;
  abilityNames: string[];
  megaCount?: number;
};

export type FocusEntry = {
  key: string;
  name: string;
  sprite: string;
  baseSpeed: number;
  mega: boolean;
};

type ChartRow = {
  key: string;
  baseSpeed: number;
  chips: DisplayChip[];
  range: SpeedRange;
  tracks: VariantTrack[];
  mega: boolean;
};

function boostedRange(range: SpeedRange, factor: number): SpeedRange {
  return {
    min: Math.floor(range.min * factor),
    neutralMin: Math.floor(range.neutralMin * factor),
    neutralMax: Math.floor(range.neutralMax * factor),
    max: Math.floor(range.max * factor),
  };
}

function abilityTracks(name: string, baseSpeed: number, abilities: SpeedAbility[], level: number, sprite?: string): VariantTrack[] {
  const baseRange = calculateRange(baseSpeed, level);
  return abilities.map((ability) => ({
    kind: 'ability' as const,
    label: `${name} · ${ability.name}${ability.hidden ? ' (숨겨진 특성)' : ''}`,
    detail: `${ability.condition} · ×${ability.factor}`,
    range: boostedRange(baseRange, ability.factor),
    sprite,
  }));
}

export function buildChartRows(selected: Pokemon[], level: number, activePreset: number | null, pickRankById: Map<number, number>): ChartRow[] {
  const pokemonBySpeed = new Map<number, Pokemon[]>();
  selected.forEach((pokemon) => {
    const group = pokemonBySpeed.get(pokemon.baseSpeed) ?? [];
    group.push(pokemon);
    pokemonBySpeed.set(pokemon.baseSpeed, group);
  });
  const baseRows: ChartRow[] = [...pokemonBySpeed.entries()]
    .map(([baseSpeed, pokemon]) => ({
      key: `base-${baseSpeed}`,
      baseSpeed,
      chips: pokemon.map((item) => ({
        key: `pokemon-${item.id}`,
        name: item.koreanName,
        sprite: item.sprite,
        mega: false,
        pokemonId: item.id,
        pickRank: activePreset && (pickRankById.get(item.id) ?? Infinity) <= activePreset
          ? pickRankById.get(item.id)
          : undefined,
        abilityNames: item.speedAbilities.map((ability) => ability.name),
        megaCount: item.megaForms.length,
      })),
      range: calculateRange(baseSpeed, level),
      tracks: pokemon.flatMap((item) => abilityTracks(item.koreanName, item.baseSpeed, item.speedAbilities, level)),
      mega: false,
    }));
  const megaRows: ChartRow[] = selected.flatMap((pokemon) => pokemon.megaForms.map((mega) => ({
    key: `mega-${mega.id}`,
    baseSpeed: mega.baseSpeed,
    chips: [{
      key: `mega-chip-${mega.id}`,
      name: `${pokemon.koreanName} · ${mega.name}`,
      sprite: mega.sprite,
      mega: true,
      abilityNames: mega.speedAbilities.map((ability) => ability.name),
    }],
    range: calculateRange(mega.baseSpeed, level),
    tracks: abilityTracks(`${pokemon.koreanName} · ${mega.name}`, mega.baseSpeed, mega.speedAbilities, level, mega.sprite),
    mega: true,
  })));
  const rowsBySpeed = new Map<number, ChartRow>();
  [...baseRows, ...megaRows].forEach((row) => {
    const existing = rowsBySpeed.get(row.baseSpeed);
    if (!existing) {
      rowsBySpeed.set(row.baseSpeed, row);
      return;
    }
    existing.key = `speed-${row.baseSpeed}`;
    existing.chips.push(...row.chips);
    existing.tracks.push(...row.tracks);
    existing.mega = existing.mega && row.mega;
  });
  return [...rowsBySpeed.values()]
    .sort((a, b) => b.baseSpeed - a.baseSpeed || Number(a.mega) - Number(b.mega));
}

function opponentSpeed(entry: FocusEntry, level: number, trickRoom: boolean) {
  return trickRoom
    ? calculateSpeed(entry.baseSpeed, level, 31, 0, 0.9)
    : calculateSpeed(entry.baseSpeed, level, 31, 32 * 8, 1.1);
}

export function findSpeedNeighbours(entries: FocusEntry[], focusedKey: string, targetSpeed: number, level: number, trickRoom: boolean) {
  const opponents = entries
    .filter((entry) => entry.key !== focusedKey)
    .map((entry) => ({ entry, speed: opponentSpeed(entry, level, trickRoom) }));
  const overtakenAll = opponents
    .filter((item) => trickRoom ? item.speed > targetSpeed : item.speed < targetSpeed)
    .sort((a, b) => trickRoom ? a.speed - b.speed : b.speed - a.speed);
  const tiedAll = opponents.filter((item) => item.speed === targetSpeed);
  const aheadAll = opponents
    .filter((item) => trickRoom ? item.speed < targetSpeed : item.speed > targetSpeed)
    .sort((a, b) => trickRoom ? b.speed - a.speed : a.speed - b.speed);
  const overtaken = overtakenAll.slice(0, 5);
  const ahead = aheadAll.slice(0, 5);
  return { overtaken, tied: tiedAll, ahead };
}
