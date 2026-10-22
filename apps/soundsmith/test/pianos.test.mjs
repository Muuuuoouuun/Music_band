import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, describePatch, normalizePatch, applyMacro, MACROS, PARAMS, getPath } from '../src/patch.js';
import { FACTORY, factoryById, USES } from '../src/presets.js';

const PIANO_IDS = ['clean-grand', 'blue-vintage', 'pop-keys'];
const IDS_BEFORE = ['worship-pad', 'air-pad', 'swell-strings', 'brass-swell', 'dx-ep', 'church-organ', 'fm-bell', 'glass-bell-pad',
  'synth-bass', 'sub-bass', 'soft-lead', 'digital-pluck', 'acoustic-guitar', 'harp'];

test("'piano' 분류가 있고 합성 피아노 3종이 들어 있다", () => {
  assert.ok(CATEGORIES.some((c) => c.id === 'piano' && c.label === '피아노'));
  for (const id of PIANO_IDS) {
    const f = factoryById(id);
    assert.ok(f, id);
    assert.equal(f.patch.category, 'piano');
    assert.equal(f.patch.source, 'synth', '샘플 없이 합성만');
    assert.equal(f.patch.mono, false, '피아노는 여러 음을 동시에 낸다 (엔진의 mono 는 한 음씩 연주)');
    assert.ok(f.desc.includes('합성'), id);
  }
});

test('기존 기본 음색 id 는 그대로, 순서도 앞쪽 그대로', () => {
  assert.deepEqual(FACTORY.slice(0, IDS_BEFORE.length).map((f) => f.id), IDS_BEFORE);
  assert.equal(new Set(FACTORY.map((f) => f.id)).size, FACTORY.length);
});

test('피아노 3종: 범위 안·JSON 왕복·쓰임새·이름은 풍(오마주) 표기', () => {
  const ok = new Set(USES.map((u) => u.id));
  for (const id of PIANO_IDS) {
    const f = factoryById(id);
    assert.deepEqual(normalizePatch(JSON.parse(JSON.stringify(f.patch))), f.patch);
    assert.ok(f.uses.length && f.uses.every((u) => ok.has(u)));
    assert.match(f.patch.name, /풍/, '상표 이름을 그대로 쓰지 않고 ~풍으로');
    for (const m of MACROS) assert.deepEqual(applyMacro(f.patch, m.id, 0.5), f.patch);
    const text = describePatch(f.patch).map((x) => x.text).join('');
    assert.match(text, /피아노 소리예요/);
    assert.ok(!text.includes('undefined'));
    // 피아노답게: 누르면 줄어드는 소리, 빠른 어택, 높은 음일수록 밝게
    assert.ok(f.patch.ampEnv.a <= 0.005);
    assert.ok(f.patch.ampEnv.s <= 0.05);
    assert.ok(f.patch.filter.keytrack >= 0.5);
  }
});

test('피아노 3종의 성격 차이: 단정한 그랜드 / 어둡고 거친 빈티지 / 밝고 넓은 팝', () => {
  const g = factoryById('clean-grand').patch;
  const b = factoryById('blue-vintage').patch;
  const p = factoryById('pop-keys').patch;
  // 빈티지: 가장 어둡고, 드라이브·테이프 잡음·흔들림이 있고, 거의 모노(코러스 약함)
  assert.ok(b.filter.cutoff < g.filter.cutoff && g.filter.cutoff < p.filter.cutoff);
  assert.ok(b.tone.air < 0 && b.tone.clarity < 0);
  assert.ok(b.fx.drive > g.fx.drive && b.noise > 0 && g.noise === 0 && p.noise === 0);
  assert.ok(b.lfo.depth > 0 && b.lfo.target === 'pitch' && b.lfo.depth < 0.1, '테이프 흔들림은 아주 약하게');
  assert.ok(b.fx.chorus < p.fx.chorus && b.fx.chorus <= 0.2);
  // 그랜드: 효과를 아끼고(코러스 0·드라이브 0) 또렷하게
  assert.equal(g.fx.chorus, 0);
  assert.equal(g.fx.drive, 0);
  assert.ok(g.tone.clarity > 0);
  // 팝: 가장 넓고(코러스·겹치기) 밝다
  assert.ok(p.fx.chorus > g.fx.chorus && p.osc[0].unison > g.osc[0].unison);
  assert.ok(p.tone.air > g.tone.air);
});

test('피아노 배음 모양: 기본음이 가장 크고 위로 갈수록 줄어든다', () => {
  for (const id of PIANO_IDS) {
    const c = factoryById(id).patch.custom;
    assert.equal(c.length, 24);
    assert.equal(Math.max(...c), c[0]);
    assert.ok(c[0] > c[4] && c[4] >= c[12]);
  }
  // 빈티지는 배음이 가장 적고, 팝은 가장 많다 (배음 합)
  const sum = (id) => factoryById(id).patch.custom.reduce((s, v) => s + v, 0);
  assert.ok(sum('blue-vintage') < sum('clean-grand') && sum('clean-grand') < sum('pop-keys'));
  assert.ok(getPath(factoryById('clean-grand').patch, 'osc.0.wave') === 'custom' && PARAMS['osc.0.wave']);
});
