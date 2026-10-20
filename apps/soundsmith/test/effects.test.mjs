import test from 'node:test';
import assert from 'node:assert/strict';
import { impulseData, effectTail } from '../src/engine.js';
import { decayRt60, tailStats } from '../src/analyze.js';
import { normalizePatch, dryPatch, REVERB_TYPES, DELAY_MODES, PARAMS } from '../src/patch.js';
import { encodeWavChannels } from '../src/sample.js';

const SR = 22050;
const monoOf = ([l, r]) => Float32Array.from(l, (v, i) => (v + r[i]) / 2);
const energy = (x, a = 0, b = x.length) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return e;
};
/** 봉우리의 −20dB 에 처음 닿는 때 (5ms 창) */
const riseTime = (x) => {
  const hop = Math.round(SR * 0.005);
  const env = [];
  for (let i = 0; i + hop < x.length; i += hop) env.push(energy(x, i, i + hop));
  const top = Math.max(...env);
  return env.findIndex((v) => v > top / 100) * 0.005;
};

test('잔향 종류마다: 숫자 깨짐 없음, 크기 같음, RT60 ≈ 길이 × 0.8', () => {
  for (const { id } of REVERB_TYPES) {
    const ir = impulseData(SR, 2.5, { type: id });
    assert.equal(ir.length, 2);
    assert.equal(ir[0].length, Math.round(SR * 2.5));
    assert.ok(ir.every((c) => c.every(Number.isFinite)), id);
    assert.ok(Math.abs((energy(ir[0]) + energy(ir[1])) / 2 - 1) < 1e-3, `${id} 에너지`);
    const rt = decayRt60(monoOf(ir), SR);
    assert.ok(rt > 2.0 * 0.75 && rt < 2.0 * 1.25, `${id} RT60 ${rt}`);
  }
});

test('잔향 종류는 첫소리가 다르다: 플레이트 < 룸 < 홀 < 교회, 앰비언트는 천천히 부풂', () => {
  const rise = Object.fromEntries(REVERB_TYPES.map(({ id }) => [id, riseTime(monoOf(impulseData(SR, 2.5, { type: id })))]));
  assert.ok(rise.plate < rise.hall && rise.room < rise.hall && rise.hall < rise.church, JSON.stringify(rise));
  assert.ok(rise.ambient > rise.hall, JSON.stringify(rise));
});

test('고역 감쇠를 올리면 꼬리 뒤쪽의 높은 소리가 줄어든다', () => {
  const highShare = (damp) => {
    const sr = 44100;
    const x = monoOf(impulseData(sr, 2.5, { damp }));
    // 한 칸 차분 = 높은 소리 강조. 꼬리 뒤쪽(1초~)에서 차분 에너지 / 전체 에너지
    const from = sr;
    let hi = 0;
    for (let i = from + 1; i < x.length; i++) hi += (x[i] - x[i - 1]) ** 2;
    return hi / energy(x, from);
  };
  assert.ok(highShare(1) < highShare(0) * 0.5, `${highShare(1)} vs ${highShare(0)}`);
});

test('스프링: 일정한 간격으로 되풀이되는 띠잉', () => {
  const x = monoOf(impulseData(SR, 2, { type: 'spring' }));
  const period = 0.033;
  let on = 0;
  let off = 0;
  for (let n = 2; n < 20; n++) {
    const at = Math.round((0.002 + n * period) * SR);
    on += energy(x, at, at + Math.round(0.012 * SR));
    const mid = Math.round((0.002 + (n + 0.55) * period) * SR);
    off += energy(x, mid, mid + Math.round(0.012 * SR));
  }
  assert.ok(on > off * 1.5, `${on} vs ${off}`);
});

test('홀·고역 감쇠 0.5 는 예전 잔향과 똑같다 (기본 음색 소리가 바뀌지 않음)', () => {
  const legacy = (sampleRate, seconds, seed = 11) => {
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    const len = Math.round(sampleRate * seconds);
    const pre = Math.round(sampleRate * 0.018);
    const rt60 = seconds * 0.8;
    const chs = [];
    for (let c = 0; c < 2; c++) {
      const d = new Float32Array(len);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sampleRate;
        const fc = 1200 + 7800 * Math.exp(-t / (rt60 * 0.25));
        const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
        lp += (rnd() - lp) * a;
        const onset = Math.min(1, t / 0.025);
        d[i] = lp * Math.exp((-6.9 * t) / rt60) * onset * onset * (1.6 + 2.4 * (1 - a));
      }
      for (let k = 0; k < 7; k++) {
        const tt = 0.008 + 0.072 * ((rnd() + 1) / 2);
        const i = pre + Math.round(tt * sampleRate);
        if (i < len) d[i] += 0.5 * rnd() * Math.exp(-tt * 14);
      }
      chs.push(d);
    }
    let e = 0;
    for (const d of chs) for (let i = 0; i < len; i++) e += d[i] * d[i];
    const g = 1 / Math.sqrt(e / 2 || 1);
    for (const d of chs) for (let i = 0; i < len; i++) d[i] *= g;
    return chs;
  };
  const now = impulseData(SR, 2, { type: 'hall', damp: 0.5 });
  const old = legacy(SR, 2);
  for (let c = 0; c < 2; c++) for (let i = 0; i < old[c].length; i += 97) assert.ok(Math.abs(now[c][i] - old[c][i]) < 1e-6);
});

test('RT60 재기: 알고 있는 감쇠의 잡음', () => {
  for (const rt of [0.6, 1.5, 3]) {
    let s = 3;
    const x = Float32Array.from({ length: Math.round(SR * rt * 1.4) }, (_, i) => ((((s = (s * 1664525 + 1013904223) >>> 0) / 2147483648) - 1) * Math.exp((-6.9 * i) / SR / rt)));
    const got = decayRt60(x, SR);
    assert.ok(Math.abs(got - rt) / rt < 0.1, `${rt} → ${got}`);
  }
  assert.equal(decayRt60(new Float32Array(SR), SR), null);
});

test('꼬리 재기: 젖은 소리의 시작·크기·좌우 번갈아 반복', () => {
  const n = SR * 2;
  const dry = [new Float32Array(n), new Float32Array(n)];
  const full = [new Float32Array(n), new Float32Array(n)];
  const start = 0.01;
  const burst = Math.round(SR * 0.005);
  for (let i = 0; i < burst; i++) {
    const v = Math.sin((Math.PI * i) / burst) ** 2 * 0.5;
    for (const ch of [...dry, ...full]) ch[Math.round(start * SR) + i] += v;
  }
  // 0.3초마다 반쯤 줄어드는 반복, 왼쪽·오른쪽 번갈아
  for (let k = 1; k <= 4; k++) {
    const at = Math.round((start + 0.3 * k) * SR);
    const side = k % 2 ? 0 : 1;
    for (let i = 0; i < burst; i++) full[side][at + i] += Math.sin((Math.PI * i) / burst) ** 2 * 0.5 * 0.5 ** k;
  }
  const st = tailStats(full, dry, SR, { start });
  assert.ok(Math.abs(st.onset - 0.3) < 0.01, `onset ${st.onset}`);
  assert.ok(st.wetDb < 0 && st.wetDb > -12, `wetDb ${st.wetDb}`);
  assert.ok(st.echoes.length >= 3, `echoes ${st.echoes.length}`);
  st.echoes.slice(0, 3).forEach((e, i) => {
    assert.ok(Math.abs(e.t - 0.3 * (i + 1)) < 0.01);
    assert.ok(i % 2 === 0 ? e.left > e.right + 20 : e.right > e.left + 20);
  });
  const none = tailStats(dry, dry, SR, { start });
  assert.ok(none.silent && none.rt60 === null && none.echoes.length === 0);
});

test('이펙트 빼기(A/B)와 꼬리 시간', () => {
  const p = normalizePatch({ osc: [{ wave: 'vocal', unison: 3 }], fx: { reverb: 0.6, delay: 0.4, shimmer: 0.5, drive: 0.3, lofi: 0.2, width: 1.6 }, eq: { low: 4, match: Array(10).fill(3) } });
  const d = dryPatch(p);
  assert.equal(d.fx.reverb + d.fx.delay + d.fx.shimmer + d.fx.drive + d.fx.lofi + d.fx.comp, 0);
  assert.equal(d.fx.width, 1);
  assert.ok(d.eq.match.every((v) => v === 0) && d.eq.low === 0);
  assert.deepEqual(d.osc, p.osc);
  assert.deepEqual(normalizePatch(d), d);
  assert.ok(Math.abs(effectTail(normalizePatch({ fx: { reverb: 0.5, size: 4, predelay: 0.1 } }).fx) - (0.1 + 4.2 + 0.15)) < 1e-9);
  assert.equal(effectTail(normalizePatch({ fx: { reverb: 0, delay: 0 } }).fx), 0.15);
  assert.ok(effectTail(normalizePatch({ fx: { reverb: 0, delay: 0.5, feedback: 0.9, delayBeats: 1 } }).fx) <= 10);
  assert.deepEqual(PARAMS['fx.delayMode'].values, DELAY_MODES.map((m) => m.id));
});

test('스테레오 WAV: 머리글과 좌우 번갈아 담기', () => {
  const w = encodeWavChannels([Float32Array.from([1, -1]), Float32Array.from([0.5, 0])], 44100);
  const v = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(28, true), 44100 * 4);
  assert.equal(v.getUint32(40, true), 8);
  assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)], [32767, 16384, -32768, 0]);
});
