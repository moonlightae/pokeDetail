import './styles.css';
import { calculateRange } from './calculator';

type SpeedAbility = {
  slug: string;
  name: string;
  factor: number;
  condition: string;
  hidden: boolean;
};

type MegaForm = {
  id: number;
  slug: string;
  name: string;
  baseSpeed: number;
  sprite: string;
  speedAbilities: SpeedAbility[];
};

type Pokemon = {
  id: number;
  slug: string;
  koreanName: string;
  englishName: string;
  baseSpeed: number;
  sprite: string;
  speedAbilities: SpeedAbility[];
  megaForms: MegaForm[];
};

type PokemonData = {
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

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};

declare global {
  interface Document {
    readonly modelContext?: {
      registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): void | Promise<void>;
    };
  }
}

const COLORS = ['#3568f0', '#f05454', '#20a86b', '#8e5ad7', '#eb8a21', '#0f8ea8'];
const INITIAL_IDS = [25, 445, 149, 887];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('앱 컨테이너를 찾지 못했습니다.');

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Speed Dex 홈">
        <span class="brand-mark" aria-hidden="true"><i></i></span>
        <span>SPEED<span>/DEX</span></span>
      </a>
      <div class="level-control" aria-label="포켓몬 레벨">
        <span>LEVEL</span>
        <button class="level-button active" type="button" data-level="50">50</button>
        <button class="level-button" type="button" data-level="100">100</button>
      </div>
    </header>

    <main>
      <section class="intro" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">SPEED RANGE COMPARATOR</p>
          <h1 id="page-title">누가 먼저 움직일까?</h1>
          <p class="lede">포켓몬을 추가하면 최저속부터 최속까지, 같은 눈금 위에서 바로 비교해 드려요.</p>
        </div>

        <form class="search" id="search-form" autocomplete="off">
          <div class="search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>
            <input id="pokemon-input" name="pokemon" type="search" placeholder="포켓몬 이름을 입력하세요" aria-label="포켓몬 이름" aria-controls="suggestions" aria-expanded="false" />
            <button type="submit">추가</button>
          </div>
          <div class="suggestions" id="suggestions" role="listbox" hidden></div>
          <p class="search-message" id="search-message" aria-live="polite">한국어·영어 이름 또는 도감 번호로 찾을 수 있어요.</p>
        </form>
        <div class="ranking-presets" aria-label="더블배틀 픽률 프리셋">
          <div class="preset-label"><span>DOUBLE PICK</span><b>픽률 순위 한 번에 보기</b></div>
          <div class="preset-buttons">
            <button type="button" data-top="20">TOP 20</button>
            <button type="button" data-top="50">TOP 50</button>
            <button type="button" data-top="100">TOP 100</button>
          </div>
          <span class="ranking-stamp" id="ranking-stamp">포케챔스 순위 준비 중</span>
        </div>
      </section>

      <section class="comparison" aria-labelledby="comparison-title">
        <div class="comparison-head">
          <div>
            <p class="section-kicker">CURRENT LINE-UP</p>
            <h2 id="comparison-title">스피드 범위</h2>
          </div>
          <div class="legend" aria-label="범위 기준">
            <span><i class="min-dot"></i>최저: 개체값 31 · 노력치 0 · 하락 성격</span>
            <span><i class="max-dot"></i>최속: 개체값 31 · 노력치 252 · 상승 성격</span>
            <span><i class="mega-dot"></i>메가진화</span>
            <span><i class="ability-dot"></i>특성 발동</span>
          </div>
        </div>

        <div class="chart-scroll">
          <div class="chart" id="chart" aria-live="polite">
            <div class="loading-state"><span class="loader"></span>포켓몬 도감을 불러오는 중...</div>
          </div>
        </div>

        <div class="formula-strip">
          <span class="formula-label">CALCULATION</span>
          <code>IV 31 고정 · ⌊(⌊(종족값×2 + 31 + ⌊EV/4⌋) × 레벨/100⌋ + 5) × 성격⌋</code>
          <span id="data-stamp">로컬 데이터 준비 중</span>
        </div>
      </section>
    </main>
  </div>
`;

const form = document.querySelector<HTMLFormElement>('#search-form')!;
const input = document.querySelector<HTMLInputElement>('#pokemon-input')!;
const suggestions = document.querySelector<HTMLDivElement>('#suggestions')!;
const message = document.querySelector<HTMLParagraphElement>('#search-message')!;
const chart = document.querySelector<HTMLDivElement>('#chart')!;
const dataStamp = document.querySelector<HTMLSpanElement>('#data-stamp')!;
const levelButtons = [...document.querySelectorAll<HTMLButtonElement>('.level-button')];
const presetButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-top]')];
const rankingStamp = document.querySelector<HTMLSpanElement>('#ranking-stamp')!;

let level = 50;
let allPokemon: Pokemon[] = [];
let selected: Pokemon[] = [];
let pokemonIndex = new Map<string, Pokemon>();
let doubleRanking: Array<{ rank: number; pokemon: Pokemon }> = [];
let pickRankById = new Map<number, number>();
let activePreset: number | null = null;

const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[.'’\s_-]/g, '');

function buildIndex(pokemon: Pokemon[]) {
  const index = new Map<string, Pokemon>();
  pokemon.forEach((item) => {
    [item.koreanName, item.englishName, item.slug, String(item.id)].forEach((key) => index.set(normalize(key), item));
  });
  return index;
}

function axisTicks(min: number, max: number, count = 6) {
  const span = Math.max(1, max - min);
  return Array.from({ length: count }, (_, index) => Math.round(min + (span * index) / (count - 1)));
}

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
  pokemonId?: number;
  pickRank?: number;
  abilityNames: string[];
  megaCount?: number;
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

function abilityTracks(name: string, baseSpeed: number, abilities: SpeedAbility[], sprite?: string): VariantTrack[] {
  const baseRange = calculateRange(baseSpeed, level);
  return abilities.map((ability) => ({
    kind: 'ability' as const,
    label: `${name} · ${ability.name}${ability.hidden ? ' (숨겨진 특성)' : ''}`,
    detail: `${ability.condition} · ×${ability.factor}`,
    range: boostedRange(baseRange, ability.factor),
    sprite,
  }));
}

function renderChart() {
  if (!selected.length) {
    chart.innerHTML = `<div class="empty-state"><span class="empty-ball" aria-hidden="true"></span><strong>비교할 포켓몬을 추가해 주세요.</strong><span>최대 6마리까지 한 축에서 볼 수 있어요.</span></div>`;
    return;
  }

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
        pokemonId: item.id,
        pickRank: activePreset ? pickRankById.get(item.id) : undefined,
        abilityNames: item.speedAbilities.map((ability) => ability.name),
        megaCount: item.megaForms.length,
      })),
      range: calculateRange(baseSpeed, level),
      tracks: pokemon.flatMap((item) => abilityTracks(item.koreanName, item.baseSpeed, item.speedAbilities)),
      mega: false,
    }));
  const megaRows: ChartRow[] = selected.flatMap((pokemon) => pokemon.megaForms.map((mega) => ({
    key: `mega-${mega.id}`,
    baseSpeed: mega.baseSpeed,
    chips: [{
      key: `mega-chip-${mega.id}`,
      name: `${pokemon.koreanName} · ${mega.name}`,
      sprite: mega.sprite,
      abilityNames: mega.speedAbilities.map((ability) => ability.name),
    }],
    range: calculateRange(mega.baseSpeed, level),
    tracks: abilityTracks(`${pokemon.koreanName} · ${mega.name}`, mega.baseSpeed, mega.speedAbilities, mega.sprite),
    mega: true,
  })));
  const rows = [...baseRows, ...megaRows]
    .sort((a, b) => b.baseSpeed - a.baseSpeed || Number(a.mega) - Number(b.mega));
  const everyRange = rows.flatMap((row) => [row.range, ...row.tracks.map((track) => track.range)]);
  const axisMin = Math.min(...everyRange.map((range) => range.min));
  const axisMax = Math.max(...everyRange.map((range) => range.max));
  const span = Math.max(1, axisMax - axisMin);
  const padding = Math.max(4, Math.round(span * 0.08));
  const min = Math.max(0, axisMin - padding);
  const max = axisMax + padding;
  const domain = max - min;
  const ticks = axisTicks(min, max);
  const extent = (row: ChartRow) => ({
    min: Math.min(row.range.min, ...row.tracks.map((track) => track.range.min)),
    max: Math.max(row.range.max, ...row.tracks.map((track) => track.range.max)),
  });
  const labelRoom = domain * 0.12;
  const packedRows: ChartRow[][] = [];
  rows.forEach((row) => {
    const current = extent(row);
    const lane = packedRows.find((items) => items.every((item) => {
      const placed = extent(item);
      return current.max + labelRoom < placed.min || placed.max + labelRoom < current.min;
    }));
    if (lane) lane.push(row);
    else packedRows.push([row]);
  });
  chart.classList.toggle('dense', packedRows.length > 10 || rows.length > 20);

  const lanes = packedRows.map((laneRows, laneIndex) => {
    const maxTrackCount = Math.max(...laneRows.map((row) => row.tracks.length));
    const segments = laneRows.map(({ key, baseSpeed, chips: rowChips, range, tracks, mega }, segmentIndex) => {
      const color = mega ? '#aeb5c3' : COLORS[(laneIndex + segmentIndex) % COLORS.length];
      const left = ((range.min - min) / domain) * 100;
      const width = ((range.max - range.min) / domain) * 100;
      const neutralLeft = ((range.neutralMin - range.min) / Math.max(1, range.max - range.min)) * 100;
      const neutralWidth = ((range.neutralMax - range.neutralMin) / Math.max(1, range.max - range.min)) * 100;
      const chips = rowChips.map((item) => `
        <div class="pokemon-chip${mega ? ' mega-chip' : ''}">
          <div class="sprite-wrap"><img src="${item.sprite}" alt="" loading="lazy" /></div>
          <div>
            <strong>${item.pickRank ? `<em>#${item.pickRank}</em>` : ''}${item.name}</strong>
            <span>S ${baseSpeed}${mega ? ' · MEGA' : ''}${item.megaCount ? ` · MEGA ${item.megaCount}` : ''}${item.abilityNames.length ? ` · ${item.abilityNames.join('/')}` : ''}</span>
          </div>
          ${item.pokemonId ? `<button class="remove-button" type="button" data-remove="${item.pokemonId}" aria-label="${item.name} 삭제">×</button>` : ''}
        </div>
      `).join('');
      const variants = tracks.map((track, index) => {
        const trackLeft = ((track.range.min - min) / domain) * 100;
        const trackWidth = ((track.range.max - track.range.min) / domain) * 100;
        return `
          <div class="variant-track ${track.kind}" style="--track-left:${trackLeft}%; --track-width:${trackWidth}%; top:${70 + index * 24}px">
            <div class="variant-line"></div>
            <span class="variant-min">${track.range.min}</span>
            <span class="variant-max">${track.range.max}</span>
            <div class="variant-label">
              ${track.sprite ? `<img src="${track.sprite}" alt="" loading="lazy" />` : '<i aria-hidden="true"></i>'}
              <strong>${track.label}</strong>
              <span>${track.detail}</span>
            </div>
          </div>
        `;
      }).join('');
      return `
        <div class="row-segment${mega ? ' mega-row' : ''}" data-row="${key}">
          <div class="speed-range" style="--left:${left}%; --width:${width}%; --color:${color}; --neutral-left:${neutralLeft}%; --neutral-width:${neutralWidth}%">
            <div class="range-bar"><span class="neutral-range" title="무보정 범위"></span></div>
            <span class="range-value range-min">${range.min}</span>
            <span class="range-value range-max">${range.max}</span>
          </div>
          <div class="pokemon-group" style="left:${left}%">${chips}</div>
          ${variants}
        </div>
      `;
    }).join('');
    const names = laneRows.flatMap((row) => row.chips.map((chip) => chip.name)).join(', ');
    return `
      <article class="speed-lane" style="height:${82 + maxTrackCount * 24}px" aria-label="같은 행: ${names}">
        <div class="lane-line"></div>
        ${segments}
      </article>
    `;
  }).join('');

  chart.innerHTML = `
    <div class="lanes">${lanes}</div>
    <div class="axis" aria-hidden="true">
      ${ticks.map((tick, index) => `<span style="left:${(index / (ticks.length - 1)) * 100}%"><i></i><b>${tick}</b></span>`).join('')}
    </div>
    <p class="axis-caption">SPEED STAT · LEVEL ${level}</p>
  `;

  chart.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      selected = selected.filter((item) => item.id !== Number(button.dataset.remove));
      renderChart();
    });
  });
}

function findMatches(query: string, limit = 6) {
  const needle = normalize(query);
  if (!needle) return [];
  const exact = pokemonIndex.get(needle);
  const matches = allPokemon.filter((pokemon) =>
    [pokemon.koreanName, pokemon.englishName, pokemon.slug, String(pokemon.id)]
      .some((value) => normalize(value).includes(needle)),
  );
  return exact ? [exact, ...matches.filter((item) => item.id !== exact.id)].slice(0, limit) : matches.slice(0, limit);
}

function hideSuggestions() {
  suggestions.hidden = true;
  suggestions.innerHTML = '';
  input.setAttribute('aria-expanded', 'false');
}

function showSuggestions(query: string) {
  const matches = findMatches(query);
  if (!matches.length) {
    hideSuggestions();
    return;
  }
  suggestions.innerHTML = matches.map((pokemon) => `
    <button type="button" role="option" data-id="${pokemon.id}">
      <img src="${pokemon.sprite}" alt="" />
      <span><strong>${pokemon.koreanName}</strong><small>${pokemon.englishName} · No.${String(pokemon.id).padStart(4, '0')}</small></span>
      <b>S ${pokemon.baseSpeed}</b>
    </button>
  `).join('');
  suggestions.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  suggestions.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.addEventListener('click', () => addPokemon(allPokemon.find((item) => item.id === Number(button.dataset.id))));
  });
}

function addPokemon(pokemon?: Pokemon) {
  if (!pokemon) {
    message.textContent = '존재하는 포켓몬 이름을 찾지 못했어요. 철자나 도감 번호를 확인해 주세요.';
    message.className = 'search-message error';
    return;
  }
  if (activePreset) {
    selected = [];
    activePreset = null;
    presetButtons.forEach((button) => button.classList.remove('active'));
  }
  if (selected.some((item) => item.id === pokemon.id)) {
    message.textContent = `${pokemon.koreanName}은(는) 이미 비교 중이에요.`;
    message.className = 'search-message error';
    hideSuggestions();
    return;
  }
  if (!activePreset && selected.length >= 6) {
    message.textContent = '한 번에 최대 6마리까지 비교할 수 있어요.';
    message.className = 'search-message error';
    return;
  }
  selected.push(pokemon);
  input.value = '';
  message.textContent = `${pokemon.koreanName}을(를) 스피드 라인에 추가했어요.`;
  message.className = 'search-message success';
  hideSuggestions();
  renderChart();
  input.focus();
}

function loadRankingPreset(limit: number) {
  const rankedPokemon = doubleRanking
    .slice(0, limit)
    .map((row) => row.pokemon);
  activePreset = limit;
  selected = rankedPokemon;
  presetButtons.forEach((button) => button.classList.toggle('active', Number(button.dataset.top) === limit));
  message.textContent = `더블배틀 픽률 TOP ${rankedPokemon.length}을(를) 불러왔어요.`;
  message.className = 'search-message success';
  renderChart();
  document.querySelector('.comparison')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setComparison(pokemon: Pokemon[], nextLevel: number) {
  activePreset = null;
  presetButtons.forEach((button) => button.classList.remove('active'));
  selected = pokemon;
  level = nextLevel;
  levelButtons.forEach((button) => button.classList.toggle('active', Number(button.dataset.level) === level));
  renderChart();
}

function registerWebMcpTool() {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const controller = new AbortController();
  const registration = context.registerTool({
    name: 'set_pokemon_speed_comparison',
    title: '포켓몬 스피드 비교 설정',
    description: '한국어·영어 이름 또는 도감 번호로 최대 6마리를 선택하고, 표시할 레벨을 설정합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        pokemonNames: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
        level: { type: 'integer', enum: [50, 100] },
      },
      required: ['pokemonNames', 'level'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(rawInput) {
      if (!rawInput || typeof rawInput !== 'object') throw new Error('입력은 객체여야 합니다.');
      const toolInput = rawInput as { pokemonNames?: unknown; level?: unknown };
      if (!Array.isArray(toolInput.pokemonNames) || toolInput.pokemonNames.length < 1 || toolInput.pokemonNames.length > 6) {
        throw new Error('pokemonNames에는 1~6개의 이름이 필요합니다.');
      }
      if (toolInput.level !== 50 && toolInput.level !== 100) throw new Error('level은 50 또는 100이어야 합니다.');

      const resolved = toolInput.pokemonNames.map((name) =>
        typeof name === 'string' ? pokemonIndex.get(normalize(name)) : undefined,
      );
      const missing = toolInput.pokemonNames.filter((_, index) => !resolved[index]);
      if (missing.length) throw new Error(`존재하지 않는 포켓몬: ${missing.join(', ')}`);

      const unique = [...new Map((resolved as Pokemon[]).map((pokemon) => [pokemon.id, pokemon])).values()];
      setComparison(unique, toolInput.level);
      return {
        level,
        pokemon: unique.map((item) => ({ name: item.koreanName, baseSpeed: item.baseSpeed, ...calculateRange(item.baseSpeed, level) })),
      };
    },
  }, { signal: controller.signal });

  void Promise.resolve(registration).catch(() => controller.abort());
}

input.addEventListener('input', () => {
  message.textContent = '한국어·영어 이름 또는 도감 번호로 찾을 수 있어요.';
  message.className = 'search-message';
  showSuggestions(input.value);
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideSuggestions();
  if (event.key === 'ArrowDown' && !suggestions.hidden) {
    event.preventDefault();
    suggestions.querySelector<HTMLButtonElement>('button')?.focus();
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  addPokemon(pokemonIndex.get(normalize(input.value)));
});

document.addEventListener('click', (event) => {
  if (!form.contains(event.target as Node)) hideSuggestions();
});

levelButtons.forEach((button) => {
  button.addEventListener('click', () => {
    level = Number(button.dataset.level);
    levelButtons.forEach((item) => item.classList.toggle('active', item === button));
    renderChart();
  });
});

presetButtons.forEach((button) => {
  button.addEventListener('click', () => loadRankingPreset(Number(button.dataset.top)));
});

async function loadPokemon() {
  try {
    const response = await fetch('/data/pokemon.json');
    if (!response.ok) throw new Error('데이터 파일을 불러오지 못했습니다.');
    const data = await response.json() as PokemonData;
    const rankingForms = data.rankings.double.rows.map((row) => row.pokemon);
    allPokemon = [...new Map([...data.pokemon, ...rankingForms].map((pokemon) => [pokemon.id, pokemon])).values()];
    pokemonIndex = buildIndex(allPokemon);
    doubleRanking = data.rankings.double.rows;
    pickRankById = new Map(doubleRanking.map((row) => [row.pokemon.id, row.rank]));
    selected = INITIAL_IDS.map((id) => allPokemon.find((item) => item.id === id)).filter((item): item is Pokemon => Boolean(item));
    const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(data.meta.generatedAt));
    dataStamp.textContent = `${data.meta.count.toLocaleString('ko-KR')}마리 · 메가 ${data.meta.megaFormCount}폼 · 스피드 특성 ${data.meta.speedAbilityPokemonCount}마리 · ${date} 동기화`;
    rankingStamp.textContent = `포케챔스 시즌 ${data.rankings.double.season} · ${data.rankings.double.updated ?? '최근 갱신'}`;
    renderChart();
    registerWebMcpTool();
  } catch {
    chart.innerHTML = `<div class="empty-state error-state"><strong>도감 데이터를 불러오지 못했어요.</strong><span>터미널에서 npm run sync:data를 실행해 주세요.</span></div>`;
    dataStamp.textContent = '데이터 없음';
  }
}

void loadPokemon();
