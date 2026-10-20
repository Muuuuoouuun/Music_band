// 샘플 다듬기: 무음 자르기, 음높이 찾기(YIN), 루프 지점 찾기, 이음새 크로스페이드, 왕복 루프 굽기,
// 파형 그림용 요약, WAV·SFZ 내보내기. 브라우저 API 없이 Float32Array 만 다뤄서 노드에서도 검사한다.

export function toMono(channels) {
  if (channels.length === 1) return Float32Array.from(channels[0]);
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

export function peakOf(x, start = 0, end = x.length) {
  let p = 0;
  for (let i = start; i < end; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** 앞뒤 무음 자르기: 10ms 창 RMS 가 최고점보다 thresholdDb 아래인 구간을 버린다. */
export function trimSilence(x, sr, { thresholdDb = -45, padMs = 4 } = {}) {
  const win = Math.max(1, Math.round(sr * 0.01));
  const frames = Math.ceil(x.length / win);
  const rms = new Float32Array(frames);
  let top = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const a = f * win;
    const b = Math.min(x.length, a + win);
    for (let i = a; i < b; i++) s += x[i] * x[i];
    rms[f] = Math.sqrt(s / Math.max(1, b - a));
    top = Math.max(top, rms[f]);
  }
  if (top === 0) return { start: 0, end: x.length };
  const floor = top * 10 ** (thresholdDb / 20);
  let first = 0;
  while (first < frames - 1 && rms[first] < floor) first++;
  let last = frames - 1;
  while (last > first && rms[last] < floor) last--;
  const pad = Math.round((sr * padMs) / 1000);
  return { start: Math.max(0, first * win - pad), end: Math.min(x.length, (last + 1) * win + pad) };
}

function yinFrame(x, offset, w, tauMin, tauMax, threshold) {
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const diff = x[offset + i] - x[offset + i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  // 누적 평균으로 나눈 차이 (YIN 2단계)
  let run = 0;
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    cmnd[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let tau = tauMin;
  while (tau < tauMax && cmnd[tau] >= threshold) tau++;
  if (tau >= tauMax) return null;
  while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
  // 포물선 보간으로 샘플 사이 위치
  const a = cmnd[tau - 1] ?? cmnd[tau];
  const b = cmnd[tau];
  const c = cmnd[tau + 1] ?? cmnd[tau];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return { period: tau + Math.max(-1, Math.min(1, shift)), clarity: 1 - b };
}

/** 음높이 찾기: 소리의 가운데 부분 여러 창의 YIN 결과 중앙값. */
export function detectPitch(x, sr, { start = 0, end = x.length, minHz = 40, maxHz = 2000, threshold = 0.15 } = {}) {
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.ceil(sr / minHz);
  const w = Math.max(tauMax, Math.round(sr * 0.03));
  const span = end - start;
  if (span < w + tauMax + 1) return null;
  const from = start + Math.floor(span * 0.2);
  const to = Math.max(from + 1, start + Math.floor(span * 0.75) - w - tauMax);
  const found = [];
  const frames = 9;
  for (let k = 0; k < frames; k++) {
    const offset = Math.min(end - w - tauMax - 1, Math.round(from + ((to - from) * k) / (frames - 1)));
    if (offset < start) continue;
    if (peakOf(x, offset, offset + w) < 1e-4) continue;
    const r = yinFrame(x, offset, w, tauMin, tauMax, threshold);
    if (r) found.push(r);
  }
  if (found.length < 3) return null;
  found.sort((p, q) => p.period - q.period);
  const mid = found[Math.floor(found.length / 2)];
  const hz = sr / mid.period;
  const midi = 69 + 12 * Math.log2(hz / 440);
  const note = Math.round(midi);
  const clarity = found.reduce((s, f) => s + f.clarity, 0) / found.length;
  return { hz, midi, note, cents: (midi - note) * 100, clarity };
}

/** 위로 올라가며 0 을 지나는 지점들 (from..to). */
export function upwardZeroCrossings(x, from, to) {
  const out = [];
  for (let i = Math.max(1, from); i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) out.push(i);
  return out;
}

function seamCost(x, a, b, half) {
  let diff = 0;
  let energy = 1e-9;
  for (let i = -half; i < half; i++) {
    const p = x[a + i];
    const q = x[b + i];
    diff += (p - q) ** 2;
    energy += p * p + q * q;
  }
  return diff / energy;
}

/**
 * 루프 지점 찾기: 끝 근처의 0 지점을 루프 끝으로 두고, 소리의 지속 구간에서 그 주변 파형과 가장 닮은
 * 0 지점을 루프 시작으로 고른다. 음높이를 알면 주기의 정수배 길이를 우선한다.
 * 반환 cost: 0 = 이음새가 완벽, 1 이상 = 크게 튐.
 */
export function findLoop(x, sr, { start = 0, end = x.length, hz = null } = {}) {
  const len = end - start;
  const half = Math.max(32, Math.round(hz ? (sr / hz) * 1.5 : sr * 0.004));
  const sustainFrom = start + Math.floor(len * 0.3);
  const endZone = upwardZeroCrossings(x, start + Math.floor(len * 0.8), end - half - 1);
  if (!endZone.length) return null;
  const loopEnd = endZone[Math.floor(endZone.length * 0.6)];
  const minLen = Math.max(Math.round(sr * 0.08), hz ? Math.round((sr / hz) * 4) : 0);
  let cands = upwardZeroCrossings(x, Math.max(sustainFrom, start + half + 1), loopEnd - minLen);
  if (!cands.length) return null;
  if (cands.length > 1500) {
    const step = cands.length / 1500;
    cands = Array.from({ length: 1500 }, (_, k) => cands[Math.floor(k * step)]);
  }
  const period = hz ? sr / hz : null;
  let best = null;
  for (const ls of cands) {
    let cost = seamCost(x, ls, loopEnd, half);
    if (period) {
      const cycles = (loopEnd - ls) / period;
      cost += 0.5 * Math.abs(cycles - Math.round(cycles)) / Math.max(1, Math.round(cycles));
    }
    // 같은 값이면 긴 루프가 자연스럽다
    cost -= 0.02 * ((loopEnd - ls) / len);
    if (!best || cost < best.cost) best = { loopStart: ls, loopEnd, cost };
  }
  best.cost = Math.max(0, seamCost(x, best.loopStart, best.loopEnd, half));
  return best;
}

/**
 * 이음새 크로스페이드: 루프 끝 직전 n 샘플을, 루프 시작 직전 n 샘플과 같은 힘으로 섞는다.
 * 그러면 루프 끝에 다다른 소리가 루프 시작 바로 앞의 소리가 되어 매끄럽게 이어진다.
 */
export function crossfadeLoop(x, loopStart, loopEnd, n) {
  const out = Float32Array.from(x);
  const len = Math.min(n, loopStart, loopEnd - loopStart);
  for (let i = 0; i < len; i++) {
    const w = (i + 1) / (len + 1);
    const fadeIn = Math.sin((w * Math.PI) / 2);
    const fadeOut = Math.cos((w * Math.PI) / 2);
    const k = loopEnd - len + i;
    out[k] = x[k] * fadeOut + x[loopStart - len + i] * fadeIn;
  }
  return out;
}

/** 왕복 루프: 루프 구간을 거꾸로 한 번 더 이어 붙여, 앞으로만 도는 루프로 왕복을 흉내 낸다. */
export function bakePingPong(x, loopStart, loopEnd) {
  const seg = loopEnd - loopStart;
  const out = new Float32Array(loopEnd + seg);
  out.set(x.subarray(0, loopEnd));
  for (let i = 0; i < seg; i++) out[loopEnd + i] = x[loopEnd - 1 - i];
  return { data: out, loopStart, loopEnd: loopEnd + seg };
}

/**
 * 실제로 들리는 이음새의 어긋남: 루프 끝 직전 half 샘플과 루프 시작 직전 half 샘플이 얼마나 닮았나.
 * 루프 끝에서 시작으로 뛰어도 '바로 앞까지의 소리'가 같으면 튀지 않는다. 0 = 완벽.
 */
export function seamBefore(x, loopStart, loopEnd, half) {
  const n = Math.min(half, loopStart, loopEnd - loopStart);
  let diff = 0;
  let energy = 1e-9;
  for (let i = 1; i <= n; i++) {
    const p = x[loopEnd - i];
    const q = x[loopStart - i];
    diff += (p - q) ** 2;
    energy += p * p + q * q;
  }
  return n > 0 ? diff / energy : 1;
}

/**
 * 연주용으로 굽기: 시작~끝만 잘라 루프 방식대로 이음새를 다듬고, 최고점을 -1dB 로 맞출 배율을 구한다.
 * 위치는 모두 잘라낸 소리 기준 샘플 번호.
 */
export function bakeSample(s) {
  const region = s.data.slice(s.start, s.end);
  let data = region;
  let loop = null;
  let seamCost = null;
  if (s.loopMode !== 'off' && s.loopEnd > s.loopStart) {
    const ls = s.loopStart - s.start;
    const le = s.loopEnd - s.start;
    if (s.loopMode === 'forward') {
      data = crossfadeLoop(region, ls, le, Math.round((s.xfadeMs / 1000) * s.sr));
      loop = { start: ls, end: le };
      const half = Math.round(s.detected ? (1.5 * s.sr) / s.detected.hz : s.sr * 0.004);
      seamCost = seamBefore(data, ls, le, Math.max(16, half));
    } else {
      const b = bakePingPong(region, ls, le);
      data = b.data;
      loop = { start: b.loopStart, end: b.loopEnd };
    }
  }
  return { data, loop, seamCost, gain: normalizeGain(data, 0, data.length, -1) };
}

/** 파형 그림용: 칸마다 [최솟값, 최댓값]. */
export function peaks(x, buckets, start = 0, end = x.length) {
  const out = new Float32Array(buckets * 2);
  const span = Math.max(1, end - start);
  for (let b = 0; b < buckets; b++) {
    const a = start + Math.floor((b * span) / buckets);
    const z = Math.max(a + 1, start + Math.floor(((b + 1) * span) / buckets));
    let lo = 0;
    let hi = 0;
    for (let i = a; i < z && i < x.length; i++) {
      if (x[i] < lo) lo = x[i];
      if (x[i] > hi) hi = x[i];
    }
    out[b * 2] = lo;
    out[b * 2 + 1] = hi;
  }
  return out;
}

export function normalizeGain(x, start, end, targetDb = -1) {
  const p = peakOf(x, start, end);
  return p > 0 ? 10 ** (targetDb / 20) / p : 1;
}

/** 16비트 모노 WAV. gain 을 곱해 담는다. */
export function encodeWav(x, sr, { start = 0, end = x.length, gain = 1 } = {}) {
  const n = Math.max(0, end - start);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, x[start + i] * gain));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return new Uint8Array(buf);
}

/**
 * 무료 SFZ 플레이어(sfizz, Sforzando 등)에서 여는 악기 정의. 위치는 내보낸 WAV 기준 샘플 번호.
 * tune: 샘플을 몇 cent 올려 재생할지 (6 cent 낮게 녹음된 소리면 +6).
 */
export function sfzText({ file, name, root, tune = 0, loop = null, env }) {
  const pct = (v) => Math.round(v * 1000) / 10;
  const lines = [
    `// ${name} — 음색 공방에서 만든 샘플 악기`,
    '<control>',
    'default_path=./',
    '<global>',
    `ampeg_attack=${env.a.toFixed(3)} ampeg_decay=${env.d.toFixed(3)} ampeg_sustain=${pct(env.s)} ampeg_release=${env.r.toFixed(3)}`,
    '<region>',
    `sample=${file}`,
    `pitch_keycenter=${root} tune=${Math.round(tune)}`,
    'lokey=0 hikey=127',
  ];
  if (loop) lines.push(`loop_mode=loop_continuous loop_start=${loop.start} loop_end=${loop.end - 1}`);
  else lines.push('loop_mode=no_loop');
  return `${lines.join('\n')}\n`;
}

/** 권한 없이 바로 쓰는 데모 소리: 활로 켠 듯한 A2(110Hz), 3초, 늦게 시작하는 비브라토. */
export function demoSample(sr = 44100, seconds = 3, hz = 110) {
  const n = Math.round(sr * seconds);
  const out = new Float32Array(n);
  let s = 12345;
  const noise = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const vib = t > 0.9 ? 0.004 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, (t - 0.9) / 0.6) : 0;
    phase += (hz * (1 + vib)) / sr;
    let v = 0;
    for (let h = 1; h <= 18; h++) {
      const formant = 1 + 1.4 * Math.exp(-0.5 * ((h * hz - 700) / 260) ** 2) + 0.8 * Math.exp(-0.5 * ((h * hz - 1500) / 300) ** 2);
      v += (formant / h) * Math.sin(2 * Math.PI * h * phase);
    }
    const attack = Math.min(1, t / 0.12);
    const release = Math.min(1, (seconds - t) / 0.25);
    out[i] = 0.18 * v * attack * attack * release + 0.01 * noise() * Math.exp(-t * 18);
  }
  return out;
}

/** 거꾸로 (리버스 패드·스웰). */
export function reversed(x) {
  return Float32Array.from(x).reverse();
}

/** 앞뒤 페이드 (ms). 사인 곡선이라 끝이 부드럽다. */
export function withFades(x, sr, inMs = 0, outMs = 0) {
  const out = Float32Array.from(x);
  const a = Math.min(out.length, Math.round((sr * inMs) / 1000));
  const b = Math.min(out.length, Math.round((sr * outMs) / 1000));
  for (let i = 0; i < a; i++) out[i] *= Math.sin(((i / a) * Math.PI) / 2);
  for (let i = 0; i < b; i++) out[out.length - 1 - i] *= Math.sin(((i / b) * Math.PI) / 2);
  return out;
}
