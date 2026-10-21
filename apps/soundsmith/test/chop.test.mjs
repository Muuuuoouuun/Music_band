import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOnsets, gridStarts, slicesFrom, nearestZero, estimateTempo, timeStretch, holdDecimate, demoBeat, firstSound } from '../src/chop.js';
import { stepBeat, starterPattern, replayPattern, defaultPad, PAD_COUNT, STEPS } from '../src/pads.js';

test('데모 비트: 2마디, 첫 소리가 0, 시작점을 16개까지 찾고 순서대로', () => {
  const d = demoBeat(44100, 90);
  assert.equal(d.length, Math.round(44100 * (60 / 90) * 8));
  const on = detectOnsets(d.data, d.sr, { max: 16 });
  assert.ok(on.length >= 12 && on.length <= 16, `${on.length}`);
  assert.equal(on[0], firstSound(d.data));
  assert.deepEqual(on, [...on].sort((a, b) => a - b));
  // 첫 스네어(2박 = 0.667초) 근처에 시작점이 있다
  assert.ok(on.some((i) => Math.abs(i / 44100 - 0.667) < 0.03));
});

test('BPM 추정: 72·90·118·128 을 1 BPM 안으로', () => {
  for (const bpm of [72, 90, 118, 128]) {
    const d = demoBeat(44100, bpm);
    const t = estimateTempo(d.data.subarray(0, d.length), d.sr);
    assert.ok(Math.abs(t.bpm - bpm) < 1, `${bpm} → ${t.bpm}`);
  }
});

test('자르기: 격자·조각·0 지점', () => {
  assert.deepEqual(gridStarts(1600, 4), [0, 400, 800, 1200]);
  assert.deepEqual(slicesFrom([800, 0, 400, 400, 5000], 1600), [{ start: 0, end: 400 }, { start: 400, end: 800 }, { start: 800, end: 1600 }]);
  const x = Float32Array.from({ length: 400 }, (_, i) => Math.sin((2 * Math.PI * i) / 100));
  const z = nearestZero(x, 130);
  assert.ok(x[z - 1] <= 0 && x[z] > 0 && Math.abs(z - 130) <= 30);
});

test('길이 바꾸기(WSOLA): 길이는 factor 배, 음 높이는 그대로', () => {
  const sr = 8000;
  const x = Float32Array.from({ length: sr }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / sr));
  const y = timeStretch(x, 1.25);
  assert.equal(y.length, Math.round(sr * 1.25));
  // 0 지점 사이 간격으로 주기를 재면 여전히 200 Hz
  let crossings = 0;
  for (let i = 2000; i < 8000; i++) if (y[i - 1] <= 0 && y[i] > 0) crossings++;
  assert.ok(Math.abs(crossings / (6000 / sr) - 200) < 6, `${crossings / (6000 / sr)} Hz`);
  assert.deepEqual(Array.from(timeStretch(x.subarray(0, 10), 1)), Array.from(x.subarray(0, 10)));
});

test('샘플레이트 낮추기: 칸마다 값을 잡아 둔다', () => {
  assert.deepEqual(Array.from(holdDecimate(Float32Array.from([1, 2, 3, 4, 5, 6]), 2)), [1, 1, 3, 3, 5, 5]);
  const same = Float32Array.from([1, 2]);
  assert.equal(holdDecimate(same, 1), same);
});

test('패턴: 스윙은 16분 두 개 중 뒤를 늦추고, 원래 순서대로는 조각을 제자리에', () => {
  assert.equal(stepBeat(0, 0.66), 0);
  assert.equal(stepBeat(1, 0.5), 0.25);
  assert.equal(stepBeat(1, 0.66), 0.33);
  assert.equal(stepBeat(4, 0.66), 1);
  const s = starterPattern();
  assert.equal(s.length, PAD_COUNT);
  assert.ok(s.every((r) => r.length === STEPS));
  assert.equal(s[1][4], 2);
  const sr = 44100;
  const step = (60 / 90 / 4) * sr;
  const pads = [0, 4, 6, 20].map((k) => defaultPad({ start: Math.round(k * step), end: Math.round((k + 2) * step) }));
  const r = replayPattern(pads, sr, 90);
  assert.equal(r[0][0], 2);
  assert.equal(r[1][4], 2);
  assert.equal(r[2][6], 1);
  assert.ok(r[3].every((v) => v === 0), '첫 마디 밖은 넣지 않음');
});
