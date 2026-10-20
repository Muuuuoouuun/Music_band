import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAMS, BASE_PATCH, normalizePatch, getPath, setPath, toUnit, fromUnit, formatValue,
  applyMacro, MACROS, randomPatch, RANDOM_KINDS, mutatePatch, envLevel, releaseLevel, waveCycle, WAVES,
} from '../src/patch.js';
import { FACTORY } from '../src/presets.js';

const inRange = (p) => {
  for (const [path, spec] of Object.entries(PARAMS)) {
    const v = getPath(p, path);
    if (spec.kind === 'enum') assert.ok(spec.values.includes(v), `${path}=${v}`);
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

test('직접 그린 파형: 배음 24개, 저장·불러오기, 잘못된 값은 기본', async () => {
  const { harmonicsOf, HARMONIC_COUNT } = await import('../src/patch.js');
  assert.equal(harmonicsOf('sine').length, HARMONIC_COUNT);
  assert.deepEqual(harmonicsOf('sine').slice(0, 3), [1, 0, 0]);
  assert.equal(harmonicsOf('square')[1], 0);
  assert.equal(harmonicsOf('sawtooth')[3], 0.25);
  const drawn = harmonicsOf('organ').map((v, i) => (i === 4 ? 0.8 : v));
  const p = normalizePatch({ osc: [{ wave: 'custom' }], custom: drawn });
  assert.equal(p.osc[0].wave, 'custom');
  assert.deepEqual(p.custom, drawn);
  assert.deepEqual(normalizePatch(JSON.parse(JSON.stringify(p))), p);
  assert.deepEqual(normalizePatch({ custom: [1, 2] }).custom, BASE_PATCH.custom);
  assert.equal(normalizePatch({ custom: Array(24).fill(3) }).custom[0], 1);
  const c = waveCycle('custom', 64, drawn);
  assert.ok(Math.abs(Math.max(...c.map(Math.abs)) - 1) < 1e-6);
});

test('지금 소리 설명: 기본 음색마다 문장이 되고 숫자는 굵게', async () => {
  const { describePatch } = await import('../src/patch.js');
  const { factoryById } = await import('../src/presets.js');
  const text = (id) => describePatch(factoryById(id).patch).map((x) => x.text).join('');
  assert.equal(text('worship-pad'), '따뜻한 패드예요. 1.4초에 걸쳐 천천히 커지고, 넓은 홀처럼 울려요. 손을 떼면 3.2초 동안 남아요. 밝기가 숨 쉬듯 천천히 변해요.');
  assert.match(text('dx-ep'), /누르자마자 소리가 나고.*2\.8초쯤이면 잦아들어요/);
  assert.match(text('acoustic-guitar'), /줄 뜯는 소리예요/);
  for (const f of FACTORY) {
    const parts = describePatch(f.patch);
    assert.ok(parts.some((x) => x.strong), f.patch.name);
    assert.ok(!parts.map((x) => x.text).join('').includes('undefined'), f.patch.name);
  }
});

test('기본 음색 id·쓰임새', async () => {
  const { USES } = await import('../src/presets.js');
  assert.equal(new Set(FACTORY.map((f) => f.id)).size, FACTORY.length);
  const ok = new Set(USES.map((u) => u.id));
  for (const f of FACTORY) {
    assert.ok(f.desc.length > 10, f.id);
    assert.ok(f.uses.length && f.uses.every((u) => ok.has(u) && u !== 'all'), f.id);
  }
});
