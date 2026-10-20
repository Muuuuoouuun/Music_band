import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TONE_BANDS, FLAT_TONE, THIRDS, biquadDb, toneResponse, analyzeTone, withTone, matchMoves, addMoves,
  wordMoves, TONE_WORDS, rangeText, isFlat,
} from '../src/tone.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b}`);
const word = (id) => TONE_WORDS.find((w) => w.id === id);

test('대역 6개가 40 Hz~16 kHz 를 빈틈없이 잇고, 이름표는 시안과 같다', () => {
  assert.equal(TONE_BANDS[0].lo, 40);
  assert.equal(TONE_BANDS.at(-1).hi, 16000);
  for (let i = 1; i < TONE_BANDS.length; i++) assert.equal(TONE_BANDS[i].lo, TONE_BANDS[i - 1].hi);
  assert.deepEqual(TONE_BANDS.map(rangeText), ['40–120 Hz', '120–300 Hz', '300–800 Hz', '0.8–2.5 kHz', '2.5–6 kHz', '6–16 kHz']);
});

test('필터 응답: 피킹은 가운데에서 그 dB, 선반은 멀리서 그 dB, 로우컷은 차단 주파수에서 −3 dB', () => {
  near(biquadDb('peaking', 490, 0.98, 6, [490])[0], 6, 0.01);
  near(biquadDb('peaking', 490, 0.98, 6, [60])[0], 0, 0.3);
  near(biquadDb('lowshelf', 100, Math.SQRT1_2, -6, [25])[0], -6, 0.3);
  near(biquadDb('lowshelf', 100, Math.SQRT1_2, -6, [100])[0], -3, 0.05);
  near(biquadDb('highshelf', 7000, Math.SQRT1_2, 6, [16000])[0], 6, 0.6);
  near(biquadDb('highpass', 120, Math.SQRT1_2, 0, [120])[0], -3.01, 0.05);
  near(biquadDb('highpass', 120, Math.SQRT1_2, 0, [30])[0], -24, 1);
  assert.ok(toneResponse(FLAT_TONE, [50, 500, 5000]).every((d) => d === 0));
  assert.ok(isFlat(FLAT_TONE));
  assert.ok(!isFlat({ ...FLAT_TONE, lowcut: 120 }));
});

/** 사인 여러 개를 섞은 시험 소리 */
function tones(parts, sr = 44100, seconds = 2) {
  const x = new Float32Array(sr * seconds);
  for (const [f, a] of parts) for (let i = 0; i < x.length; i++) x[i] += a * Math.sin((2 * Math.PI * f * i) / sr);
  return x;
}

test('재기: 1 kHz 사인은 몸통 대역에 다 들어가고 밝기 중심이 1 kHz', () => {
  const r = analyzeTone([tones([[1000, 0.5]])], 44100);
  near(r.bands[3], 0, 0.1, '몸통');
  assert.ok(r.bands[0] < -40 && r.bands[5] < -40);
  near(r.centroid, 1000, 15);
  near(r.third[THIRDS.indexOf(1000)], 0, 0.2);
  near(r.rms, 0.5 / Math.SQRT2, 0.01);
});

test('재기: 크기와 상관없이 같은 균형, 두 대역이 반씩이면 −3 dB 씩', () => {
  const a = analyzeTone([tones([[200, 0.4], [3000, 0.4]])], 44100);
  const b = analyzeTone([tones([[200, 0.04], [3000, 0.04]])], 44100);
  assert.deepEqual([a.bands[1], a.bands[4], a.centroid], [b.bands[1], b.bands[4], b.centroid]);
  near(a.bands[1], -3, 0.2, '저음');
  near(a.bands[4], -3, 0.2, '명료함');
});

test('톤 거친 균형: 평평하면 그대로, 한 대역을 올리면 그 대역 몫이 커지고 전체 크기도 커진다', () => {
  const m = analyzeTone([tones([[200, 0.4], [3000, 0.4]])], 44100);
  const flat = withTone(m, FLAT_TONE);
  assert.deepEqual(flat.bands, m.bands);
  near(flat.shift, 0, 1e-9);
  const up = withTone(m, { ...FLAT_TONE, clarity: 6 });
  assert.ok(up.bands[4] > m.bands[4] + 1.5);
  assert.ok(up.bands[1] < m.bands[1] - 1.5);
  assert.ok(up.gain > 1.2 && up.shift > 1.5);
  // 그림용 abs 는 노브를 돌린 만큼 그 띠가 움직인다
  const i = THIRDS.indexOf(4000);
  near(up.abs[i] - m.third[i], 6, 0.6);
});

test('레퍼런스에 맞추기: 차이 × 40%, 0.5 dB 미만은 그대로, 대역마다 최대 6 dB (시안 숫자)', () => {
  const ref = [-4.0, -7.3, -5.4, -12.7, -11.8, -20.8];
  const pad = [-7.6, -2.4, -7.4, -12.1, -23.6, -44.2];
  const m = matchMoves(ref, pad, 0.4);
  assert.deepEqual(m.map((x) => x.diff), [3.6, -4.9, 2, -0.6, 11.8, 23.4]);
  assert.deepEqual(m.map((x) => x.move), [1.4, -2, 0.8, 0, 4.7, 6]);
  assert.deepEqual(m.map((x) => x.capped), [false, false, false, false, false, true]);
  assert.ok(matchMoves(ref, pad, 0).every((x) => x.move === 0));
  const t = addMoves({ ...FLAT_TONE, air: 9 }, Object.fromEntries(m.map((x) => [x.id, x.move])));
  assert.equal(t.air, 12); // 노브 끝에서 멈춤
  assert.equal(t.clarity, 4.7);
  assert.equal(t.lowcut, FLAT_TONE.lowcut);
});

test('말로 맞추기: 레퍼런스가 없으면 기본만큼, 있으면 실제로 많은 대역만 차이의 절반쯤', () => {
  const plain = wordMoves(word('less-muddy'));
  assert.deepEqual(plain.moves, { bass: -3, mud: -3 });
  assert.match(plain.summary, /저음 −3 dB · 먹먹함 −3 dB/);
  // 시안: 300–800 Hz 는 레퍼런스보다 적고, 120–300 Hz 가 4.9 dB 많다 → 저음만 내린다
  const now = [-7.6, -2.4, -7.4, -12.1, -23.6, -44.2];
  const ref = [-4.0, -7.3, -5.4, -12.7, -11.8, -20.8];
  const r = wordMoves(word('less-muddy'), { now, ref });
  assert.deepEqual(r.moves, { bass: -2.5 });
  const text = r.reason.map((x) => x.text).join('');
  assert.match(text, /저음\(120–300 Hz\)은 지금 −2\.4 dB, 레퍼런스는 −7\.3 dB — 4\.9 dB 많아요/);
  assert.match(text, /먹먹함\(300–800 Hz\)은 .*그대로/);
  assert.ok(r.reason.some((x) => x.strong));
  // 레퍼런스보다 이미 밝으면 '더 반짝이게'도 기본만큼만
  const bright = wordMoves(word('sparkle'), { now: [0, 0, 0, 0, 0, -10], ref: [0, 0, 0, 0, 0, -30] });
  assert.deepEqual(bright.moves, { air: 3 });
  assert.match(bright.reason.map((x) => x.text).join(''), /이미 비슷/);
  // 밴드 안에서: 로우컷과 잔향도 말해 준다
  assert.match(wordMoves(word('room-bass')).summary, /로우컷 120 Hz/);
  assert.match(wordMoves(word('wider')).summary, /코러스/);
});
