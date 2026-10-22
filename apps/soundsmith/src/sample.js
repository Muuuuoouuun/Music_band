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

// ---------------------------------------------------------------------------
// 로컬 멀티샘플 (건반 곳곳을 서로 다른 녹음으로 채우는 악기). 저장소에는 샘플을 넣지 않고,
// 사용자가 자기 컴퓨터의 local-samples/ 폴더에 둔 파일만 쓴다. 아래는 브라우저 API 없이 검사할 수 있는 순수 함수.
// ---------------------------------------------------------------------------

const NOTE_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * 파일 이름에서 음과 벨로시티 층을 읽는다. 'C4.wav' · 'F#3.flac' · 'Bb2' · 'Ds1v8' (s = 샬프, Salamander 식) ·
 * 'Woodland_A4_v2.ogg' · '60.wav'(MIDI 번호). 못 읽으면 null. C4 = 60.
 */
export function parseSampleName(file) {
  const base = String(file).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  const m = base.match(/(?:^|[^A-Za-z#])([A-Ga-g])([#sb]?)(-?\d)(?!\d)/);
  let midi = null;
  let rest = '';
  if (m) {
    const acc = m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0;
    midi = (Number(m[3]) + 1) * 12 + NOTE_PC[m[1].toLowerCase()] + acc;
    rest = base.slice(m.index + m[0].length);
  } else if (/^\d{1,3}$/.test(base) && Number(base) <= 127) {
    midi = Number(base);
  }
  if (midi == null || midi < 0 || midi > 127) return null;
  const l = rest.match(/v(?:el)?[-_ ]?(\d+)/i);
  return { midi, layer: l ? Number(l[1]) : null };
}

/** local-samples/<세트>/set.json 을 믿고 쓸 수 있는 모양으로. 쓸 수 없으면 null. */
export function normalizeSetManifest(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.zones)) return null;
  const zones = raw.zones
    .filter((z) => z && typeof z.file === 'string' && z.file && !/^(\/|[a-z]+:|.*\.\.)/i.test(z.file) && Number.isInteger(z.root) && z.root >= 0 && z.root <= 127)
    .map((z) => ({ file: z.file, root: z.root, layer: Number.isInteger(z.layer) ? z.layer : null }));
  if (!zones.length) return null;
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return { v: 1, name: str(raw.name, 40) || '로컬 샘플', credit: str(raw.credit, 200), license: str(raw.license, 80), zones };
}

/**
 * 같은 음에 벨로시티 층이 여러 개면 하나만 고른다 (메모리를 아끼려고). 층 번호가 있는 파일 전체의 가운데 층에 가장 가까운 것.
 * 층 번호가 없는 파일은 그대로 둔다. 결과는 음 높이 순.
 */
export function pickLayers(zones, target = null) {
  const layers = [...new Set(zones.map((z) => z.layer).filter((l) => l != null))].sort((a, b) => a - b);
  const want = target ?? (layers.length ? layers[Math.floor((layers.length - 1) / 2)] : null);
  const byRoot = new Map();
  for (const z of zones) {
    const cur = byRoot.get(z.root);
    const dist = (q) => (q.layer == null || want == null ? 0 : Math.abs(q.layer - want));
    if (!cur || dist(z) < dist(cur)) byRoot.set(z.root, z);
  }
  return [...byRoot.values()].sort((a, b) => a.root - b.root);
}

/** 연주할 음에서 가장 가까운 녹음 (같은 거리면 낮은 쪽 — 위로 올리는 것보다 아래로 내리는 게 더 자연스럽다). */
export function pickZone(zones, midi) {
  let best = null;
  for (const z of zones) {
    const d = Math.abs(z.root - midi);
    if (!best || d < best.d || (d === best.d && z.root < best.z.root)) best = { z, d };
  }
  return best?.z ?? null;
}
