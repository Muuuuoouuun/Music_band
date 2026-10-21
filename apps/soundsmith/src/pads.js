// 샘플 패드 소리: 소리 하나를 16조각으로 나눠 패드마다 음높이·거꾸로·필터·어택/릴리즈·끊김 그룹으로 울린다.
// 패드 묶음(kit) 전체에 비트 줄이기·로파이(테이프 흔들림·바이닐 잡음)·샘플레이트 낮추기를 건다.
// 같은 PadKit 을 OfflineAudioContext 에 만들면 패턴을 WAV 로 굽는다.
import { makeBits, makeLofi } from './fx.js';
import { holdDecimate } from './chop.js';

export const PAD_COUNT = 16;
export const STEPS = 16;
export const CHOKES = [
  { id: 0, label: '없음' },
  { id: 1, label: 'A' },
  { id: 2, label: 'B' },
  { id: 3, label: 'C' },
];
// 옛 샘플러 느낌의 샘플레이트 (44.1 kHz 를 몇 칸씩 잡아 둘지)
export const RATES = [
  { id: 44100, label: '44.1k', factor: 1 },
  { id: 26040, label: '26k (SP-1200)', factor: 44100 / 26040 },
  { id: 12000, label: '12k', factor: 44100 / 12000 },
];

/** 컴퓨터 건반 A W S E … 가 C4(60)부터라 패드 1 = C4 */
export const PAD_BASE_MIDI = 60;

export function defaultPad(slice) {
  return { start: slice.start, end: slice.end, pitch: 0, reverse: false, gain: 0.85, cutoff: 18000, attack: 0.002, release: 0.06, choke: 0, mode: 'oneshot' };
}

/** 4박 붐뱁 기본 패턴: 1번 조각(킥) 1·3박 근처, 2번(스네어) 2·4박, 3번 8분 하이햇 */
export function starterPattern(slices = 16) {
  const steps = Array.from({ length: PAD_COUNT }, () => new Array(STEPS).fill(0));
  if (slices > 0) for (const s of [0, 7, 10]) steps[0][s] = 2;
  if (slices > 1) for (const s of [4, 12]) steps[1][s] = 2;
  if (slices > 2) for (let s = 0; s < STEPS; s += 2) steps[2][s] = s % 4 ? 1 : 2;
  return steps;
}

/**
 * 원래 순서대로: 첫 마디(16분 16칸) 안에서 시작하는 조각을 원래 자리에 놓는다.
 * 잘라 놓은 비트를 그대로 다시 들려주는 출발점 (여기서 칸을 옮기며 새 비트를 만든다).
 */
export function replayPattern(pads, sr, bpm) {
  const steps = Array.from({ length: PAD_COUNT }, () => new Array(STEPS).fill(0));
  const stepSec = 60 / bpm / 4;
  const first = Math.min(...pads.map((p) => p.start));
  const used = new Set();
  pads.forEach((p, i) => {
    if (used.has(p.start)) return;
    used.add(p.start);
    const s = Math.round((p.start - first) / sr / stepSec);
    if (s >= 0 && s < STEPS) steps[i][s] = s % 4 === 0 ? 2 : 1;
  });
  return steps;
}

/** 스윙: 16분 둘씩 묶어 두 번째를 늦춘다. swing 0.5 = 곧게, 0.66 ≈ 셋잇단 느낌. 돌려주는 값은 박 단위. */
export function stepBeat(step, swing) {
  const pair = Math.floor(step / 2);
  return pair * 0.5 + (step % 2 ? swing * 0.5 : 0);
}

export class PadKit {
  /** ctx 에 패드 소리 묶음을 만들고 out 으로 내보낸다 */
  constructor(ctx, out) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.bits = makeBits(ctx);
    this.lofi = makeLofi(ctx);
    this.volume = ctx.createGain();
    this.volume.gain.value = 0.9;
    this.input.connect(this.bits.input);
    this.bits.output.connect(this.lofi.input);
    this.lofi.output.connect(this.volume).connect(out);
    this.voices = new Set();
    this.held = new Map();
    this.buffer = null;
    this.source = null;
    this.reversed = null;
    this.pads = [];
    this.fx = { bits: 16, lofi: 0, rate: 44100 };
    this.setFx(this.fx);
  }

  /** data: Float32Array (모노), sr */
  setSource(data, sr) {
    this.source = { data, sr };
    this._bake();
  }

  /** 샘플레이트 낮추기는 소리 자체를 다시 만들어 둔다 (실시간 노드로는 안 되므로) */
  _bake() {
    if (!this.source) return;
    const { data, sr } = this.source;
    const rate = RATES.find((r) => r.id === this.fx.rate) ?? RATES[0];
    const baked = holdDecimate(data, rate.factor * (sr / 44100));
    const make = (d) => {
      const b = this.ctx.createBuffer(1, d.length, sr);
      b.copyToChannel(d, 0);
      return b;
    };
    this.buffer = make(baked);
    const rev = new Float32Array(baked.length);
    for (let i = 0; i < baked.length; i++) rev[i] = baked[baked.length - 1 - i];
    this.reversed = make(rev);
    this.bakedRate = this.fx.rate;
  }

  setFx(fx) {
    this.fx = { ...this.fx, ...fx };
    const now = this.ctx.currentTime;
    this.bits.set({ bits: this.fx.bits }, now);
    this.lofi.set({ lofi: this.fx.lofi }, now);
    if (this.source && this.bakedRate !== this.fx.rate) this._bake();
  }

  setPads(pads) {
    this.pads = pads;
  }

  trigger(i, when = this.ctx.currentTime, velocity = 0.85) {
    const pad = this.pads[i];
    if (!pad || !this.buffer) return null;
    const ctx = this.ctx;
    // 같은 끊김 그룹(예: 열린·닫힌 하이햇)은 서로 멈춘다
    if (pad.choke) for (const v of this.voices) if (v.choke === pad.choke) this._stop(v, when, 0.01);
    const sr = this.buffer.sampleRate;
    const len = (pad.end - pad.start) / sr;
    const rate = 2 ** (pad.pitch / 12);
    const src = ctx.createBufferSource();
    src.buffer = pad.reverse ? this.reversed : this.buffer;
    src.playbackRate.value = rate;
    const offset = pad.reverse ? (this.buffer.length - pad.end) / sr : pad.start / sr;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = pad.cutoff;
    filter.Q.value = 0.7;
    const amp = ctx.createGain();
    const peak = pad.gain * (0.45 + 0.55 * velocity);
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(peak, when + Math.max(0.001, pad.attack));
    src.connect(filter).connect(amp).connect(this.input);
    const dur = len / rate;
    src.start(when, offset, len + 0.05);
    const v = { src, amp, choke: pad.choke, pad: i, peak, start: when, stopped: false };
    if (pad.mode === 'oneshot') {
      const relAt = when + Math.max(pad.attack + 0.005, dur - pad.release);
      amp.gain.setValueAtTime(peak, relAt);
      amp.gain.linearRampToValueAtTime(0, relAt + pad.release);
      src.stop(relAt + pad.release + 0.01);
    }
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      amp.disconnect();
      this.voices.delete(v);
      if (![...this.voices].length) this.lofi.gate(false, this.ctx.currentTime);
    };
    this.lofi.gate(true, when);
    this.voices.add(v);
    return v;
  }

  _stop(v, when, release) {
    if (v.stopped) return;
    v.stopped = true;
    const t = Math.max(when, this.ctx.currentTime);
    v.amp.gain.cancelScheduledValues(t);
    v.amp.gain.setValueAtTime(v.amp.gain.value, t);
    v.amp.gain.linearRampToValueAtTime(0, t + release);
    try { v.src.stop(t + release + 0.01); } catch { /* 이미 멈춤 */ }
  }

  // 건반·컴퓨터 키로 칠 때 (app.keyTarget)
  noteOn(midi, velocity = 0.85) {
    const i = midi - PAD_BASE_MIDI;
    if (i < 0 || i >= PAD_COUNT) return null;
    const v = this.trigger(i, this.ctx.currentTime, velocity);
    if (v) this.held.set(midi, v);
    return i;
  }

  noteOff(midi) {
    const v = this.held.get(midi);
    this.held.delete(midi);
    if (v && this.pads[v.pad]?.mode === 'gate') this._stop(v, this.ctx.currentTime, this.pads[v.pad].release);
  }

  sustain() {}

  allOff() {
    for (const v of this.voices) this._stop(v, this.ctx.currentTime, 0.02);
  }
}

/** 패턴을 WAV 로 굽기: loops 바퀴만큼 (16분 STEPS 칸 = 1마디). 돌려주는 값은 AudioBuffer. */
export async function renderPattern({ data, sr, pads, steps, fx, bpm, swing, loops = 2, tail = 1.5 }) {
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const ctx = new OfflineAudioContext(2, Math.round(44100 * (barSec * loops + tail)), 44100);
  const kit = new PadKit(ctx, ctx.destination);
  kit.setFx(fx);
  kit.setSource(data, sr);
  kit.setPads(pads);
  for (let loop = 0; loop < loops; loop++) {
    for (let s = 0; s < STEPS; s++) {
      for (let p = 0; p < PAD_COUNT; p++) {
        const v = steps[p][s];
        if (v) kit.trigger(p, 0.01 + loop * barSec + stepBeat(s, swing) * beatSec, v === 2 ? 1 : 0.7);
      }
    }
  }
  return ctx.startRendering();
}
