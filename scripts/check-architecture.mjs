import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// 기존 TypeScript만 사용하여 DOM 없는 모듈을 실행합니다. 생성 파일은 남기지 않습니다.
function moduleUrl(name, imports = {}) {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  for (const [specifier, url] of Object.entries(imports)) outputText = outputText.replaceAll(`'${specifier}'`, `'${url}'`);
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const calculatorUrl = moduleUrl('calculator');
const pokemonUrl = moduleUrl('pokemon');
const { calculateRange, calculateSpeed } = await import(calculatorUrl);
const { buildIndex, findMatches, loadPokemonData } = await import(pokemonUrl);
const { buildChartRows, findSpeedNeighbours } = await import(moduleUrl('comparison', { './calculator': calculatorUrl }));
const { registerWebMcpTool } = await import(moduleUrl('webmcp', { './calculator': calculatorUrl, './pokemon': pokemonUrl }));
const snapshot = JSON.parse(readFileSync(new URL('../public/data/pokemon.json', import.meta.url), 'utf8'));
const pikachu = snapshot.pokemon.find((pokemon) => pokemon.id === 25);
const allForms = [...snapshot.pokemon, ...snapshot.rankings.double.rows.map(({ pokemon }) => pokemon)];
assert.equal(snapshot.meta.count, snapshot.pokemon.length);
assert.equal(snapshot.rankings.double.rows.length, 100);
assert.equal(new Set(snapshot.pokemon.map(({ id }) => id)).size, snapshot.pokemon.length);
for (const pokemon of allForms) {
  for (const form of [pokemon, ...pokemon.megaForms]) {
    assert.ok(Number.isInteger(form.id) && Number.isFinite(form.baseSpeed) && form.baseSpeed > 0);
    assert.ok(form.sprite.startsWith('https://raw.githubusercontent.com/PokeAPI/sprites/'));
  }
}

assert.deepEqual(calculateRange(90, 50), { min: 99, neutralMin: 110, neutralMax: 142, max: 156 });
assert.deepEqual(calculateRange(90, 100), { min: 194, neutralMin: 216, neutralMax: 280, max: 308 });
const index = buildIndex(snapshot.pokemon);
for (const name of ['피카츄', ' PIKA-CHU ', '25']) assert.equal(findMatches(snapshot.pokemon, index, name)[0].id, 25);
assert.deepEqual(findMatches(snapshot.pokemon, index, '  '), []);
assert.deepEqual(findMatches(snapshot.pokemon, index, '없는포켓몬'), []);

const ability = { slug: 'test', name: '검증용 특성', factor: 1.5, condition: '검증', hidden: true };
const selected = [
  { ...pikachu, megaForms: [{ id: 99999, slug: 'test-mega', name: '메가', baseSpeed: 90, sprite: '', speedAbilities: [ability] }] },
  { ...pikachu, id: 99998, speedAbilities: [ability], megaForms: [] },
];
for (const level of [50, 100]) {
  const rows = buildChartRows(selected, level, 20, new Map([[25, 1], [99998, 21]]));
  assert.equal(rows.length, 1, '동일 종족값의 일반/메가 폼은 같은 행이어야 합니다.');
  assert.equal(rows[0].chips.length, 3);
  assert.equal(rows[0].mega, false);
  assert.deepEqual(rows[0].range, calculateRange(90, level));
  assert.deepEqual(rows[0].chips.map((chip) => chip.pickRank), [1, undefined, undefined]);
  assert.equal(rows[0].tracks.length, 2);
  assert.equal(rows[0].tracks[0].range.max, Math.floor(rows[0].range.max * 1.5));
}
assert.deepEqual(buildChartRows([], 50, null, new Map()), []);
assert.equal(buildChartRows(selected, 50, null, new Map([[25, 1]]))[0].chips[0].pickRank, undefined);

const entries = Array.from({ length: 17 }, (_, i) => ({ key: String(i), name: String(i), sprite: '', baseSpeed: 50 + i * 5, mega: false }));
for (const level of [50, 100]) {
  for (const trickRoom of [false, true]) {
    const target = calculateSpeed(90, level, 31, trickRoom ? 0 : 256, trickRoom ? 0.9 : 1.1);
    const neighbours = findSpeedNeighbours(entries, '0', target, level, trickRoom);
    assert.equal(neighbours.ahead.length, 5);
    assert.equal(neighbours.overtaken.length, 5);
    assert.deepEqual(neighbours.tied.map(({ entry }) => entry.key), ['8']);
    assert.ok(neighbours.ahead.every(({ entry, speed }) => entry.key !== '0' && (trickRoom ? speed < target : speed > target)));
    assert.ok(neighbours.overtaken.every(({ entry, speed }) => entry.key !== '0' && (trickRoom ? speed > target : speed < target)));
    const closestAhead = neighbours.ahead[0].speed;
    assert.ok(neighbours.ahead.every(({ speed }) => trickRoom ? speed <= closestAhead : speed >= closestAhead));
  }
}

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({ ok: true, json: async () => snapshot });
  const loaded = await loadPokemonData();
  assert.equal(loaded.pokemon.length, new Set(loaded.pokemon.map(({ id }) => id)).size);
  for (const { pokemon } of snapshot.rankings.double.rows) assert.equal(loaded.index.get(String(pokemon.id)).id, pokemon.id);
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(loadPokemonData(), /데이터 파일/);
} finally {
  globalThis.fetch = originalFetch;
}

let tool;
let comparison;
globalThis.document = {};
registerWebMcpTool(index, () => assert.fail('미지원 환경에서는 등록하지 않아야 합니다.'));
globalThis.document = { modelContext: { registerTool(value) { tool = value; } } };
registerWebMcpTool(index, (pokemon, level) => { comparison = { pokemon, level }; });
const result = tool.execute({ pokemonNames: ['피카츄', 'Pikachu'], level: 100 });
assert.deepEqual(comparison, { pokemon: [pikachu], level: 100 });
assert.equal(result.pokemon[0].max, 308);
for (const invalid of [null, { pokemonNames: [], level: 50 }, { pokemonNames: Array(7).fill('피카츄'), level: 50 }, { pokemonNames: [25], level: 50 }, { pokemonNames: ['피카츄'], level: 75 }, { pokemonNames: ['없는포켓몬'], level: 50 }]) {
  assert.throws(() => tool.execute(invalid));
}
globalThis.document = { modelContext: { registerTool() { throw new Error('등록 실패'); } } };
assert.doesNotThrow(() => registerWebMcpTool(index, () => {}), '선택적 WebMCP 실패는 도감 로딩을 중단하면 안 됩니다.');
console.log('검색·계산·폼 병합·특성·순위·트릭룸·데이터 로딩·WebMCP 검증 통과');
