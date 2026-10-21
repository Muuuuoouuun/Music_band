// 전환 효과음: 라이저(올라가는 바람), 다운리프터(내려앉음), 임팩트(쿵), 거꾸로 스웰(지금 음색 화음을 뒤집어
// 다음 마디 첫 박에 꽂힘). 모두 OfflineAudioContext 에 미리 그려 AudioBuffer 로 돌려준다 (같은 BPM 이면 길이가 박에 맞음).
import { impulseData, renderNote } from './engine.js';

export const TRANSITIONS = [
  { id: 'riser', label: '라이저', beats: 8, hint: '2마디 동안 올라가 다음 마디 첫 박에 끝나요', endsOnBeat: true },
  { id: 'reverse', label: '거꾸로 스웰', beats: 4, hint: '지금 음색 화음을 뒤집어 1마디 동안 빨려 들어가요', endsOnBeat: true },
  { id: 'impact', label: '임팩트', beats: 0, hint: '다음 마디 첫 박에 쿵', endsOnBeat: false },
  { id: 'down', label: '다운리프터', beats: 4, hint: '첫 박에서 시작해 1마디 동안 내려앉아요', endsOnBeat: false },
];

function noiseBuffer(ctx, seconds, seed = 5) {
  const n = Math.round(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  let s = seed;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = ((s = (s * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
  }
  return b;
}

function reverbOf(ctx, seconds) {
  const conv = ctx.createConvolver();
  const data = impulseData(ctx.sampleRate, seconds);
  const buf = ctx.createBuffer(2, data[0].length, ctx.sampleRate);
  data.forEach((d, c) => buf.copyToChannel(d, c));
  conv.buffer = buf;
  return conv;
}

/** 잔향과 섞어 내보내는 공통 출력 */
function outputs(ctx, wetAmount, size) {
  const dry = ctx.createGain();
  const verb = reverbOf(ctx, size);
  const wet = ctx.createGain();
  wet.gain.value = wetAmount;
  dry.connect(ctx.destination);
  dry.connect(verb).connect(wet).connect(ctx.destination);
  return dry;
}

/** 라이저: 좁은 대역의 바람이 위로 쓸려 올라가고, 톱니 두 개가 한 옥타브 반 올라간다. 끝에서 딱 멈춘다. */
export async function renderRiser(seconds, sr = 44100) {
  const ctx = new OfflineAudioContext(2, Math.round(sr * seconds), sr);
  const out = outputs(ctx, 0.35, 2.5);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, seconds);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 3;
  bp.frequency.setValueAtTime(250, 0);
  bp.frequency.exponentialRampToValueAtTime(9000, seconds);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, 0);
  ng.gain.exponentialRampToValueAtTime(0.5, seconds * 0.97);
  ng.gain.linearRampToValueAtTime(0, seconds);
  noise.connect(bp).connect(ng).connect(out);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(400, 0);
  lp.frequency.exponentialRampToValueAtTime(7000, seconds);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, 0);
  tg.gain.exponentialRampToValueAtTime(0.16, seconds * 0.97);
  tg.gain.linearRampToValueAtTime(0, seconds);
  lp.connect(tg).connect(out);
  for (const detune of [-12, 12]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = detune;
    o.frequency.setValueAtTime(130.8, 0);
    o.frequency.exponentialRampToValueAtTime(130.8 * 2 ** 1.5, seconds);
    o.connect(lp);
    o.start(0);
  }
  noise.start(0);
  return ctx.startRendering();
}

/** 다운리프터: 높은 바람이 아래로, 사인이 뚝 떨어진다. */
export async function renderDownlifter(seconds, sr = 44100) {
  const len = seconds + 1.2;
  const ctx = new OfflineAudioContext(2, Math.round(sr * len), sr);
  const out = outputs(ctx, 0.4, 3);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, len, 9);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(9000, 0);
  bp.frequency.exponentialRampToValueAtTime(220, seconds);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.45, 0);
  ng.gain.exponentialRampToValueAtTime(0.0001, seconds);
  noise.connect(bp).connect(ng).connect(out);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(660, 0);
  o.frequency.exponentialRampToValueAtTime(55, seconds);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.25, 0);
  og.gain.exponentialRampToValueAtTime(0.0001, seconds);
  o.connect(og).connect(out);
  noise.start(0);
  o.start(0);
  return ctx.startRendering();
}

/** 임팩트: 몸으로 느끼는 서브 '쿵'(70→32 Hz) + 짧은 잡음 + 긴 홀 잔향. 0초가 맞는 박. */
export async function renderImpact(sr = 44100) {
  const len = 4;
  const ctx = new OfflineAudioContext(2, Math.round(sr * len), sr);
  const out = outputs(ctx, 0.5, 4);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(70, 0);
  o.frequency.exponentialRampToValueAtTime(32, 0.9);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.6, 0);
  og.gain.setTargetAtTime(0, 0.05, 0.5);
  o.connect(og).connect(out);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 1, 13);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3000, 0);
  lp.frequency.exponentialRampToValueAtTime(200, 0.5);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.4, 0);
  ng.gain.setTargetAtTime(0, 0.005, 0.12);
  noise.connect(lp).connect(ng).connect(out);
  o.start(0);
  noise.start(0);
  return ctx.startRendering();
}

/** 거꾸로 스웰: 지금 음색으로 화음을 짧게 치고 잔향을 길게 남긴 소리를 뒤집는다. 끝(= 원래 첫 소리)이 맞는 박. */
export async function renderReverseSwell(patch, chord, seconds, { tuning = {}, library = null, sample = null, bpm = 72 } = {}) {
  const wet = { ...patch, fx: { ...patch.fx, reverb: Math.max(0.65, patch.fx.reverb), size: Math.max(4, patch.fx.size), delay: 0 }, ampEnv: { ...patch.ampEnv, a: 0.005, r: Math.max(1.5, patch.ampEnv.r) } };
  const buf = await renderNote(wet, { midi: chord, seconds, hold: Math.min(0.6, seconds * 0.2), dry: false, tuning, library, sample, velocity: 0.75, bpm });
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate });
  const fade = Math.round(buf.sampleRate * Math.min(0.5, seconds * 0.25));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const d = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) d[i] = src[src.length - 1 - i] * Math.min(1, i / fade);
  }
  return out;
}

/** 지금 박 위치로 다음 마디 첫 박 시각 고르기. 효과음이 needSec 만큼 앞서 시작해야 하면 그 뒤 마디로. */
export function nextDownbeat({ now, t0, beatSec, beatsPerBar }, needSec = 0, margin = 0.05) {
  const barSec = beatSec * beatsPerBar;
  const earliest = now + margin + needSec;
  const k = Math.max(0, Math.ceil((earliest - t0) / barSec - 1e-9));
  return t0 + k * barSec;
}
