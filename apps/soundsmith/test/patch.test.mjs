import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAMS, BASE_PATCH, normalizePatch, getPath, setPath, toUnit, fromUnit, formatValue,
  applyMacro, MACROS, randomPatch, RANDOM_KINDS, mutatePatch, envLevel, releaseLevel, waveCycle, WAVES,
  blendPatches, harmonicsOf, CUSTOM_LEN, MATCH_BANDS,
} from '../src/patch.js';
import { FACTORY } from '../src/presets.js';

const inRange = (p) => {
  for (const [path, spec] of Object.entries(PARAMS)) {
    const v = getPath(p, path);
    if (spec.kind === 'list') assert.ok(v.length === spec.len && v.every((x) => x >= spec.min && x <= spec.max), path);
    else if (spec.kind === 'enum') assert.ok(spec.values.includes(v), `${path}=${v}`);
    else if (spec.kind === 'bool') assert.equal(typeof v, 'boolean', path);
    else assert.ok(v >= spec.min && v <= spec.max, `${path}=${v}`);
  }
};

test('빈 입력·이상한 입력도 완전한 음색이 된다', () => {
  assert.deepEqual(normalizePatch({}), BASE_PATCH);
  const p = normalizePatch({ name: '  ', osc: [{ wave: 'kazoo', level: 9, unison: 3.6 }], filter: { cutoff: -5 }, mono: 'yes' });
  assert.equal(p.name, BASE_PATCH.name);
  assert.equal(p.osc[0].wave, 'sawtooth');
  assert.equal(p.osc[0].level, 1);
  assert.equal(p.osc[0].unison, 4);
  assert.equal(p.filter.cutoff, 40);
  assert.equal(p.mono, false);
  inRange(p);
});

test('JSON 으로 저장했다 불러와도 같은 음색', () => {
  for (const { patch } of FACTORY) assert.deepEqual(normalizePatch(JSON.parse(JSON.stringify(patch))), patch);
});

test('기본 음색은 모두 범위 안이고 이름이 겹치지 않는다', () => {
  FACTORY.forEach(({ patch }) => inRange(patch));
  assert.equal(new Set(FACTORY.map((f) => f.patch.name)).size, FACTORY.length);
});

test('setPath 는 원본을 바꾸지 않는다', () => {
  const p = normalizePatch({});
  const q = setPath(p, 'osc.1.level', 0.5);
  assert.equal(p.osc[1].level, 0);
  assert.equal(q.osc[1].level, 0.5);
});

test('슬라이더 위치 <-> 값: 로그 눈금은 가운데가 기하평균', () => {
  const spec = PARAMS['filter.cutoff'];
  assert.ok(Math.abs(fromUnit(spec, 0.5) - Math.sqrt(40 * 18000)) < 1e-6);
  for (const v of [40, 440, 2200, 18000]) assert.ok(Math.abs(fromUnit(spec, toUnit(spec, v)) - v) < 1e-6);
  assert.equal(fromUnit(PARAMS['osc.0.unison'], 0.5), 4);
});

test('값 표시는 실제 단위로', () => {
  assert.equal(formatValue('filter.cutoff', 2200), '2.20 kHz');
  assert.equal(formatValue('filter.cutoff', 440), '440 Hz');
  assert.equal(formatValue('ampEnv.a', 0.012), '12 ms');
  assert.equal(formatValue('ampEnv.r', 3.2), '3.20 s');
  assert.equal(formatValue('osc.1.detune', -7), '−7 cent');
  assert.equal(formatValue('osc.0.octave', 0), '±0');
  assert.equal(formatValue('filter.env', 1.5), '+1.5 oct');
  assert.equal(formatValue('fx.delayBeats', 0.75), '점8분');
});

test('도우미 슬라이더: 가운데(0.5)는 그대로, 양 끝은 범위 안', () => {
  for (const { patch } of FACTORY) {
    for (const m of MACROS) {
      assert.deepEqual(applyMacro(patch, m.id, 0.5), patch, `${patch.name} ${m.id}`);
      inRange(applyMacro(patch, m.id, 0));
      inRange(applyMacro(patch, m.id, 1));
    }
  }
  const pad = FACTORY[0].patch;
  assert.ok(applyMacro(pad, 'bright', 1).filter.cutoff > pad.filter.cutoff * 7);
  assert.ok(applyMacro(pad, 'space', 1).fx.reverb > pad.fx.reverb);
});

test('랜덤 만들기: 같은 시드 = 같은 음색, 종류마다 성격이 맞다', () => {
  for (const kind of RANDOM_KINDS) {
    const a = randomPatch(kind, 7);
    assert.deepEqual(a, randomPatch(kind, 7));
    assert.equal(a.category, kind);
    inRange(a);
  }
  for (let s = 1; s < 40; s++) {
    assert.ok(randomPatch('pad', s).ampEnv.a >= 0.4);
    assert.ok(randomPatch('keys', s).ampEnv.a <= 0.01);
    assert.ok(randomPatch('bass', s).mono);
  }
});

test('변주: 범위 안에서 조금만 바뀐다', () => {
  const base = FACTORY[0].patch;
  const m = mutatePatch(base, 0.3, 11);
  inRange(m);
  assert.equal(m.name, '워십 패드 변주');
  assert.equal(mutatePatch(m, 0.3, 12).name, '워십 패드 변주');
  assert.notDeepEqual(m, base);
  assert.equal(m.source, base.source);
});

test('엔벨로프: 어택 끝에서 1, 서스테인으로 다가감, 릴리즈는 줄어듦', () => {
  const env = { a: 0.5, d: 1, s: 0.6, r: 2 };
  assert.equal(envLevel(env, 0), 0);
  assert.equal(envLevel(env, 0.25), 0.5);
  assert.ok(Math.abs(envLevel(env, 0.5) - 1) < 1e-9);
  assert.ok(Math.abs(envLevel(env, 10) - 0.6) < 1e-6);
  assert.ok(releaseLevel(env, 10, 2) < 0.6 * 0.01);
});

test('파형 그림은 -1..1 로 맞춰진다', () => {
  for (const w of WAVES) {
    const c = waveCycle(w.id, 128);
    assert.ok(Math.abs(Math.max(...c.map(Math.abs)) - 1) < 1e-6, w.id);
  }
});

test('1판 음색(새 값 없음)도 그대로 불러지고 새 값은 담백한 기본값', () => {
  const v1 = { v: 1, name: '옛 패드', category: 'pad', osc: [{ wave: 'warm', unison: 3, spread: 10, level: 0.6 }], fx: { reverb: 0.5, size: 4 } };
  const p = normalizePatch(v1);
  assert.equal(p.v, 2);
  assert.equal(p.osc[0].wave, 'warm');
  assert.equal(p.fx.reverb, 0.5);
  assert.equal(p.fx.width, 1);
  assert.equal(p.fx.shimmer, 0);
  assert.equal(p.filter.slope, 12);
  assert.deepEqual(p.eq.match, MATCH_BANDS.map(() => 0));
  assert.equal(p.custom.length, CUSTOM_LEN);
  inRange(p);
});

test('목록 값(직접 그린 배음·맞춤 EQ)은 길이·범위를 지킨다', () => {
  const p = normalizePatch({ custom: [2, -1, 'x'], eq: { match: Array(10).fill(40) } });
  assert.equal(p.custom.length, CUSTOM_LEN);
  assert.deepEqual(p.eq.match, Array(10).fill(15));
  const q = normalizePatch({ custom: Array.from({ length: CUSTOM_LEN }, (_, i) => (i === 3 ? 7 : i === 4 ? NaN : 0.5)) });
  assert.equal(q.custom[3], 1);
  assert.equal(q.custom[4], BASE_PATCH.custom[4]);
  assert.deepEqual(harmonicsOf('square', undefined, 6), [1, 0, 1 / 3, 0, 1 / 5, 0]);
  assert.equal(harmonicsOf('custom', q.custom, 3)[1], 0.5);
});

test('섞기(모프): 양 끝은 원래 음색, 가운데는 사이 값', () => {
  const a = FACTORY.find((f) => f.patch.name === '워십 패드').patch;
  const b = FACTORY.find((f) => f.patch.name === '신스 베이스').patch;
  assert.deepEqual(blendPatches(a, b, 0), a);
  assert.deepEqual(blendPatches(a, b, 1), b);
  const m = blendPatches(a, b, 0.5);
  inRange(m);
  assert.ok(Math.abs(m.filter.cutoff - Math.sqrt(a.filter.cutoff * b.filter.cutoff)) < 1);
  assert.ok(Math.abs(m.fx.reverb - (a.fx.reverb + b.fx.reverb) / 2) < 1e-9);
  assert.equal(m.name, '워십 패드 × 신스 베이스');
});
