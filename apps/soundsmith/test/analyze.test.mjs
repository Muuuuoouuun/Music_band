import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fft, analyzeAudio, measureEnvelope, fitGraphicEq, peakingDb, matchTarget, similarity, planPatch, patchFromTone,
  paulstretch, suggestRegions, bandLevels, averagePower, lowpassMag, patchTraits,
} from '../src/analyze.js';
import { MATCH_BANDS, CUSTOM_LEN, normalizePatch } from '../src/patch.js';
import { FACTORY } from '../src/presets.js';
import { reversed, withFades } from '../src/sample.js';

const SR = 44100;

/** 시험용 소리: 배음 표·엔벨로프·비브라토·잡음·늘어난 배음·좌우 폭을 고를 수 있다 */
function tone({ f0 = 220, sec = 2.5, harm = (k) => 1 / k, a = 0.01, s = 0.8, d = 0.3, rel = 0.3, vib = 0, vibRate = 5.5, noise = 0, inh = 0, noteEnd = 2, side = 0, seed = 3 } = {}) {
  const n = Math.round(sec * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const ph = new Float64Array(41);
  let st = seed;
  const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = t < a ? t / a : s + (1 - s) * Math.exp(-(t - a) / (d / 4));
    if (t > noteEnd) env *= Math.exp(-(t - noteEnd) / (rel / 5));
    const f = f0 * 2 ** ((vib * Math.sin(2 * Math.PI * vibRate * t)) / 1200);
    let v = 0;
    for (let k = 1; k <= 40; k++) {
      const fk = f * k * Math.sqrt(1 + inh * k * k);
      if (fk > SR / 2) break;
      ph[k] += fk / SR;
      v += harm(k) * Math.sin(2 * Math.PI * ph[k]);
    }
    const x = (0.2 * v + noise * 0.2 * rnd()) * env;
    const wobble = side * Math.sin(2 * Math.PI * 0.7 * t);
    L[i] = x * (1 + wobble);
    R[i] = x * (1 - wobble);
  }
  return [L, R];
}

test('FFT: 사인 하나는 그 칸에만, 역변환하면 원래대로', () => {
  const n = 1024;
  const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 37 * i) / n));
  const im = new Float64Array(n);
  const keep = Float64Array.from(re);
  fft(re, im);
  const mag = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
  assert.equal(mag.indexOf(Math.max(...mag)), 37);
  assert.ok(Math.abs(mag[37] - n / 2) < 1e-6);
  fft(re, im, true);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(re[i] - keep[i]) < 1e-9);
});

test('배음 재기: 톱니는 1/k, 사각은 홀수 배음만', () => {
  const saw = analyzeAudio(tone(), SR);
  assert.equal(saw.kind, 'tone');
  assert.ok(Math.abs(saw.pitch.hz - 220) < 1);
  for (let k = 1; k <= 8; k++) assert.ok(Math.abs(saw.harmonics[k - 1] - 1 / k) < 0.03, `k=${k} ${saw.harmonics[k - 1]}`);
  const sq = analyzeAudio(tone({ harm: (k) => (k % 2 ? 1 / k : 0) }), SR);
  for (let k = 2; k <= 10; k += 2) assert.ok(sq.harmonics[k - 1] < 0.02, `even k=${k} ${sq.harmonics[k - 1]}`);
  assert.ok(Math.abs(sq.harmonics[2] - 1 / 3) < 0.03);
  assert.ok(saw.harmonicity > 0.95 && saw.inharmonicity < 0.002);
});

test('엔벨로프: 느린 어택 패드와 줄어드는 줄', () => {
  const pad = analyzeAudio(tone({ a: 0.8, s: 0.9 }), SR).envelope;
  assert.ok(pad.attack > 0.5 && pad.attack < 1, `attack ${pad.attack}`);
  assert.ok(pad.sustain > 0.8, `sustain ${pad.sustain}`);
  const pluck = analyzeAudio(tone({ a: 0.002, s: 0, d: 1.2, noteEnd: 9 }), SR).envelope;
  assert.equal(pluck.sustain, 0);
  assert.ok(pluck.attack < 0.02);
  assert.ok(Math.abs(pluck.decay - 1.2) < 0.35, `decay ${pluck.decay}`);
  // 구간 안에서 손을 떼면 릴리즈를 잰다 (시간 상수 r/5)
  const held = analyzeAudio(tone({ noteEnd: 1.2, rel: 0.4, sec: 2.2 }), SR).envelope;
  assert.ok(held.releaseMeasured && Math.abs(held.release - 0.4) < 0.15, `release ${held.release}`);
  assert.equal(measureEnvelope(new Float32Array(50), 0.01), null);
});

test('활로 켠 소리: 첫 순간만 솟고 이어지는 소리는 줄어드는 줄로 보지 않는다', () => {
  // 해금처럼 활이 닿는 순간 솟았다가 절반쯤으로 이어짐
  const bow = analyzeAudio(tone({ a: 0.004, s: 0.4, d: 0.1, noteEnd: 9, sec: 2 }), SR);
  assert.ok(bow.envelope.sustain > 0.3, `sustain ${bow.envelope.sustain}`);
  assert.ok(Object.values(bow.envelope).every((v) => v == null || typeof v === 'boolean' || Number.isFinite(v)));
  assert.ok(Number.isFinite(similarity(analyzeAudio(tone(), SR), bow).score));
});

test('MIDI 음 힌트: 같은 음 이름이면 옥타브를 바로잡고, 다른 음 이름이면 들린 높이를 믿는다', () => {
  // 기음이 없고 홀수 배음이 약한 220Hz → 혼자 재면 440Hz 로 들린다
  const s = tone({ harm: (k) => (k === 1 ? 0 : k % 2 ? 0.3 / k : 1 / k) });
  assert.ok(Math.abs(analyzeAudio(s, SR).pitch.hz - 440) < 2);
  const fixed = analyzeAudio(s, SR, { pitchHint: 220 }).pitch;
  assert.ok(Math.abs(fixed.hz - 220) < 1 && fixed.corrected, JSON.stringify(fixed));
  // 가상악기 샘플이 건반과 다른 음으로 울리는 경우(징 등): 음 이름이 다르면 힌트를 쓰지 않는다
  assert.ok(Math.abs(analyzeAudio(s, SR, { pitchHint: 311.13 }).pitch.hz - 440) < 2);
  // 짝수 배음만 있는 소리는 한 옥타브 위가 맞는 높이
  assert.ok(Math.abs(analyzeAudio(tone({ harm: (k) => (k % 2 ? 0 : 1 / k) }), SR).pitch.hz - 440) < 2);
});

test('비브라토·잡음·늘어난 배음·좌우 폭', () => {
  const vib = analyzeAudio(tone({ vib: 30, vibRate: 5.5 }), SR);
  assert.ok(vib.vibrato && Math.abs(vib.vibrato.rate - 5.5) < 0.4 && Math.abs(vib.vibrato.depth - 30) < 10, JSON.stringify(vib.vibrato));
  assert.equal(analyzeAudio(tone(), SR).vibrato, null);
  const breathy = analyzeAudio(tone({ harm: (k) => (k === 1 ? 1 : 0), noise: 0.15 }), SR);
  const clean = analyzeAudio(tone({ harm: (k) => (k === 1 ? 1 : 0) }), SR);
  assert.ok(breathy.noiseLevel > clean.noiseLevel * 20, `${breathy.noiseLevel} vs ${clean.noiseLevel}`);
  const piano = analyzeAudio(tone({ f0: 110, inh: 0.0008, a: 0.002, s: 0, d: 2.5, noteEnd: 9 }), SR);
  assert.ok(piano.inharmonicity > 0.005, `inh ${piano.inharmonicity}`);
  const wide = analyzeAudio(tone({ side: 0.5 }), SR);
  assert.ok(wide.width > 0.2 && clean.width < 0.01);
});

test('한 음 다시 합성: 배음 표·엔벨로프·비브라토가 음색으로 옮겨진다', () => {
  const a = analyzeAudio(tone({ a: 0.5, s: 0.85, vib: 25, harm: (k) => 1 / k ** 1.3 }), SR);
  const { patch, notes, render } = patchFromTone(a, { name: '시험' });
  assert.equal(patch.osc[0].wave, 'custom');
  assert.equal(patch.custom.length, CUSTOM_LEN);
  assert.ok(patch.custom[0] > 0.9 && patch.custom[1] < patch.custom[0]);
  assert.ok(Math.abs(patch.ampEnv.a - 0.5) < 0.2);
  assert.equal(patch.lfo.target, 'pitch');
  assert.ok(Math.abs(patch.lfo.depth * 50 - 25) < 10);
  assert.deepEqual(render, [57]);
  assert.ok(notes.length >= 2);
  assert.deepEqual(normalizePatch(patch), patch);
});

test('화음·믹스: 가장 닮은 기본 음색에서 출발', () => {
  // 세 음(C·E·G)을 동시에 → 화음
  const ch = [0, 4, 7].map((st) => tone({ f0: 261.63 * 2 ** (st / 12), seed: st + 1 }));
  const mix = [new Float32Array(ch[0][0].length), new Float32Array(ch[0][0].length)];
  for (const [l, r] of ch) for (let i = 0; i < l.length; i++) { mix[0][i] += l[i] / 3; mix[1][i] += r[i] / 3; }
  const a = analyzeAudio(mix, SR);
  assert.notEqual(a.kind, 'tone');
  assert.ok([0, 4, 7].every((pc) => a.strongPcs.includes(pc)), `pcs ${a.strongPcs}`);
  const plan = planPatch(a, FACTORY, { name: '화음 시험' });
  assert.equal(plan.mode, 'nearest');
  assert.ok(FACTORY.some((f) => f.patch.name === plan.from));
  assert.ok(plan.render.length >= 2 && plan.render.every((m) => m >= 24 && m <= 96));
  for (const f of FACTORY) {
    const t = patchTraits(f.patch);
    assert.ok(Object.values(t).every(Number.isFinite), f.patch.name);
  }
});

test('맞춤 EQ: 겹친 띠의 실제 응답이 목표에 1dB 안으로', () => {
  const target = [3, 6, 0, -4, -8, 0, 5, 5, -9, 2];
  const g = fitGraphicEq(target);
  const resp = MATCH_BANDS.map((f) => MATCH_BANDS.reduce((s, fc, j) => s + peakingDb(f, fc, g[j], 1.41, SR), 0));
  resp.forEach((r, i) => assert.ok(Math.abs(r - target[i]) < 1, `band ${i}: ${r} vs ${target[i]}`));
  // 같은 톤 균형이면 맞춤 EQ 는 0, 아주 작은 띠는 건드리지 않는다
  assert.deepEqual(matchTarget([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).map(Math.abs), new Array(10).fill(0));
  const t = matchTarget([-60, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, -6, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(t[0], t[0] && 0 + t[0]);
  assert.ok(Math.abs(t[0]) < 3 && t[1] > 2);
  assert.ok(lowpassMag(100, 1000, 0.7, SR) > 0.99 && lowpassMag(4000, 1000, 0.7, SR) < 0.1);
});

test('톤 균형: 밝은 소리는 높은 띠가 크다', () => {
  const [bright] = tone({ harm: (k) => 1 / k ** 0.5 });
  const [dark] = tone({ harm: (k) => 1 / k ** 2.5 });
  const n = 4096;
  const b = bandLevels(averagePower(bright, 0, bright.length, n), SR, n);
  const d = bandLevels(averagePower(dark, 0, dark.length, n), SR, n);
  assert.ok(b[7] > d[7] + 10, `4k ${b[7]} vs ${d[7]}`);
});

test('닮은 정도: 같은 소리 100, 다른 소리는 낮게', () => {
  const a = analyzeAudio(tone(), SR);
  assert.equal(similarity(a, a).score, 100);
  const other = analyzeAudio(tone({ a: 0.8, harm: (k) => (k % 2 ? 1 / k ** 2 : 0), side: 0.6 }), SR);
  assert.ok(similarity(a, other).score < 75, `${similarity(a, other).score}`);
});

test('늘리기(Paulstretch): 길이 ×배, 음높이 그대로, 숫자 안 깨짐', () => {
  const [x] = tone({ sec: 1.5, harm: (k) => (k === 1 ? 1 : 0), f0: 330 });
  const y = paulstretch(x, SR, 4);
  assert.equal(y.length, Math.round(x.length * 4));
  assert.ok(y.every(Number.isFinite));
  const a = analyzeAudio([y], SR, { start: SR, end: 4 * SR });
  assert.ok(a.pitch && Math.abs(a.pitch.hz - 330) < 3, `${a.pitch?.hz}`);
});

test('구간 추천: 고르게 이어지는 부분을 고르고 서로 겹치지 않는다', () => {
  const n = SR * 12;
  const x = new Float32Array(n);
  let st = 9;
  const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // 0~6초: 박자마다 튀는 소리, 6~12초: 고른 지속음
    x[i] = t < 6 ? rnd() * Math.exp(-((t % 0.5) * 12)) * 0.5 : 0.3 * Math.sin(2 * Math.PI * 220 * t);
  }
  const regions = suggestRegions(x, SR, { count: 3 });
  assert.ok(regions[0].start >= 6 * SR - 1, `first ${regions[0].start / SR}`);
  for (let i = 1; i < regions.length; i++) assert.ok(Math.abs(regions[i].start - regions[0].start) >= 2.5 * SR - SR * 0.05);
});

test('리버스·페이드', () => {
  const x = Float32Array.from([1, 2, 3, 4]);
  assert.deepEqual([...reversed(x)], [4, 3, 2, 1]);
  const f = withFades(new Float32Array(1000).fill(1), 1000, 100, 100);
  assert.ok(f[0] === 0 && f[999] < 0.02 && f[500] === 1);
});
