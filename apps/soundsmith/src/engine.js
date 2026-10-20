// 소리 엔진: 브라우저 기본 Web Audio 노드만 쓴다 (워클릿·외부 라이브러리 없음).
//
//   음 하나(voice) ─ 오실레이터 ×겹치기(아날로그 흔들림) ─┐                ┌ 트레몰로 ─ 볼륨 엔벨로프 ─┐
//                  FM 변조기 ─→ 주파수                   ├─ 필터 12/24dB ─┘                            │
//                  노이즈 / 줄 / 샘플 ───────────────────┘  ↑ 필터 엔벨로프·LFO·세기                     │
//                  어택 소리(해머·숨) ───────────────────────────────────────────────────────────────────┤
//                  옥타브 위 복사본 ─→ 쉬머(잔향으로만)                                                  │
//   악기(instrument) ← 음들 ─ 드라이브 ─ 로파이 ─ 페이저 ─ 코러스 ─┬─ 그대로 ────────────┐            ←─┘
//                                                                ├─ 딜레이(박에 맞춤) ──┤
//                                                                └─ 프리딜레이 ─ 잔향 ─┴─ EQ 3밴드 ─ 맞춤 EQ ─ 컴프 ─ 스테레오 폭 ─ 볼륨
//   스튜디오 버스 ─ 리미터 ─ 마스터 ─ 분석기(오실로스코프) ─ 스피커
//
// 루퍼 트랙마다 악기를 하나씩 따로 만들어 서로 다른 음색이 동시에 울린다.
// 같은 Instrument 를 OfflineAudioContext 에 만들면 '지금 음색을 샘플로 굽기'·'음원 따라 만들기'의 비교 렌더가 된다.
import { HARMONICS, MATCH_BANDS, envLevel } from './patch.js';
import { makeTuner } from './tuning.js';
import { makeRng } from './rng.js';

const MAX_VOICES = 16;
const clampHz = (f) => Math.min(20000, Math.max(20, f));

// 잔향 종류별 성격. pre: 첫소리까지, attack: 차오르는 시간, bright→dark: 시간이 갈수록 어두워지는 고역 차단,
// dampTime: 어두워지는 속도(RT60 대비), early: 첫 반사(개수·구간·세기·줄어듦), spring: 용수철 반복, mod: 출렁임.
// 홀은 AirChoir audio.js 와 같은 식 (고역 감쇠 0.5 에서 예전 잔향과 똑같다).
const REVERB_SHAPES = {
  room: { pre: 0.004, attack: 0.006, bright: 7000, dark: 1500, dampTime: 0.3, early: { count: 14, from: 0.002, span: 0.033, level: 0.7, decay: 30 } },
  hall: { pre: 0.018, attack: 0.025, bright: 9000, dark: 1200, dampTime: 0.25, early: { count: 7, from: 0.008, span: 0.072, level: 0.5, decay: 14 } },
  church: { pre: 0.03, attack: 0.08, bright: 6000, dark: 700, dampTime: 0.2, early: { count: 5, from: 0.02, span: 0.1, level: 0.35, decay: 8 } },
  plate: { pre: 0.001, attack: 0.002, bright: 12000, dark: 3500, dampTime: 0.5, early: null },
  spring: { pre: 0.002, attack: 0.003, bright: 5000, dark: 2000, dampTime: 0.6, early: null, noise: 0.45, spring: { period: 0.033, level: 1.6 } },
  ambient: { pre: 0.02, attack: 0.18, bright: 8000, dark: 1500, dampTime: 0.35, early: null, mod: 0.25 },
};

/**
 * 잔향 임펄스: 시간이 갈수록 어두워지는 잡음 꼬리 + 종류별 첫 반사·용수철·출렁임. 좌우는 다른 잡음.
 * seconds: 꼬리 길이 (RT60 은 그 0.8배), damp: 고역 감쇠 0(밝게 오래)..1(빨리 어두워짐).
 * 두 채널 합친 에너지를 1 로 맞춰 종류·길이를 바꿔도 크기가 비슷하다.
 */
export function impulseData(sampleRate, seconds = 2.6, { type = 'hall', damp = 0.5, seed = 11 } = {}) {
  const T = REVERB_SHAPES[type] ?? REVERB_SHAPES.hall;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const len = Math.round(sampleRate * seconds);
  const pre = Math.round(sampleRate * T.pre);
  const rt60 = seconds * 0.8;
  const scale = 2 ** ((0.5 - damp) * 1.6);
  const top = sampleRate * 0.45;
  const bright = Math.min(top, T.bright * scale);
  const dark = Math.min(top, T.dark * scale);
  const channels = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(len);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const fc = dark + (bright - dark) * Math.exp(-t / (rt60 * T.dampTime));
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
      lp += (rnd() - lp) * a;
      const onset = Math.min(1, t / T.attack);
      const swirl = T.mod ? 1 + T.mod * Math.sin(2 * Math.PI * (0.35 + 0.1 * c) * t) : 1;
      d[i] = lp * Math.exp((-6.9 * t) / rt60) * onset * onset * (1.6 + 2.4 * (1 - a)) * swirl * (T.noise ?? 1);
    }
    if (T.early) {
      const e = T.early;
      for (let k = 0; k < e.count; k++) {
        const tt = e.from + e.span * ((rnd() + 1) / 2);
        const i = pre + Math.round(tt * sampleRate);
        if (i < len) d[i] += e.level * rnd() * Math.exp(-tt * e.decay);
      }
    }
    if (T.spring) {
      // 용수철: 높은 소리부터 낮은 소리로 미끄러지는 짧은 처프가 일정한 간격으로 되풀이 (좌우 간격 조금 다르게)
      const period = T.spring.period * (1 + 0.04 * c);
      const dur = Math.round(0.014 * sampleRate);
      for (let n = 1; n * period < seconds; n++) {
        const at = pre + Math.round(n * period * sampleRate);
        const amp = T.spring.level * Math.exp((-6.9 * n * period) / rt60);
        let ph = 0;
        for (let k = 0; k < dur && at + k < len; k++) {
          const u = k / dur;
          ph += (3200 * (300 / 3200) ** u) / sampleRate;
          d[at + k] += amp * Math.sin(2 * Math.PI * ph) * Math.sin(Math.PI * u) ** 2;
        }
      }
      // 용수철은 아주 낮은 소리와 아주 높은 소리를 못 낸다
      let hp = 0;
      let prev = 0;
      let lo = 0;
      const ah = Math.exp((-2 * Math.PI * 150) / sampleRate);
      const al = 1 - Math.exp((-2 * Math.PI * 4500) / sampleRate);
      for (let i = 0; i < len; i++) {
        hp = ah * (hp + d[i] - prev);
        prev = d[i];
        lo += (hp - lo) * al;
        d[i] = lo;
      }
    }
    channels.push(d);
  }
  let e = 0;
  for (const d of channels) for (let i = 0; i < len; i++) e += d[i] * d[i];
  const g = 1 / Math.sqrt(e / 2 || 1);
  for (const d of channels) for (let i = 0; i < len; i++) d[i] *= g;
  return channels;
}

// 같은 잔향은 다시 만들지 않는다 (AudioBuffer 는 컨텍스트끼리 나눠 쓸 수 있다). 미리 연주·비교 렌더가 빨라진다
const irCache = new Map();
export const irKey = (seconds, type = 'hall', damp = 0.5) => `${type}|${Math.round(seconds * 4) / 4}|${Math.round(damp * 10) / 10}`;
function makeIR(ctx, seconds, type = 'hall', damp = 0.5) {
  const key = `${ctx.sampleRate}|${irKey(seconds, type, damp)}`;
  let buf = irCache.get(key);
  if (!buf) {
    const [, sec, dp] = irKey(seconds, type, damp).split('|');
    const data = impulseData(ctx.sampleRate, Number(sec), { type, damp: Number(dp) });
    buf = new AudioBuffer({ length: data[0].length, numberOfChannels: 2, sampleRate: ctx.sampleRate });
    data.forEach((d, c) => buf.copyToChannel(d, c));
    if (irCache.size > 24) irCache.delete(irCache.keys().next().value);
    irCache.set(key, buf);
  }
  return buf;
}

/**
 * 뜯는 현 (Karplus-Strong): 지연선 한 바퀴마다 고역이 조금씩 줄어든다. 분수 지연(올패스)으로 음정이 정확하다.
 * band2sheet sound.py 의 pluck() 를 옮겼다. decay: -60dB 까지 초, bright: 0..1, pick: 줄 위 뜯는 위치.
 */
export function karplus(f0, sr, { decay = 2.5, bright = 0.6, pick = 0.2, velocity = 0.8 } = {}) {
  const n = Math.round(sr * Math.min(8, decay * 1.3 + 0.3));
  const period = sr / f0;
  let s = 0.5 * (1 - 0.85 * bright);
  const w0 = (2 * Math.PI * f0) / sr;
  const gTarget = 10 ** ((-3 * period) / (Math.max(decay, 0.05) * sr));
  let loss = 1;
  for (let k = 0; k < 12; k++) {
    loss = Math.hypot(1 - s + s * Math.cos(w0), s * Math.sin(w0));
    if (gTarget / loss <= 0.9995) break;
    s *= 0.5;
  }
  const g = Math.min(0.9995, gTarget / loss);
  const delay = Math.max(2, Math.floor(period - s - 0.1));
  const frac = period - s - delay;
  const c = (1 - frac) / (1 + frac);
  // 들뜸: 뜯는 위치에서 당긴 줄 모양(삼각형) + 밝을수록 그 기울기(손톱 느낌)
  const m = Math.max(4, Math.round(period));
  const beta = Math.min(0.5, Math.max(0.05, pick));
  const tri = new Float32Array(m);
  let mean = 0;
  for (let i = 0; i < m; i++) {
    const x = (i + 0.5) / m;
    tri[i] = x < beta ? x / beta : (1 - x) / (1 - beta);
    mean += tri[i] / m;
  }
  let rs = 99;
  const noise = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
  const b = Math.min(1, Math.max(0, bright)) * (0.4 + 0.6 * velocity);
  const ex = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const t0 = tri[i] - mean;
    const slope = tri[(i + 1) % m] - tri[i];
    ex[i] = (1 - 0.6 * b) * t0 + 0.6 * b * slope * m * 0.25 + 0.06 * noise();
  }
  // 세게 뜯을수록 밝게: 1차 저역통과
  const fc = Math.min(sr * 0.45, 600 + 9000 * Math.min(1, Math.max(0.05, 0.15 + 0.85 * velocity * bright)));
  const a1 = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  let lpState = 0;
  let exMean = 0;
  for (let r = 0; r < 2; r++) for (let i = 0; i < m; i++) { lpState += (ex[i] - lpState) * a1; if (r === 1) ex[i] = lpState; }
  for (let i = 0; i < m; i++) exMean += ex[i] / m;
  let exPeak = 0;
  for (let i = 0; i < m; i++) { ex[i] -= exMean; exPeak = Math.max(exPeak, Math.abs(ex[i])); }
  const out = new Float32Array(n);
  const buf = new Float32Array(delay);
  let idx = 0;
  let prev = 0;
  let ax1 = 0;
  let ay1 = 0;
  for (let i = 0; i < n; i++) {
    const xd = buf[idx];
    const lp = (1 - s) * xd + s * prev;
    prev = xd;
    const ap = c * lp + ax1 - c * ay1;
    ax1 = lp;
    ay1 = ap;
    let v = g * ap;
    if (i < m) v += ex[i] / (exPeak || 1);
    buf[idx] = v;
    idx = idx + 1 === delay ? 0 : idx + 1;
    out[i] = v;
  }
  let peak = 0;
  for (let i = 0; i < Math.min(n, sr * 0.2); i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] /= peak || 1;
  // 마지막 30ms 는 부드럽게 닫는다
  const tail = Math.min(n, Math.round(sr * 0.03));
  for (let i = 0; i < tail; i++) out[n - 1 - i] *= i / tail;
  return out;
}

function driveCurve(amount) {
  const k = 1 + amount * 14;
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

/** 테이프 포화: 작은 소리는 그대로(기울기 1), 큰 소리만 둥글게 눌러 되먹임 고리가 커지지 않는다. */
function tapeCurve() {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(1.5 * x) / 1.5;
  }
  return curve;
}

/** 로파이: 계단 모양 곡선으로 소리 높낮이 단계를 줄인다 (256단계 → 8단계). */
function lofiCurve(amount) {
  const half = Math.max(4, Math.round(2 ** (8 - amount * 5))) / 2;
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.round(((i / (n - 1)) * 2 - 1) * half) / half;
  return curve;
}

function holdAt(param, when, fallback) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(when);
  else {
    param.cancelScheduledValues(when);
    param.setValueAtTime(fallback, when);
  }
}

const waveCache = new WeakMap();
function setWave(ctx, osc, id, custom) {
  if (id !== 'custom' && !HARMONICS[id]) {
    osc.type = id;
    return;
  }
  let forCtx = waveCache.get(ctx);
  if (!forCtx) waveCache.set(ctx, (forCtx = new Map()));
  const key = id === 'custom' ? `custom:${custom.map((a) => a.toFixed(3)).join(',')}` : id;
  if (!forCtx.has(key)) {
    let h = id === 'custom' ? custom : HARMONICS[id];
    if (!h.some((a) => a > 1e-4)) h = [1];
    const imag = new Float32Array(h.length + 1);
    h.forEach((a, k) => { imag[k + 1] = a; });
    // 직접 그린 파형은 그릴 때마다 새로 생기니 오래된 것부터 버린다
    if (id === 'custom' && forCtx.size > 80) {
      const old = [...forCtx.keys()].find((k) => k.startsWith('custom:'));
      if (old) forCtx.delete(old);
    }
    forCtx.set(key, ctx.createPeriodicWave(new Float32Array(h.length + 1), imag));
  }
  osc.setPeriodicWave(forCtx.get(key));
}

export class Instrument {
  /** env: { ctx, out, tuner, bpm(), irFor(seconds, type, damp) } */
  constructor(env, patch, sample = null) {
    this.env = env;
    this.sample = sample;
    this.voices = new Set();
    this.held = new Map();
    this.monoStack = [];
    this.sustain = false;
    this.pluckCache = new Map();
    this.rng = makeRng(20261020);
    const ctx = (this.ctx = env.ctx);
    const gain = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const biquad = (type, frequency, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      f.Q.value = q;
      return f;
    };
    this.oscs = [];
    const lfo = (rate) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      o.start();
      this.oscs.push(o);
      return o;
    };
    this.input = gain(1);
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.postDrive = gain(1);
    this.input.connect(this.shaper).connect(this.postDrive);
    // 로파이: 계단 곡선 + 저역통과를 원래 소리와 바꿔 낀다
    this.lofiDry = gain(1);
    this.lofiWet = gain(0);
    this.lofiShaper = ctx.createWaveShaper();
    this.lofiLP = biquad('lowpass', 16000);
    this.texIn = gain(1);
    this.postDrive.connect(this.lofiDry).connect(this.texIn);
    this.postDrive.connect(this.lofiShaper).connect(this.lofiLP).connect(this.lofiWet).connect(this.texIn);
    // 페이저: 올패스 4단을 느린 LFO 로 쓸어 원래 소리와 섞으면 움직이는 골이 생긴다
    this.phaserDry = gain(1);
    this.phaserWet = gain(0);
    this.phaserLfo = lfo(0.4);
    this.phaserDepth = gain(1500);
    this.phaserLfo.connect(this.phaserDepth);
    let stage = this.texIn;
    for (const f of [320, 760, 1700, 3600]) {
      const ap = biquad('allpass', f, 0.6);
      this.phaserDepth.connect(ap.detune);
      stage = stage.connect(ap);
    }
    stage.connect(this.phaserWet);
    this.texIn.connect(this.phaserDry);
    this.chorusIn = gain(1);
    this.phaserDry.connect(this.chorusIn);
    this.phaserWet.connect(this.chorusIn);
    this.chorusDry = gain(1);
    this.chorusWet = gain(0);
    this.fxBus = gain(1);
    this.chorusIn.connect(this.chorusDry).connect(this.fxBus);
    for (const [base, rate, depth, pan] of [[0.012, 0.31, 0.0025, -0.7], [0.019, 0.43, 0.003, 0.7]]) {
      const d = ctx.createDelay(0.06);
      d.delayTime.value = base;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      lfo(rate).connect(gain(depth)).connect(d.delayTime);
      this.chorusIn.connect(d).connect(p).connect(this.chorusWet);
    }
    this.chorusWet.connect(this.fxBus);
    // 그대로·딜레이·잔향이 모이는 곳
    this.post = gain(1);
    this.fxBus.connect(this.post);
    // 딜레이: 되먹임 고리 안에 저역통과 (반복될수록 어두워짐). 방식은 이음새 볼륨으로 바꾼다
    //   가운데: A → 밝기 → (테이프 포화) → 되먹임 → A          (가운데로 나감)
    //   핑퐁:   A → 왼쪽, A → B → 오른쪽, B → 되먹임 → A       (좌우 번갈아)
    //   테이프: 가운데 + 지연 시간을 천천히 흔들고 반복마다 살짝 찌그러뜨림
    this.delaySend = gain(0);
    this.dA = ctx.createDelay(4);
    this.dB = ctx.createDelay(4);
    this.toneA = biquad('lowpass', 4200);
    this.toneB = biquad('lowpass', 4200);
    this.tapeSat = ctx.createWaveShaper();
    this.fbMono = gain(0.35);
    this.fbPP = gain(0);
    this.ppCross = gain(0);
    this.outC = gain(1);
    this.outL = gain(0);
    this.outR = gain(0);
    const panL = ctx.createStereoPanner();
    panL.pan.value = -0.9;
    const panR = ctx.createStereoPanner();
    panR.pan.value = 0.9;
    this.fxBus.connect(this.delaySend).connect(this.dA).connect(this.toneA).connect(this.tapeSat);
    this.tapeSat.connect(this.outC).connect(this.post);
    this.tapeSat.connect(this.fbMono).connect(this.dA);
    this.tapeSat.connect(this.outL).connect(panL).connect(this.post);
    this.tapeSat.connect(this.ppCross).connect(this.dB).connect(this.toneB);
    this.toneB.connect(this.outR).connect(panR).connect(this.post);
    this.toneB.connect(this.fbPP).connect(this.dA);
    this.wowDepth = gain(0);
    lfo(0.55).connect(this.wowDepth);
    this.wowDepth.connect(this.dA.delayTime);
    this.wowDepth.connect(this.dB.delayTime);
    // 잔향: 프리딜레이 → 홀 → 저역 정리(150Hz 아래 깎기) → 밝기
    this.reverbSend = gain(0);
    this.shimmerIn = gain(1);
    this.predelay = ctx.createDelay(0.3);
    this.reverb = ctx.createConvolver();
    this.revHP = biquad('highpass', 150);
    this.revTone = biquad('lowpass', 8000);
    this.fxBus.connect(this.reverbSend).connect(this.predelay);
    this.shimmerIn.connect(this.predelay);
    this.predelay.connect(this.reverb).connect(this.revHP).connect(this.revTone).connect(this.post);
    // 마무리: EQ 3밴드 → 맞춤 EQ(옥타브 10띠) → 컴프 → 스테레오 폭 → 볼륨
    this.eqLow = biquad('lowshelf', 180);
    this.eqMid = biquad('peaking', 1000, 0.9);
    this.eqHigh = biquad('highshelf', 5500);
    this.post.connect(this.eqLow).connect(this.eqMid).connect(this.eqHigh);
    this.match = MATCH_BANDS.map((f) => biquad('peaking', Math.min(f, ctx.sampleRate * 0.45), 1.41));
    let tail = this.eqHigh;
    for (const m of this.match) tail = tail.connect(m);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.knee.value = 10;
    this.comp.attack.value = 0.008;
    this.comp.release.value = 0.22;
    this.compDry = gain(1);
    this.compWet = gain(0);
    this.widthIn = gain(1);
    tail.connect(this.compDry).connect(this.widthIn);
    tail.connect(this.comp).connect(this.compWet).connect(this.widthIn);
    // 스테레오 폭: 가운데(L+R)는 그대로, 양옆 차이(L−R)만 키우거나 줄인다. 모노 입력도 두 채널로 펼쳐 받는다
    Object.assign(this.widthIn, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    this.widthGains = { ll: gain(1), rl: gain(0), rr: gain(1), lr: gain(0) };
    this.widthIn.connect(split);
    split.connect(this.widthGains.ll, 0).connect(merge, 0, 0);
    split.connect(this.widthGains.rl, 1).connect(merge, 0, 0);
    split.connect(this.widthGains.rr, 1).connect(merge, 0, 1);
    split.connect(this.widthGains.lr, 0).connect(merge, 0, 1);
    this.volume = gain(0.8);
    merge.connect(this.volume).connect(env.out);
    // LFO 하나를 세 곳(음정·필터·볼륨)으로 나눠 보낸다. 흔드는 곳을 바꾸면 깊이만 옮겨진다.
    this.lfo = lfo(5);
    this.lfoTo = { pitch: gain(0), filter: gain(0), amp: gain(0) };
    for (const g of Object.values(this.lfoTo)) this.lfo.connect(g);
    this.noise = (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = b.getChannelData(0);
      let s = 7;
      for (let i = 0; i < d.length; i++) d[i] = ((s = (s * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
      return b;
    })();
    this.setPatch(patch);
  }

  get voiceCount() {
    let n = 0;
    for (const v of this.voices) if (!v.released) n++;
    return n;
  }

  setSample(sample) {
    this.sample = sample;
  }

  setPatch(patch) {
    const prev = this.patch;
    this.patch = patch;
    const now = this.ctx.currentTime;
    const p = patch;
    const fx = p.fx;
    // 처음 한 번은 바로 그 값으로 (미리 연주·재기에서 첫 0.1초가 덜 젖은 소리가 되지 않게), 그 뒤로는 부드럽게
    const smooth = prev ? (param, v) => param.setTargetAtTime(v, now, 0.02) : (param, v) => param.setValueAtTime(v, now);
    if (!prev || prev.fx.drive !== fx.drive) this.shaper.curve = fx.drive > 0.001 ? driveCurve(fx.drive) : null;
    smooth(this.postDrive.gain, 1 / (1 + fx.drive * 1.5));
    if (!prev || prev.fx.lofi !== fx.lofi) this.lofiShaper.curve = fx.lofi > 0.001 ? lofiCurve(fx.lofi) : null;
    const lofiMix = Math.min(1, fx.lofi * 4);
    smooth(this.lofiWet.gain, lofiMix);
    smooth(this.lofiDry.gain, 1 - lofiMix);
    smooth(this.lofiLP.frequency, 16000 * 2 ** (-fx.lofi * 2.5));
    smooth(this.phaserWet.gain, fx.phaser * 0.5);
    smooth(this.phaserDry.gain, 1 - fx.phaser * 0.5);
    smooth(this.phaserLfo.frequency, fx.phaserRate);
    smooth(this.chorusWet.gain, fx.chorus * 0.8);
    smooth(this.chorusDry.gain, 1 - fx.chorus * 0.3);
    smooth(this.delaySend.gain, fx.delay * 0.6);
    const mode = fx.delayMode;
    const pp = mode === 'pingpong';
    const tape = mode === 'tape';
    smooth(this.outC.gain, pp ? 0 : 1);
    smooth(this.fbMono.gain, pp ? 0 : fx.feedback);
    smooth(this.outL.gain, pp ? 1 : 0);
    smooth(this.outR.gain, pp ? 1 : 0);
    smooth(this.ppCross.gain, pp ? fx.feedback : 0);
    smooth(this.fbPP.gain, pp ? fx.feedback : 0);
    smooth(this.wowDepth.gain, tape ? 0.0025 : 0);
    if (!prev || prev.fx.delayMode !== mode) this.tapeSat.curve = tape ? tapeCurve() : null;
    const tone = Math.min(this.ctx.sampleRate * 0.45, fx.delayTone * (tape ? 0.6 : 1));
    smooth(this.toneA.frequency, tone);
    smooth(this.toneB.frequency, tone);
    this.syncTempo();
    smooth(this.reverbSend.gain, fx.reverb * 0.9);
    smooth(this.predelay.delayTime, fx.predelay);
    smooth(this.revTone.frequency, Math.min(this.ctx.sampleRate * 0.45, 1500 * 2 ** (fx.tone * 3.4)));
    const key = irKey(fx.size, fx.reverbType, fx.damp);
    if (this.irKeyNow !== key) {
      this.irKeyNow = key;
      this.reverb.buffer = this.env.irFor(fx.size, fx.reverbType, fx.damp);
    }
    smooth(this.eqLow.gain, p.eq.low);
    smooth(this.eqMid.gain, p.eq.mid);
    smooth(this.eqMid.frequency, p.eq.midFreq);
    smooth(this.eqHigh.gain, p.eq.high);
    this.match.forEach((m, i) => smooth(m.gain, p.eq.match[i]));
    // 컴프: 0 이면 완전히 빼서(지연·색깔 없음) 지나가게 한다
    // (브라우저 컴프는 줄인 만큼 스스로 키워 주므로, 켜는 순간 커지지 않게 조금 낮춰 받는다)
    smooth(this.comp.threshold, -6 - 24 * fx.comp);
    smooth(this.comp.ratio, 1 + 5 * fx.comp);
    smooth(this.compWet.gain, fx.comp > 0.001 ? 1 / (1 + 0.9 * fx.comp) : 0);
    smooth(this.compDry.gain, fx.comp > 0.001 ? 0 : 1);
    const w = fx.width;
    smooth(this.widthGains.ll.gain, (1 + w) / 2);
    smooth(this.widthGains.rr.gain, (1 + w) / 2);
    smooth(this.widthGains.rl.gain, (1 - w) / 2);
    smooth(this.widthGains.lr.gain, (1 - w) / 2);
    smooth(this.volume.gain, p.volume);
    smooth(this.lfo.frequency, p.lfo.rate);
    const depth = { pitch: p.lfo.depth * 50, filter: p.lfo.depth * 2400, amp: p.lfo.depth * 0.5 };
    for (const [k, g] of Object.entries(this.lfoTo)) smooth(g.gain, p.lfo.target === k ? depth[k] : 0);
    // 이미 울리는 음에도 바로 들리게 하는 값들
    for (const v of this.voices) if (!v.released) v.live?.(p, now);
  }

  syncTempo() {
    const beat = 60 / this.env.bpm();
    const t = Math.min(3.9, this.patch.fx.delayBeats * beat);
    this.dA.delayTime.setTargetAtTime(t, this.ctx.currentTime, 0.05);
    this.dB.delayTime.setTargetAtTime(t, this.ctx.currentTime, 0.05);
  }

  setSustain(on, when = this.ctx.currentTime) {
    this.sustain = on;
    if (!on) for (const v of this.voices) if (v.sustained && !v.released) this._release(v, when);
  }

  noteOn(midi, velocity = 0.8, when = this.ctx.currentTime) {
    const p = this.patch;
    if (p.mono) {
      this.monoStack = this.monoStack.filter((m) => m !== midi).concat(midi);
      const cur = [...this.voices].find((v) => !v.released);
      if (cur && cur.retune && p.source === 'synth') {
        cur.retune(midi, when);
        this.held.set(midi, cur);
        return;
      }
      for (const v of this.voices) this._release(v, when, 0.03);
    } else {
      const same = this.held.get(midi);
      if (same) this._release(same, when, 0.03);
      const live = [...this.voices].filter((v) => !v.released);
      if (live.length >= MAX_VOICES) this._release(live[0], when, 0.03);
    }
    if (p.source === 'sample' && !this.sample) return;
    const v = this._makeVoice(midi, velocity, when);
    this.voices.add(v);
    this.held.set(midi, v);
  }

  noteOff(midi, when = this.ctx.currentTime) {
    const v = this.held.get(midi);
    this.held.delete(midi);
    if (this.patch.mono) {
      const wasTop = this.monoStack.at(-1) === midi;
      this.monoStack = this.monoStack.filter((m) => m !== midi);
      if (v && !v.released && wasTop && this.monoStack.length && v.retune) {
        const back = this.monoStack.at(-1);
        v.retune(back, when);
        this.held.set(back, v);
        return;
      }
      if (this.monoStack.length && v?.retune) return;
    }
    if (!v || v.released) return;
    if ([...this.held.values()].includes(v)) return;
    if (this.sustain) {
      v.sustained = true;
      return;
    }
    this._release(v, when);
  }

  allOff(when = this.ctx.currentTime, fast = false) {
    this.held.clear();
    this.monoStack = [];
    for (const v of this.voices) this._release(v, when, fast ? 0.03 : undefined);
  }

  dispose() {
    this.allOff(this.ctx.currentTime, true);
    const ctx = this.ctx;
    setTimeout(() => {
      try {
        this.oscs.forEach((o) => o.stop());
        this.volume.disconnect();
      } catch { /* 이미 닫힌 컨텍스트 */ }
    }, ctx instanceof AudioContext ? 400 : 0);
  }

  _pluckBuffer(freq, velocity) {
    const p = this.patch.pluck;
    const vBin = Math.round(velocity * 4) / 4;
    const key = `${freq.toFixed(2)}|${p.bright.toFixed(2)}|${p.decay.toFixed(2)}|${p.pick.toFixed(2)}|${vBin}`;
    let buf = this.pluckCache.get(key);
    if (!buf) {
      const data = karplus(freq, this.ctx.sampleRate, { decay: p.decay, bright: p.bright, pick: p.pick, velocity: vBin });
      buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      buf.copyToChannel(data, 0);
      if (this.pluckCache.size > 96) this.pluckCache.delete(this.pluckCache.keys().next().value);
      this.pluckCache.set(key, buf);
    }
    return buf;
  }

  _makeVoice(midi, velocity, when) {
    const ctx = this.ctx;
    const p = this.patch;
    const tuner = this.env.tuner;
    const rnd = this.rng;
    const freq = tuner.freq(midi);
    const v = { midi, start: when, released: false, sources: [], nodes: [], patch: p, velocity, delays: new Map(), stops: new Map() };
    const node = (n) => {
      v.nodes.push(n);
      return n;
    };
    const gain = (val) => {
      const g = node(ctx.createGain());
      g.gain.value = val;
      return g;
    };
    const mix = gain(1);
    // 24dB 는 같은 필터를 두 번 거친다. 레조넌스는 첫 단만 (둘 다 올리면 귀가 아플 만큼 솟음)
    const filters = [];
    for (let k = 0; k < (p.filter.slope === 24 ? 2 : 1); k++) {
      const f = node(ctx.createBiquadFilter());
      f.type = p.filter.type;
      f.Q.value = k === 0 ? p.filter.q : 0.6;
      filters.push(f);
    }
    const trem = gain(1 - p.lfo.depth * 0.5 * (p.lfo.target === 'amp'));
    const amp = gain(0);
    let chain = mix;
    for (const f of filters) chain = chain.connect(f);
    chain.connect(trem).connect(amp).connect(this.input);
    // LFO 는 음마다 '늦게 시작'만큼 서서히 들어온다
    v.lfoLinks = [];
    const lfoFade = (target) => {
      const g = gain(0);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, when + Math.max(0.01, p.lfo.delay));
      this.lfoTo[target].connect(g);
      v.lfoLinks.push([this.lfoTo[target], g]);
      return g;
    };
    const filterLfo = lfoFade('filter');
    for (const f of filters) filterLfo.connect(f.detune);
    lfoFade('amp').connect(trem.gain);
    const pitchLfo = lfoFade('pitch');
    const pitchTargets = [];
    // 쉬머: 옥타브 위 복사본을 잔향으로만 보낸다 (BigSky 같은 워십 쉬머)
    let shim = null;
    if (p.fx.shimmer > 0.001) {
      shim = v.shim = gain(0);
      v.shimLevel = p.fx.shimmer * 0.18 * (1 - p.vel.amp + p.vel.amp * velocity);
      shim.gain.setValueAtTime(0, when);
      shim.gain.setTargetAtTime(v.shimLevel, when, Math.max(0.25, p.ampEnv.a * 0.8));
      shim.connect(this.shimmerIn);
    }

    if (p.source === 'synth') {
      v.oscs = [];
      v.oscGains = [];
      const carrierFreqs = [];
      p.osc.forEach((o, i) => {
        if (i > 0 && o.level <= 0.001) {
          v.oscGains.push(null);
          return;
        }
        const g = gain(o.level / Math.sqrt(o.unison));
        g.connect(mix);
        v.oscGains.push(g);
        const ratio = 2 ** (o.octave + o.semi / 12);
        for (let u = 0; u < o.unison; u++) {
          const osc = node(ctx.createOscillator());
          setWave(ctx, osc, o.wave, p.custom);
          osc.frequency.value = freq * ratio;
          const spread = o.unison > 1 ? (u / (o.unison - 1) - 0.5) * 2 : 0;
          // 아날로그 흔들림: 오실레이터마다 몇 cent 씩 다른 자리
          const drift = p.drift > 0.001 ? (rnd.next() - 0.5) * 2 * p.drift * 7 : 0;
          osc.detune.value = o.detune + spread * o.spread + drift;
          let out = osc;
          if (o.unison > 1) {
            const pan = node(ctx.createStereoPanner());
            pan.pan.value = spread * 0.6;
            out = osc.connect(pan);
            // 겹친 소리의 시작 위상을 흩어 '레이저' 같은 첫소리를 없앤다
            v.delays.set(osc, rnd.next() / (freq * ratio));
          }
          out.connect(g);
          v.sources.push(osc);
          v.oscs.push({ osc, ratio, index: i, spread, drift });
          pitchTargets.push(osc.detune);
          if (i === 0) carrierFreqs.push(osc.frequency);
        }
      });
      if (p.fm.amount > 0.001) {
        const ratio0 = 2 ** (p.osc[0].octave + p.osc[0].semi / 12);
        const mod = node(ctx.createOscillator());
        mod.frequency.value = freq * ratio0 * p.fm.ratio;
        const modGain = gain(0);
        const peak = p.fm.amount * 6 * freq * ratio0 * p.fm.ratio * (0.6 + 0.6 * velocity);
        modGain.gain.setValueAtTime(peak, when);
        modGain.gain.setTargetAtTime(peak * p.fm.sustain, when, Math.max(0.01, p.fm.decay / 3));
        mod.connect(modGain);
        carrierFreqs.forEach((f) => modGain.connect(f));
        v.sources.push(mod);
        v.mod = { osc: mod, ratio: ratio0 * p.fm.ratio };
        pitchTargets.push(mod.detune);
      }
      if (p.noise > 0.001) {
        const src = node(ctx.createBufferSource());
        src.buffer = this.noise;
        src.loop = true;
        const g = gain(p.noise * 0.35);
        src.connect(g).connect(mix);
        v.sources.push(src);
        v.noiseGain = g;
      }
      v.shimOscs = [];
      if (shim) {
        const ratio0 = 2 ** (p.osc[0].octave + p.osc[0].semi / 12);
        for (const [mult, level, wave] of [[2, 1, p.osc[0].wave], [4, 0.35, 'sine']]) {
          const osc = node(ctx.createOscillator());
          setWave(ctx, osc, wave, p.custom);
          osc.frequency.value = freq * ratio0 * mult;
          osc.connect(gain(level)).connect(shim);
          v.sources.push(osc);
          v.shimOscs.push({ osc, ratio: ratio0 * mult });
        }
      }
      v.retune = (m, t) => {
        const f = tuner.freq(m);
        const tau = Math.max(0.003, v.patch.glide / 3);
        v.midi = m;
        for (const o of [...v.oscs, ...v.shimOscs]) o.osc.frequency.setTargetAtTime(f * o.ratio, t, tau);
        if (v.mod) v.mod.osc.frequency.setTargetAtTime(f * v.mod.ratio, t, tau);
        v.filterBase = clampHz(v.patch.filter.cutoff * 2 ** ((v.patch.filter.keytrack * (m - 60)) / 12));
      };
      if (p.mono && p.glide > 0 && this.lastMonoMidi != null) {
        const from = tuner.freq(this.lastMonoMidi);
        for (const o of v.oscs) {
          o.osc.frequency.setValueAtTime(from * o.ratio, when);
          o.osc.frequency.setTargetAtTime(freq * o.ratio, when, Math.max(0.003, p.glide / 3));
        }
      }
    } else if (p.source === 'pluck') {
      const buffer = this._pluckBuffer(freq, velocity);
      const src = node(ctx.createBufferSource());
      src.buffer = buffer;
      const body1 = node(ctx.createBiquadFilter());
      body1.type = 'peaking';
      body1.frequency.value = 105;
      body1.Q.value = 2;
      body1.gain.value = 6 * p.pluck.body;
      const body2 = node(ctx.createBiquadFilter());
      body2.type = 'peaking';
      body2.frequency.value = 220;
      body2.Q.value = 1.8;
      body2.gain.value = 4 * p.pluck.body;
      const air = node(ctx.createBiquadFilter());
      air.type = 'highshelf';
      air.frequency.value = 6000;
      air.gain.value = -4 * p.pluck.body;
      src.connect(body1).connect(body2).connect(air).connect(mix);
      v.sources.push(src);
      pitchTargets.push(src.detune);
      if (shim) {
        const up = node(ctx.createBufferSource());
        up.buffer = buffer;
        up.detune.value = 1200;
        up.connect(shim);
        v.sources.push(up);
      }
    } else {
      const s = this.sample;
      const make = (rate) => {
        const src = node(ctx.createBufferSource());
        src.buffer = s.buffer;
        src.playbackRate.value = rate;
        if (s.loop) {
          src.loop = true;
          src.loopStart = s.loop.start;
          src.loopEnd = s.loop.end;
        } else v.stops.set(src, when + (s.end - s.start) / rate);
        v.sources.push(src);
        return src;
      };
      const rate = freq / s.rootHz;
      const src = make(rate);
      src.connect(mix);
      v.sampleOffset = s.start;
      pitchTargets.push(src.detune);
      if (shim) make(rate * 2).connect(shim);
    }
    // 아날로그 흔들림: 음마다 다른 빠르기로 천천히 출렁이는 음정
    if (p.drift > 0.001 && pitchTargets.length) {
      const wob = node(ctx.createOscillator());
      wob.frequency.value = rnd.range(0.15, 0.6);
      const wg = gain(p.drift * 6);
      wob.connect(wg);
      for (const param of pitchTargets) wg.connect(param);
      v.sources.push(wob);
    }
    for (const param of pitchTargets) pitchLfo.connect(param);

    // 어택 소리: 해머·피크·숨이 닿는 순간의 짧은 잡음 (엔벨로프와 따로 바로 악기로)
    if (p.click > 0.001) {
      const src = node(ctx.createBufferSource());
      src.buffer = this.noise;
      const bp = node(ctx.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.value = clampHz(Math.max(700 * 2 ** (p.clickTone * 3.6), freq * 2));
      bp.Q.value = 0.9;
      const g = gain(0);
      const level = p.click * 0.6 * (0.3 + 0.7 * velocity);
      g.gain.setValueAtTime(level, when);
      g.gain.setTargetAtTime(0, when + 0.002, 0.004 + (1 - p.clickTone) * 0.014);
      src.connect(bp).connect(g).connect(this.input);
      src.start(when, rnd.range(0, 1.5));
      src.stop(when + 0.15);
    }

    // 필터 엔벨로프 (세게 칠수록 밝게)
    const fe = p.filterEnv;
    v.filterBase = clampHz(p.filter.cutoff * 2 ** ((p.filter.keytrack * (midi - 60)) / 12) * 2 ** ((velocity - 0.7) * p.vel.filter));
    const peakF = clampHz(v.filterBase * 2 ** p.filter.env);
    for (const f of filters) {
      f.frequency.setValueAtTime(v.filterBase, when);
      if (Math.abs(p.filter.env) > 0.01) {
        f.frequency.exponentialRampToValueAtTime(peakF, when + Math.max(0.002, fe.a));
        f.frequency.setTargetAtTime(clampHz(v.filterBase * 2 ** (p.filter.env * fe.s)), when + Math.max(0.002, fe.a), Math.max(0.005, fe.d / 4));
      }
    }
    // 볼륨 엔벨로프
    const ae = p.ampEnv;
    v.peakAmp = 0.32 * (1 - p.vel.amp + p.vel.amp * velocity);
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(v.peakAmp, when + Math.max(0.001, ae.a));
    amp.gain.setTargetAtTime(v.peakAmp * ae.s, when + Math.max(0.001, ae.a), Math.max(0.005, ae.d / 4));
    v.amp = amp;
    v.filters = filters;
    v.live = (np, now) => {
      filters[0].Q.setTargetAtTime(np.filter.q, now, 0.02);
      for (const f of filters) if (f.type !== np.filter.type) f.type = np.filter.type;
      if (v.oscGains) np.osc.forEach((o, i) => v.oscGains[i]?.gain.setTargetAtTime(o.level / Math.sqrt(o.unison), now, 0.02));
      if (v.oscs) for (const o of v.oscs) o.osc.detune.setTargetAtTime(np.osc[o.index].detune + o.spread * np.osc[o.index].spread + o.drift, now, 0.02);
      v.noiseGain?.gain.setTargetAtTime(np.noise * 0.35, now, 0.02);
      const base = clampHz(np.filter.cutoff * 2 ** ((np.filter.keytrack * (v.midi - 60)) / 12));
      if (Math.abs(base - v.filterBase) / v.filterBase > 0.01 && now > v.start + np.filterEnv.a) {
        v.filterBase = base;
        for (const f of filters) f.frequency.setTargetAtTime(clampHz(base * 2 ** (np.filter.env * np.filterEnv.s)), now, 0.03);
      }
    };
    for (const src of v.sources) src.start(when + (v.delays.get(src) ?? 0), p.source === 'sample' ? v.sampleOffset : 0);
    // 한 번만 울리는 샘플은 끝에서 멈춘다 (멈춤 예약은 시작 뒤에만 된다)
    for (const [src, at] of v.stops) src.stop(at);
    const life = v.sources[0];
    life.onended = () => {
      for (const [from, to] of v.lfoLinks) from.disconnect(to);
      for (const n of v.nodes) n.disconnect();
      this.voices.delete(v);
    };
    if (p.mono) this.lastMonoMidi = midi;
    return v;
  }

  _release(v, when, fastRelease) {
    if (v.released) return;
    v.released = true;
    v.sustained = false;
    const p = v.patch;
    const r = fastRelease ?? p.ampEnv.r;
    const t = Math.max(when, this.ctx.currentTime);
    const held = Math.max(0, t - v.start);
    holdAt(v.amp.gain, t, envLevel(p.ampEnv, held) * v.peakAmp);
    v.amp.gain.setTargetAtTime(0, t, Math.max(0.004, r / 5));
    if (Math.abs(p.filter.env) > 0.01) {
      for (const f of v.filters) {
        holdAt(f.frequency, t, clampHz(v.filterBase * 2 ** (p.filter.env * envLevel(p.filterEnv, held))));
        f.frequency.setTargetAtTime(v.filterBase, t, Math.max(0.005, (fastRelease ?? p.filterEnv.r) / 5));
      }
    }
    if (v.shim) {
      holdAt(v.shim.gain, t, v.shimLevel);
      v.shim.gain.setTargetAtTime(0, t, Math.max(0.004, r / 4));
    }
    const stopAt = t + r * 1.25 + 0.05;
    for (const s of v.sources) {
      try { s.stop(stopAt); } catch { /* 이미 멈춤 */ }
    }
  }
}

/** 브라우저 오디오 전체: 마스터·리미터·분석기·메트로놈·잔향 캐시·튜닝·빠르기. */
export class Studio {
  constructor() {
    this.ctx = null;
    this.tuner = makeTuner({});
    this.bpm = 72;
        this.masterLevel = 0.85;
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  async start() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
      this.bus = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -8;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.2;
      this.master = ctx.createGain();
      this.master.gain.value = this.masterLevel;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.clickBus = ctx.createGain();
      this.clickBus.gain.value = 0.5;
      this.bus.connect(this.limiter).connect(this.master).connect(this.analyser).connect(ctx.destination);
      this.clickBus.connect(this.master);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  setMaster(v) {
    this.masterLevel = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  irFor(seconds, type, damp) {
    return makeIR(this.ctx, seconds, type, damp);
  }

  /** 악기가 쓰는 환경. 튜닝·빠르기는 읽을 때마다 지금 값이라, 튜닝을 바꾸면 다음 음부터 바로 따른다. */
  env() {
    const studio = this;
    return {
      ctx: this.ctx,
      out: this.bus,
      get tuner() { return studio.tuner; },
      bpm: () => studio.bpm,
      irFor: (s, type, damp) => studio.irFor(s, type, damp),
    };
  }

  /** 메트로놈 '틱'. 마디 첫 박은 높게. */
  click(when, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = accent ? 1760 : 1175;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    o.connect(g).connect(this.clickBus);
    o.start(when);
    o.stop(when + 0.06);
    o.onended = () => g.disconnect();
  }
}

// 미리 연주(OfflineAudioContext)는 한 번에 하나씩만. 크롬에서 잔향(컨볼버)이 있는 렌더 둘이 동시에 돌면
// 꼬리가 잘리거나 딜레이가 비는 등 결과가 흔들린다 (이펙트 꼬리 재기 검사에서 확인).
let renderQueue = Promise.resolve();
export function rendered(ctx) {
  const run = renderQueue.then(() => ctx.startRendering());
  renderQueue = run.catch(() => {});
  return run;
}

function offlineEnv(ctx, tuning = {}, bpm = 72) {
  return {
    ctx,
    out: ctx.destination,
    tuner: makeTuner(tuning),
    bpm: () => bpm,
    irFor: (s, type, damp) => makeIR(ctx, s, type, damp),
  };
}

/**
 * 지금 음색으로 음(들)을 미리 연주해 AudioBuffer 로 (샘플러의 '음색 굽기', 음원 따라 만들기의 비교, 테스트).
 * notes 를 주면 화음으로 친다. dry 면 딜레이·잔향·쉬머를 뺀다.
 */
export async function renderNote(patch, { midi = 57, notes = null, velocity = 0.8, seconds = 3, hold = 2.2, tuning = {}, sample = null, sampleRate = 44100, dry = true } = {}) {
  const ctx = new OfflineAudioContext(2, Math.round(sampleRate * seconds), sampleRate);
  const env = offlineEnv(ctx, tuning);
  const p = dry ? { ...patch, fx: { ...patch.fx, delay: 0, reverb: 0, shimmer: 0 } } : patch;
  const inst = new Instrument(env, p, sample);
  const list = notes ?? [midi];
  for (const m of list) inst.noteOn(m, velocity, 0.01);
  for (const m of list) inst.noteOff(m, hold);
  return rendered(ctx);
}

/** 이펙트 꼬리가 사라지는 데 걸리는 대략의 시간 (초): 잔향 길이, 딜레이 반복이 0.1% 로 줄 때까지. */
export function effectTail(fx, bpm = 72) {
  const rev = fx.reverb > 0.001 ? fx.predelay + fx.size * 1.05 : 0;
  const t = fx.delayBeats * (60 / bpm);
  const echoes = fx.delay > 0.001 ? t * Math.min(40, Math.log(0.001) / Math.log(Math.min(0.9, Math.max(0.05, fx.feedback)))) : 0;
  return Math.min(10, Math.max(rev, echoes) + 0.15);
}

/** 이펙트 줄에 바깥 소리를 넣는 입구 (음 하나의 크기쯤으로 낮춰 넣어 드라이브·컴프가 건반 연주 때와 같이 반응) */
function feed(ctx, inst, channels, sampleRate, when) {
  const b = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate });
  channels.forEach((c, i) => b.copyToChannel(c, i));
  const src = ctx.createBufferSource();
  src.buffer = b;
  const g = ctx.createGain();
  g.gain.value = 0.35;
  src.connect(g).connect(inst.input);
  src.start(when);
}

/**
 * 이펙트 시험: 5ms 짧은 소리 하나를 지금 음색의 이펙트 줄에 넣어 꼬리를 받는다.
 * 딜레이·잔향·쉬머만 뺀 같은 줄로도 받아 두면 full − dry 가 '젖은 소리'(딜레이+잔향)만 된다.
 */
export async function renderTail(patch, { sampleRate = 44100, bpm = 72 } = {}) {
  const seconds = Math.min(10.5, 0.2 + effectTail(patch.fx, bpm));
  let st = 5;
  const n = Math.round(sampleRate * 0.005);
  const burst = Float32Array.from({ length: n }, (_, i) => (((st = (st * 1664525 + 1013904223) >>> 0) / 2147483648) - 1) * Math.sin((Math.PI * i) / n) ** 2);
  const render = (p) => {
    const ctx = new OfflineAudioContext(2, Math.round(sampleRate * seconds), sampleRate);
    feed(ctx, new Instrument(offlineEnv(ctx, {}, bpm), p), [burst], sampleRate, 0.01);
    return rendered(ctx);
  };
  const noSpace = { ...patch, fx: { ...patch.fx, delay: 0, reverb: 0, shimmer: 0 } };
  const full = await render(patch);
  const dry = await render(noSpace);
  return { full, dry, seconds, start: 0.01 };
}

/** 녹음한 소리(샘플)를 지금 음색의 이펙트 줄(드라이브~잔향~EQ~폭)에 통과시켜 꼬리까지 받는다. 쉬머는 건반 음에만 생긴다. */
export async function renderThroughFx(patch, channels, sampleRate, { bpm = 72 } = {}) {
  const len = channels[0].length + Math.round(effectTail(patch.fx, bpm) * sampleRate);
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  feed(ctx, new Instrument(offlineEnv(ctx, {}, bpm), patch), channels, sampleRate, 0);
  return rendered(ctx);
}
