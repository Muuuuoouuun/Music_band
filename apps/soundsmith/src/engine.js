// 소리 엔진: 브라우저 기본 Web Audio 노드만 쓴다 (워클릿·외부 라이브러리 없음).
//
//   음 하나(voice) ─ 오실레이터 ×겹치기 ─┐                    ┌ 트레몰로 ─ 볼륨 엔벨로프 ─┐
//                  FM 변조기 ─→ 주파수   ├─ 섞기 ─ 필터 ──────┘                            │
//                  노이즈 / 줄 / 샘플 ───┘    ↑ 필터 엔벨로프·LFO                           │
//   악기(instrument) ← 음들 ─ 드라이브 ─ 코러스 ─┬─ 톤 EQ ─ 볼륨 ─→ 스튜디오 버스          ←─┘
//                                               ├─ 딜레이(박에 맞춤, 되먹임) ─┤
//                                               └─ 잔향(합성 홀) ─────────────┘
//   톤 EQ = 로우컷 + 대역 6개 (톤 맞추기 탭). 효과까지 거친 소리 전체에 건다.
//   스튜디오 버스 ─ 리미터 ─ 마스터 ─ 분석기(오실로스코프) ─ 스피커
//
// 루퍼 트랙마다 악기를 하나씩 따로 만들어 서로 다른 음색이 동시에 울린다.
// 같은 Instrument 를 OfflineAudioContext 에 만들면 '지금 음색을 샘플로 굽기'가 된다.
import { HARMONICS, envLevel } from './patch.js';
import { makeTuner } from './tuning.js';
import { FLAT_TONE, toneFilters } from './tone.js';
import { pickZone } from './sample.js';

const MAX_VOICES = 12;
const clampHz = (f) => Math.min(20000, Math.max(20, f));

// 홀 잔향: 시간이 갈수록 어두워지는 꼬리 + 좌우가 다른 초기 반사 (AirChoir audio.js 와 같은 방식)
export function impulseData(sampleRate, seconds = 2.6, seed = 11) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const len = Math.round(sampleRate * seconds);
  const pre = Math.round(sampleRate * 0.018);
  const rt60 = seconds * 0.8;
  const channels = [];
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
    channels.push(d);
  }
  let e = 0;
  for (const d of channels) for (let i = 0; i < len; i++) e += d[i] * d[i];
  const g = 1 / Math.sqrt(e / 2 || 1);
  for (const d of channels) for (let i = 0; i < len; i++) d[i] *= g;
  return channels;
}

function makeIR(ctx, seconds) {
  const data = impulseData(ctx.sampleRate, seconds);
  const buf = ctx.createBuffer(2, data[0].length, ctx.sampleRate);
  data.forEach((d, c) => buf.copyToChannel(d, c));
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

function holdAt(param, when, fallback) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(when);
  else {
    param.cancelScheduledValues(when);
    param.setValueAtTime(fallback, when);
  }
}

const waveCache = new WeakMap();
function setWave(ctx, osc, id, custom) {
  if (!HARMONICS[id] && id !== 'custom') {
    osc.type = id;
    return;
  }
  let forCtx = waveCache.get(ctx);
  if (!forCtx) waveCache.set(ctx, (forCtx = new Map()));
  const key = id === 'custom' ? `custom:${custom.join(',')}` : id;
  if (!forCtx.has(key)) {
    const h = id === 'custom' ? custom : HARMONICS[id];
    const imag = new Float32Array(h.length + 1);
    h.forEach((a, k) => { imag[k + 1] = a; });
    if (forCtx.size > 64) forCtx.delete(forCtx.keys().next().value);
    forCtx.set(key, ctx.createPeriodicWave(new Float32Array(h.length + 1), imag));
  }
  osc.setPeriodicWave(forCtx.get(key));
}

export class Instrument {
  /** env: { ctx, out, tuner, bpm(), irFor(seconds) } */
  constructor(env, patch, sample = null) {
    this.env = env;
    this.sample = sample;
    this.voices = new Set();
    this.held = new Map();
    this.monoStack = [];
    this.sustain = false;
    this.pluckCache = new Map();
    const ctx = (this.ctx = env.ctx);
    const gain = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    this.input = gain(1);
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.postDrive = gain(1);
    this.chorusDry = gain(1);
    this.chorusWet = gain(0);
    this.fxBus = gain(1);
    this.volume = gain(0.8);
    this.input.connect(this.shaper).connect(this.postDrive);
    this.postDrive.connect(this.chorusDry).connect(this.fxBus);
    this.chorusLfos = [];
    for (const [base, rate, depth, pan] of [[0.012, 0.31, 0.0025, -0.7], [0.019, 0.43, 0.003, 0.7]]) {
      const d = ctx.createDelay(0.06);
      d.delayTime.value = base;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = gain(depth);
      lfo.connect(lg).connect(d.delayTime);
      lfo.start();
      this.chorusLfos.push(lfo);
      this.postDrive.connect(d).connect(p).connect(this.chorusWet);
    }
    this.chorusWet.connect(this.fxBus);
    // 톤 EQ: 마른 소리·딜레이·잔향이 모두 여기로 모인다
    this.eqIn = gain(1);
    this.eq = toneFilters(FLAT_TONE).map((f) => {
      const n = ctx.createBiquadFilter();
      n.type = f.type;
      n.frequency.value = f.f;
      // Web Audio 의 highpass Q 는 dB 단위
      n.Q.value = f.type === 'highpass' ? 20 * Math.log10(f.q) : f.q;
      n.gain.value = 0;
      return n;
    });
    this.eq.reduce((from, n) => from.connect(n), this.eqIn).connect(this.volume);
    this.fxBus.connect(this.eqIn);
    // 딜레이: 되먹임 고리 안에 저역통과 (반복될수록 어두워짐)
    this.delaySend = gain(0);
    this.echo = ctx.createDelay(4);
    this.echoTone = ctx.createBiquadFilter();
    this.echoTone.type = 'lowpass';
    this.echoTone.frequency.value = 4200;
    this.feedback = gain(0.35);
    this.fxBus.connect(this.delaySend).connect(this.echo).connect(this.echoTone).connect(this.feedback).connect(this.echo);
    this.echoTone.connect(this.eqIn);
    this.reverbSend = gain(0);
    this.reverb = ctx.createConvolver();
    this.fxBus.connect(this.reverbSend).connect(this.reverb).connect(this.eqIn);
    this.volume.connect(env.out);
    // LFO 하나를 세 곳(음정·필터·볼륨)으로 나눠 보낸다. 흔드는 곳을 바꾸면 깊이만 옮겨진다.
    this.lfo = ctx.createOscillator();
    this.lfoTo = { pitch: gain(0), filter: gain(0), amp: gain(0) };
    for (const g of Object.values(this.lfoTo)) this.lfo.connect(g);
    this.lfo.start();
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
    const smooth = (param, v) => param.setTargetAtTime(v, now, 0.02);
    if (!prev || prev.fx.drive !== p.fx.drive) this.shaper.curve = p.fx.drive > 0.001 ? driveCurve(p.fx.drive) : null;
    smooth(this.postDrive.gain, 1 / (1 + p.fx.drive * 1.5));
    smooth(this.chorusWet.gain, p.fx.chorus * 0.8);
    smooth(this.chorusDry.gain, 1 - p.fx.chorus * 0.3);
    smooth(this.delaySend.gain, p.fx.delay * 0.6);
    smooth(this.feedback.gain, p.fx.feedback);
    this.syncTempo();
    smooth(this.reverbSend.gain, p.fx.reverb * 0.9);
    if (this.irSize == null || Math.abs(this.irSize - p.fx.size) > 0.12) {
      this.irSize = p.fx.size;
      this.reverb.buffer = this.env.irFor(p.fx.size);
    }
    toneFilters(p.tone).forEach((f, i) => {
      smooth(this.eq[i].frequency, f.f);
      smooth(this.eq[i].gain, f.gain);
    });
    smooth(this.volume.gain, p.volume);
    smooth(this.lfo.frequency, p.lfo.rate);
    const depth = { pitch: p.lfo.depth * 50, filter: p.lfo.depth * 2400, amp: p.lfo.depth * 0.5 };
    for (const [k, g] of Object.entries(this.lfoTo)) smooth(g.gain, p.lfo.target === k ? depth[k] : 0);
    // 이미 울리는 음에도 바로 들리게 하는 값들
    for (const v of this.voices) if (!v.released) v.live?.(p, now);
  }

  syncTempo() {
    const beat = 60 / this.env.bpm();
    this.echo.delayTime.setTargetAtTime(Math.min(3.9, this.patch.fx.delayBeats * beat), this.ctx.currentTime, 0.05);
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
        this.lfo.stop();
        this.chorusLfos.forEach((l) => l.stop());
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
    const freq = tuner.freq(midi);
    const v = { midi, start: when, released: false, sources: [], nodes: [], patch: p, velocity };
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
    const filter = node(ctx.createBiquadFilter());
    filter.type = p.filter.type;
    filter.Q.value = p.filter.q;
    const trem = gain(1 - p.lfo.depth * 0.5 * (p.lfo.target === 'amp'));
    const amp = gain(0);
    mix.connect(filter).connect(trem).connect(amp).connect(this.input);
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
    lfoFade('filter').connect(filter.detune);
    lfoFade('amp').connect(trem.gain);
    const pitchLfo = lfoFade('pitch');
    const pitchTargets = [];

    if (p.source === 'synth') {
      v.oscs = [];
      v.oscGains = [];
      let carrierFreqs = [];
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
          osc.detune.value = o.detune + spread * o.spread;
          let out = osc;
          if (o.unison > 1) {
            const pan = node(ctx.createStereoPanner());
            pan.pan.value = spread * 0.6;
            out = osc.connect(pan);
          }
          out.connect(g);
          v.sources.push(osc);
          v.oscs.push({ osc, ratio, index: i, spread });
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
      v.retune = (m, t) => {
        const f = tuner.freq(m);
        const tau = Math.max(0.003, v.patch.glide / 3);
        v.midi = m;
        for (const o of v.oscs) o.osc.frequency.setTargetAtTime(f * o.ratio, t, tau);
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
      const src = node(ctx.createBufferSource());
      src.buffer = this._pluckBuffer(freq, velocity);
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
    } else {
      // 멀티샘플(zones)이면 누른 음에서 가장 가까운 녹음을, 아니면 한 소리를 건반 전체에 늘려 쓴다
      const s = this.sample.zones ? pickZone(this.sample.zones, midi) : this.sample;
      const src = node(ctx.createBufferSource());
      src.buffer = s.buffer;
      src.playbackRate.value = freq / s.rootHz;
      if (s.loop) {
        src.loop = true;
        src.loopStart = s.loop.start;
        src.loopEnd = s.loop.end;
      }
      src.connect(mix);
      v.sources.push(src);
      v.sampleOffset = s.start;
      // 루프 없는 샘플은 끝까지 재생하고 멈춘다. stop 은 start 뒤에만 부를 수 있어 아래에서 예약한다.
      if (!s.loop) v.sampleStopAfter = (s.end - s.start) / src.playbackRate.value;
      pitchTargets.push(src.detune);
    }
    for (const param of pitchTargets) pitchLfo.connect(param);

    // 필터 엔벨로프 (세게 칠수록 조금 밝게)
    const fe = p.filterEnv;
    v.filterBase = clampHz(p.filter.cutoff * 2 ** ((p.filter.keytrack * (midi - 60)) / 12) * 2 ** ((velocity - 0.7) * 0.8));
    const peakF = clampHz(v.filterBase * 2 ** p.filter.env);
    filter.frequency.setValueAtTime(v.filterBase, when);
    if (Math.abs(p.filter.env) > 0.01) {
      filter.frequency.exponentialRampToValueAtTime(peakF, when + Math.max(0.002, fe.a));
      filter.frequency.setTargetAtTime(clampHz(v.filterBase * 2 ** (p.filter.env * fe.s)), when + Math.max(0.002, fe.a), Math.max(0.005, fe.d / 4));
    }
    // 볼륨 엔벨로프
    const ae = p.ampEnv;
    v.peakAmp = 0.32 * (0.35 + 0.65 * velocity);
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(v.peakAmp, when + Math.max(0.001, ae.a));
    amp.gain.setTargetAtTime(v.peakAmp * ae.s, when + Math.max(0.001, ae.a), Math.max(0.005, ae.d / 4));
    v.amp = amp;
    v.filter = filter;
    v.live = (np, now) => {
      filter.Q.setTargetAtTime(np.filter.q, now, 0.02);
      if (filter.type !== np.filter.type) filter.type = np.filter.type;
      if (v.oscGains) np.osc.forEach((o, i) => v.oscGains[i]?.gain.setTargetAtTime(o.level / Math.sqrt(o.unison), now, 0.02));
      if (v.oscs) for (const o of v.oscs) o.osc.detune.setTargetAtTime(np.osc[o.index].detune + o.spread * np.osc[o.index].spread, now, 0.02);
      v.noiseGain?.gain.setTargetAtTime(np.noise * 0.35, now, 0.02);
      const base = clampHz(np.filter.cutoff * 2 ** ((np.filter.keytrack * (v.midi - 60)) / 12));
      if (Math.abs(base - v.filterBase) / v.filterBase > 0.01 && now > v.start + np.filterEnv.a) {
        v.filterBase = base;
        filter.frequency.setTargetAtTime(clampHz(base * 2 ** (np.filter.env * np.filterEnv.s)), now, 0.03);
      }
    };
    for (const src of v.sources) src.start(when, p.source === 'sample' ? v.sampleOffset : 0);
    if (v.sampleStopAfter != null) v.sources[0].stop(when + v.sampleStopAfter);
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
      holdAt(v.filter.frequency, t, clampHz(v.filterBase * 2 ** (p.filter.env * envLevel(p.filterEnv, held))));
      v.filter.frequency.setTargetAtTime(v.filterBase, t, Math.max(0.005, (fastRelease ?? p.filterEnv.r) / 5));
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
    this.irs = new Map();
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

  irFor(seconds) {
    const key = Math.round(seconds * 4) / 4;
    if (!this.irs.has(key)) this.irs.set(key, makeIR(this.ctx, key));
    return this.irs.get(key);
  }

  /** 악기가 쓰는 환경. 튜닝·빠르기는 읽을 때마다 지금 값이라, 튜닝을 바꾸면 다음 음부터 바로 따른다. */
  env() {
    const studio = this;
    return {
      ctx: this.ctx,
      out: this.bus,
      get tuner() { return studio.tuner; },
      bpm: () => studio.bpm,
      irFor: (s) => studio.irFor(s),
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

/** 지금 음색으로 한 음(midi 가 배열이면 화음)을 미리 연주해 AudioBuffer 로 (샘플러의 '음색 굽기', 톤 재기, 테스트). */
export async function renderNote(patch, { midi = 57, seconds = 3, hold = 2.2, tuning = {}, sample = null, sampleRate = 44100, dry = true, velocity = 0.8 } = {}) {
  const ctx = new OfflineAudioContext(2, Math.round(sampleRate * seconds), sampleRate);
  const irs = new Map();
  const env = {
    ctx,
    out: ctx.destination,
    tuner: makeTuner(tuning),
    bpm: () => 72,
    irFor: (s) => {
      if (!irs.has(s)) irs.set(s, makeIR(ctx, s));
      return irs.get(s);
    },
  };
  const p = dry ? { ...patch, fx: { ...patch.fx, delay: 0, reverb: 0 } } : patch;
  const inst = new Instrument(env, p, sample);
  for (const m of [midi].flat()) {
    inst.noteOn(m, velocity, 0.01);
    inst.noteOff(m, hold);
  }
  return ctx.startRendering();
}
