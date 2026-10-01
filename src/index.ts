import './styles.css';
import { calculateSpeed } from './calculator';
import appMarkup from './app.html?raw';
import { findMatches, loadPokemonData, normalize, type Pokemon } from './pokemon';
import { buildChartRows, findSpeedNeighbours, type FocusEntry } from './comparison';
import { registerWebMcpTool } from './webmcp';

const COLORS = ['#3568f0', '#f05454', '#20a86b', '#8e5ad7', '#eb8a21', '#0f8ea8'];
const INITIAL_IDS = [25, 445, 149, 887];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('앱 컨테이너를 찾지 못했습니다.');

app.innerHTML = appMarkup;

const form = document.querySelector<HTMLFormElement>('#search-form')!;
const input = document.querySelector<HTMLInputElement>('#pokemon-input')!;
const suggestions = document.querySelector<HTMLDivElement>('#suggestions')!;
const message = document.querySelector<HTMLParagraphElement>('#search-message')!;
const chart = document.querySelector<HTMLDivElement>('#chart')!;
const dataStamp = document.querySelector<HTMLSpanElement>('#data-stamp')!;
const levelButtons = [...document.querySelectorAll<HTMLButtonElement>('.level-button')];
const presetButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-top]')];
const rankingStamp = document.querySelector<HTMLSpanElement>('#ranking-stamp')!;
const speedLab = document.querySelector<HTMLElement>('#speed-lab')!;
const speedWindow = document.querySelector<HTMLDivElement>('#speed-window')!;
const speedEv = document.querySelector<HTMLInputElement>('#speed-ev')!;
const speedEvValue = document.querySelector<HTMLOutputElement>('#speed-ev-value')!;
const natureButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-nature]')];
const labClose = document.querySelector<HTMLButtonElement>('#lab-close')!;
const speedLabNote = document.querySelector<HTMLParagraphElement>('#speed-lab-note')!;
const trickRoomButton = document.querySelector<HTMLButtonElement>('#trick-room-toggle')!;
const dataControls = [...document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#search-form input, #search-form button, .level-button, [data-top], #trick-room-toggle')];

let level = 50;
let allPokemon: Pokemon[] = [];
let selected: Pokemon[] = [];
let pokemonIndex = new Map<string, Pokemon>();
let doubleRanking: Array<{ rank: number; pokemon: Pokemon }> = [];
let pickRankById = new Map<number, number>();
let activePreset: number | null = null;
let manualSelectedIds = new Set<number>();
let focusEntries: FocusEntry[] = [];
let focusedKey: string | null = null;
let focusEv = 0;
let focusNature = 1;
let trickRoom = false;

function axisTicks(min: number, max: number, count = 6) {
  const span = Math.max(1, max - min);
  return Array.from({ length: count }, (_, index) => Math.round(min + (span * index) / (count - 1)));
}

function speedNeighbourMarkup(entry: FocusEntry, speed: number, targetSpeed: number) {
  const difference = speed - targetSpeed;
  const differenceLabel = difference === 0 ? '동속' : `${difference > 0 ? '+' : ''}${difference}`;
  return `
    <li class="speed-neighbour${difference === 0 ? ' tied' : ''}">
      <img src="${entry.sprite}" alt="" loading="lazy" />
      <span><strong>${entry.name}</strong><small>S ${entry.baseSpeed}${entry.mega ? ' · MEGA' : ''}</small></span>
      <b>${speed}</b>
      <em>${differenceLabel}</em>
    </li>
  `;
}

function renderSpeedLab() {
  const focused = focusEntries.find((entry) => entry.key === focusedKey);
  if (!focused) {
    focusedKey = null;
    speedLab.hidden = true;
    return;
  }

  const targetSpeed = calculateSpeed(focused.baseSpeed, level, 31, focusEv * 8, focusNature);
  const { overtaken, tied: tiedAll, ahead } = findSpeedNeighbours(focusEntries, focused.key, targetSpeed, level, trickRoom);
  const emptyList = '<li class="neighbour-empty">해당하는 포켓몬이 없어요.</li>';

  speedEv.value = String(focusEv);
  speedEvValue.value = String(focusEv);
  speedEvValue.textContent = focusEv === 32 ? '32 (최대)' : String(focusEv);
  speedLabNote.textContent = trickRoom
    ? '트릭룸: 더 낮은 스피드가 먼저 움직입니다. 비교 포켓몬은 IV 31·EV 0·하락 성격의 최저속 기준입니다.'
    : '일반 순서: 더 높은 스피드가 먼저 움직입니다. 비교 포켓몬은 IV 31·EV 32(×8)·상승 성격의 최속 기준입니다.';
  speedWindow.innerHTML = `
    <section class="neighbour-column overtaken-column" aria-label="추월한 포켓몬">
      <div class="neighbour-title"><span>바로 뒤 · 추월 완료</span><b>${overtaken.length}/5</b></div>
      <ol>${overtaken.length ? overtaken.map(({ entry, speed }) => speedNeighbourMarkup(entry, speed, targetSpeed)).join('') : emptyList}</ol>
    </section>
    <div class="focus-column">
      <article class="focus-card">
        <span class="focus-status">현재 실능</span>
        <img src="${focused.sprite}" alt="" />
        <strong>${focused.name}</strong>
        <span>S ${focused.baseSpeed}${focused.mega ? ' · MEGA' : ''}</span>
        <b>${targetSpeed}</b>
        <small>EV ${focusEv} (실계산 ${focusEv * 8}) · ${focusNature === 1.1 ? '상승 성격' : focusNature === 0.9 ? '하락 성격' : '무보정 성격'}</small>
      </article>
      <section class="tied-group" aria-label="동속 포켓몬">
        <div class="tied-title"><span>동속</span><b>${tiedAll.length}</b></div>
        <ol>${tiedAll.length ? tiedAll.map(({ entry, speed }) => speedNeighbourMarkup(entry, speed, targetSpeed)).join('') : '<li class="neighbour-empty">동속 포켓몬이 없어요.</li>'}</ol>
      </section>
    </div>
    <section class="neighbour-column ahead-column" aria-label="아직 빠른 포켓몬">
      <div class="neighbour-title"><span>바로 앞 · 아직 빠름</span><b>${ahead.length}/5</b></div>
      <ol>${ahead.length ? ahead.map(({ entry, speed }) => speedNeighbourMarkup(entry, speed, targetSpeed)).join('') : emptyList}</ol>
    </section>
  `;
  speedLab.hidden = false;
}

function renderChart() {
  if (!selected.length) {
    focusEntries = [];
    focusedKey = null;
    speedLab.hidden = true;
    chart.innerHTML = `<div class="empty-state"><span class="empty-ball" aria-hidden="true"></span><strong>비교할 포켓몬을 추가해 주세요.</strong><span>최대 6마리까지 한 축에서 볼 수 있어요.</span></div>`;
    return;
  }

  const rows = buildChartRows(selected, level, activePreset, pickRankById);
  focusEntries = rows.flatMap((row) => row.chips.map((chip) => ({
    key: chip.key,
    name: chip.name,
    sprite: chip.sprite,
    baseSpeed: row.baseSpeed,
    mega: chip.mega,
  })));
  if (focusedKey && !focusEntries.some((entry) => entry.key === focusedKey)) focusedKey = null;
  const everyRange = rows.flatMap((row) => [row.range, ...row.tracks.map((track) => track.range)]);
  const axisMin = Math.min(...everyRange.map((range) => range.min));
  const axisMax = Math.max(...everyRange.map((range) => range.max));
  const span = Math.max(1, axisMax - axisMin);
  const padding = Math.max(4, Math.round(span * 0.08));
  const min = Math.max(0, axisMin - padding);
  const max = axisMax + padding;
  const domain = max - min;
  const ticks = axisTicks(min, max);
  const position = (value: number) => ((trickRoom ? max - value : value - min) / domain) * 100;
  chart.classList.toggle('dense', rows.length > 10);
  chart.classList.toggle('trick-room', trickRoom);

  const lanes = rows.map(({ key, baseSpeed, chips: rowChips, range, tracks, mega }, rowIndex) => {
      const color = mega ? '#aeb5c3' : COLORS[rowIndex % COLORS.length];
      const rangeMinPosition = position(range.min);
      const rangeMaxPosition = position(range.max);
      const left = Math.min(rangeMinPosition, rangeMaxPosition);
      const width = Math.abs(rangeMaxPosition - rangeMinPosition);
      const neutralMinPosition = position(range.neutralMin);
      const neutralMaxPosition = position(range.neutralMax);
      const neutralLeft = ((Math.min(neutralMinPosition, neutralMaxPosition) - left) / Math.max(.001, width)) * 100;
      const neutralWidth = (Math.abs(neutralMaxPosition - neutralMinPosition) / Math.max(.001, width)) * 100;
      const leftValue = trickRoom ? range.max : range.min;
      const rightValue = trickRoom ? range.min : range.max;
      const chips = rowChips.map((item) => `
        <div class="pokemon-chip${item.mega ? ' mega-chip' : ''}${item.key === focusedKey ? ' focused' : ''}" data-focus="${item.key}" role="button" tabindex="0" aria-label="${item.name} 추월선 보기">
          <div class="sprite-wrap"><img src="${item.sprite}" alt="" loading="lazy" /></div>
          <div>
            <strong>${item.pickRank ? `<em>#${item.pickRank}</em>` : ''}${item.name}</strong>
            <span>S ${baseSpeed}${item.mega ? ' · MEGA' : ''}${item.megaCount ? ` · MEGA ${item.megaCount}` : ''}${item.abilityNames.length ? ` · ${item.abilityNames.join('/')}` : ''}</span>
          </div>
          ${item.pokemonId ? `<button class="remove-button" type="button" data-remove="${item.pokemonId}" aria-label="${item.name} 삭제">×</button>` : ''}
        </div>
      `).join('');
      const variants = tracks.map((track, index) => {
        const trackMinPosition = position(track.range.min);
        const trackMaxPosition = position(track.range.max);
        const trackLeft = Math.min(trackMinPosition, trackMaxPosition);
        const trackWidth = Math.abs(trackMaxPosition - trackMinPosition);
        const trackLeftValue = trickRoom ? track.range.max : track.range.min;
        const trackRightValue = trickRoom ? track.range.min : track.range.max;
        return `
          <div class="variant-track ${track.kind}" style="--track-left:${trackLeft}%; --track-width:${trackWidth}%; top:${70 + index * 24}px">
            <div class="variant-line"></div>
            <span class="variant-min">${trackLeftValue}</span>
            <span class="variant-max">${trackRightValue}</span>
            <div class="variant-label">
              ${track.sprite ? `<img src="${track.sprite}" alt="" loading="lazy" />` : '<i aria-hidden="true"></i>'}
              <strong>${track.label}</strong>
              <span>${track.detail}</span>
            </div>
          </div>
        `;
      }).join('');
      const names = rowChips.map((chip) => chip.name).join(', ');
      return `
      <article class="speed-lane" style="height:${82 + tracks.length * 24}px" aria-label="스피드 종족값 ${baseSpeed}: ${names}">
        <div class="lane-line"></div>
        <div class="row-segment${mega ? ' mega-row' : ''}" data-row="${key}">
          <div class="speed-range" style="--left:${left}%; --width:${width}%; --color:${color}; --neutral-left:${neutralLeft}%; --neutral-width:${neutralWidth}%">
            <div class="range-bar"><span class="neutral-range" title="무보정 범위"></span></div>
            <span class="range-value range-min">${leftValue}</span>
            <span class="range-value range-max">${rightValue}</span>
          </div>
          <div class="pokemon-group" style="left:${left}%">${chips}</div>
          ${variants}
        </div>
      </article>
    `;
  }).join('');

  chart.innerHTML = `
    <div class="lanes">${lanes}</div>
    <div class="axis" aria-hidden="true">
      ${ticks.map((tick, index) => `<span style="left:${(index / (ticks.length - 1)) * 100}%"><i></i><b>${trickRoom ? ticks[ticks.length - 1 - index] : tick}</b></span>`).join('')}
    </div>
    <p class="axis-caption">${trickRoom ? 'TRICK ROOM · LOWER SPEED MOVES FIRST' : 'SPEED STAT'} · LEVEL ${level}</p>
  `;

  chart.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const pokemonId = Number(button.dataset.remove);
      manualSelectedIds.delete(pokemonId);
      selected = selected.filter((item) => item.id !== pokemonId);
      renderChart();
    });
  });
  chart.querySelectorAll<HTMLElement>('[data-focus]').forEach((chip) => {
    const showFocus = () => {
      focusedKey = chip.dataset.focus ?? null;
      focusEv = 0;
      focusNature = 1;
      natureButtons.forEach((button) => {
        const active = Number(button.dataset.nature) === focusNature;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      chart.querySelectorAll('[data-focus]').forEach((item) => item.classList.toggle('focused', item === chip));
      renderSpeedLab();
      speedLab.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    chip.addEventListener('click', showFocus);
    chip.addEventListener('keydown', (event) => {
      if (event.target !== chip) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showFocus();
      }
    });
  });
  renderSpeedLab();
}

function hideSuggestions() {
  suggestions.hidden = true;
  suggestions.innerHTML = '';
  input.setAttribute('aria-expanded', 'false');
}

function showSuggestions(query: string) {
  const matches = findMatches(allPokemon, pokemonIndex, query);
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
  if (selected.some((item) => item.id === pokemon.id)) {
    if (activePreset && !manualSelectedIds.has(pokemon.id)) {
      manualSelectedIds.add(pokemon.id);
      message.textContent = `${pokemon.koreanName}을(를) 검색 선택으로 고정했어요. 픽률 순위를 빼도 유지됩니다.`;
      message.className = 'search-message success';
    } else {
      message.textContent = `${pokemon.koreanName}은(는) 이미 비교 중이에요.`;
      message.className = 'search-message error';
    }
    hideSuggestions();
    return;
  }
  if (!activePreset && selected.length >= 6) {
    message.textContent = '한 번에 최대 6마리까지 비교할 수 있어요.';
    message.className = 'search-message error';
    return;
  }
  manualSelectedIds.add(pokemon.id);
  selected.push(pokemon);
  input.value = '';
  message.textContent = `${pokemon.koreanName}을(를) 스피드 라인에 추가했어요.`;
  message.className = 'search-message success';
  hideSuggestions();
  renderChart();
  input.focus();
}

function loadRankingPreset(limit: number) {
  if (activePreset === limit) {
    activePreset = null;
    selected = selected.filter((pokemon) => manualSelectedIds.has(pokemon.id));
    presetButtons.forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
    message.textContent = `더블배틀 픽률 TOP ${limit}을(를) 목록에서 뺐어요.`;
    message.className = 'search-message success';
    renderChart();
    return;
  }

  const rankedPokemon = doubleRanking
    .slice(0, limit)
    .map((row) => row.pokemon);
  const manualPokemon = selected.filter((pokemon) => manualSelectedIds.has(pokemon.id));
  activePreset = limit;
  selected = [...new Map([...manualPokemon, ...rankedPokemon].map((pokemon) => [pokemon.id, pokemon])).values()];
  presetButtons.forEach((button) => {
    const isActive = Number(button.dataset.top) === limit;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  message.textContent = `현재 목록에 더블배틀 픽률 TOP ${rankedPokemon.length}을(를) 추가했어요.`;
  message.className = 'search-message success';
  renderChart();
  document.querySelector('.comparison')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setComparison(pokemon: Pokemon[], nextLevel: number) {
  activePreset = null;
  manualSelectedIds = new Set(pokemon.map((item) => item.id));
  presetButtons.forEach((button) => {
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  });
  selected = pokemon;
  level = nextLevel;
  levelButtons.forEach((button) => button.classList.toggle('active', Number(button.dataset.level) === level));
  renderChart();
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

trickRoomButton.addEventListener('click', () => {
  trickRoom = !trickRoom;
  trickRoomButton.classList.toggle('active', trickRoom);
  trickRoomButton.setAttribute('aria-pressed', String(trickRoom));
  renderChart();
});

presetButtons.forEach((button) => {
  button.addEventListener('click', () => loadRankingPreset(Number(button.dataset.top)));
});

speedEv.addEventListener('input', () => {
  focusEv = Number(speedEv.value);
  renderSpeedLab();
});

natureButtons.forEach((button) => {
  button.addEventListener('click', () => {
    focusNature = Number(button.dataset.nature);
    natureButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    renderSpeedLab();
  });
});

labClose.addEventListener('click', () => {
  focusedKey = null;
  speedLab.hidden = true;
  chart.querySelectorAll('[data-focus]').forEach((item) => item.classList.remove('focused'));
});

async function loadPokemon() {
  dataControls.forEach((control) => { control.disabled = true; });
  try {
    const { data, pokemon, index } = await loadPokemonData();
    allPokemon = pokemon;
    pokemonIndex = index;
    doubleRanking = data.rankings.double.rows;
    pickRankById = new Map(doubleRanking.map((row) => [row.pokemon.id, row.rank]));
    selected = INITIAL_IDS.map((id) => allPokemon.find((item) => item.id === id)).filter((item): item is Pokemon => Boolean(item));
    manualSelectedIds = new Set(selected.map((item) => item.id));
    const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(data.meta.generatedAt));
    dataStamp.textContent = `${data.meta.count.toLocaleString('ko-KR')}마리 · 메가 ${data.meta.megaFormCount}폼 · 스피드 특성 ${data.meta.speedAbilityPokemonCount}마리 · ${date} 동기화`;
    rankingStamp.textContent = `포케챔스 시즌 ${data.rankings.double.season} · ${data.rankings.double.updated ?? '최근 갱신'}`;
    renderChart();
    registerWebMcpTool(pokemonIndex, setComparison);
    dataControls.forEach((control) => { control.disabled = false; });
  } catch {
    chart.innerHTML = `<div class="empty-state error-state"><strong>도감 데이터를 불러오지 못했어요.</strong><span>연결을 확인한 뒤 다시 시도해 주세요.</span><button type="button" id="retry-data">다시 시도</button></div>`;
    chart.querySelector<HTMLButtonElement>('#retry-data')!.addEventListener('click', () => void loadPokemon());
    dataStamp.textContent = '데이터 없음';
  }
}

void loadPokemon();
