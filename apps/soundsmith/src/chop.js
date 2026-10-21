// 샘플 패드(힙합 샘플링)의 계산: 소리 시작점 찾기, 박자 격자로 자르기, 0 지점에 붙이기, BPM 추정,
// 음 높이는 그대로 두고 길이만 바꾸기(WSOLA), 샘플레이트 낮추기(옛 샘플러 느낌), 데모 붐뱁 비트 만들기.
// 브라우저 없이 돌아가는 순수 함수만 둔다.

/**
 * 소리가 새로 시작하는 정도: 프레임마다 에너지(dB)의 오르막. 전체 대역(킥)과 고역 강조(스네어·하이햇)를
 * 따로 재서 더한다. energy 는 전체 대역 dB.
 */
export function onsetEnvelope(data, sr, hop = 512) {
  const frames = Math.floor(data.length / hop);
  const energy = new Float32Array(frames);
  const bright = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    let eh = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const hp = data[i] - 0.97 * prev;
      prev = data[i];
      e += data[i] * data[i];
      eh += hp * hp;
    }
    energy[f] = 10 * Math.log10(e / hop + 1e-10);
    bright[f] = 10 * Math.log10(eh / hop + 1e-10);
  }
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, energy[f] - energy[f - 1]) + Math.max(0, bright[f] - bright[f - 1]);
  return { flux, energy, hop, rate: sr / hop };
}

/**
 * 소리 시작점 (샘플 번호). sensitivity 0..1 (클수록 작은 소리도 잡음), minGap 초, max 개수까지 큰 것부터.
 * 첫 소리는 항상 넣는다.
 */
export function detectOnsets(data, sr, { sensitivity = 0.5, minGap = 0.07, max = 16, hop = 512 } = {}) {
  const { flux, energy } = onsetEnvelope(data, sr, hop);
  const n = flux.length;
  if (!n) return [0];
  const mean = flux.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(flux.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const thresh = mean + sd * (2.2 - 2 * sensitivity);
  const floor = Math.max(...energy) - 50;
  const peaks = [];
  for (let f = 1; f < n - 1; f++) {
    if (flux[f] > thresh && flux[f] >= flux[f - 1] && flux[f] > flux[f + 1] && energy[f] > floor) peaks.push({ f, v: flux[f] });
  }
  const gap = Math.round((minGap * sr) / hop);
  const picked = [];
  for (const p of peaks.sort((a, b) => b.v - a.v)) {
    if (picked.length >= max) break;
    if (picked.every((q) => Math.abs(q.f - p.f) >= gap)) picked.push(p);
  }
  // 오르막이 시작한 프레임으로 조금 당긴다 (북 어택이 잘리지 않게)
  const starts = picked.map((p) => Math.max(0, (p.f - 1) * hop)).sort((a, b) => a - b);
  const first = firstSound(data);
  if (!starts.length || starts[0] - first > gap * hop) starts.unshift(first);
  return starts.slice(0, max);
}

/** 처음으로 소리가 나는 곳 (가장 큰 값의 1% 를 넘는 곳) */
export function firstSound(data) {
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > peak * 0.01) return Math.max(0, i - 32);
  return 0;
}

/** 같은 길이로 n 조각 */
export function gridStarts(length, n) {
  return Array.from({ length: n }, (_, i) => Math.round((i * length) / n));
}

/** 시작점들 → [{ start, end }] (다음 시작점 바로 앞까지, 마지막은 끝까지) */
export function slicesFrom(starts, length) {
  const s = [...new Set(starts)].filter((x) => x >= 0 && x < length).sort((a, b) => a - b);
  return s.map((start, i) => ({ start, end: i + 1 < s.length ? s[i + 1] : length }));
}

/** i 근처(±radius)에서 가장 가까운 0 지점 (오르막). 없으면 그대로. */
export function nearestZero(data, i, radius = 256) {
  for (let d = 0; d <= radius; d++) {
    for (const j of [i - d, i + d]) {
      if (j > 0 && j < data.length && data[j - 1] <= 0 && data[j] > 0) return j;
    }
  }
  return i;
}

/**
 * BPM 추정: 시작점 곡선의 자기상관을 박의 1·2·3·4배 자리까지 더한 값(빗살)이 가장 큰 주기.
 * 예배·힙합 템포에 맞게 70..140 안으로 두 배·절반을 맞춘다. { bpm, confidence(0..1) }
 */
export function estimateTempo(data, sr, { minBpm = 60, maxBpm = 190, hop = 256 } = {}) {
  const { flux: raw, rate } = onsetEnvelope(data, sr, hop);
  const n = raw.length;
  // 살짝 뭉개서 프레임 경계에 걸친 박도 한 봉우리로 (박이 프레임 수로 딱 나누어떨어지지 않아도)
  const k = [1, 2, 3, 4, 3, 2, 1];
  const flux = raw.map((_, i) => k.reduce((s, w, j) => s + w * (raw[i + j - 3] ?? 0), 0) / 16);
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const x = flux.map((v) => v - mean);
  const ac = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    return s / (n - lag);
  };
  const zero = ac(0) || 1;
  const lo = Math.floor((60 / maxBpm) * rate);
  const hi = Math.ceil((60 / minBpm) * rate);
  const near = (lag) => (lag + 1 < n ? ac(lag) + 0.5 * (ac(lag - 1) + ac(lag + 1)) : 0);
  let best = null;
  for (let lag = Math.max(1, lo); lag <= Math.min(n - 2, hi); lag++) {
    // 이웃 칸까지 더해 프레임 경계에 걸친 박도 잡고, 박의 배수 자리(마디)가 함께 강한 주기를 고른다
    const v = near(lag) + 0.75 * near(2 * lag) + 0.5 * near(3 * lag) + 0.4 * near(4 * lag);
    if (!best || v > best.v) best = { lag, v };
  }
  if (!best) return { bpm: 0, confidence: 0 };
  // 꼭짓점 사이를 포물선으로 다듬어 소수 프레임까지
  const a = ac(best.lag - 1);
  const b = ac(best.lag);
  const c = ac(best.lag + 1);
  const shift = a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  let bpm = (60 * rate) / (best.lag + Math.max(-0.5, Math.min(0.5, shift)));
  while (bpm < 70) bpm *= 2;
  while (bpm >= 140) bpm /= 2;
  // 두 배·절반이 헷갈릴 때: 빗살 점수에 '보통 템포(95 근처)' 가중을 곱해 고른다
  const comb = (lag) => near(lag) + 0.75 * near(2 * lag) + 0.5 * near(3 * lag) + 0.4 * near(4 * lag);
  const prior = (b) => Math.exp(-0.5 * (Math.log2(b / 95) / 0.6) ** 2);
  const lagOf = (b) => Math.round((60 * rate) / b);
  const choices = [bpm, bpm / 2, bpm * 2].filter((b) => b >= 60 && b <= 180 && lagOf(b) * 4 < n);
  bpm = choices.reduce((a, b) => (comb(lagOf(b)) * prior(b) > comb(lagOf(a)) * prior(a) ? b : a));
  return { bpm: Math.round(bpm * 10) / 10, confidence: Math.max(0, Math.min(1, best.v / 2.65 / 2 / zero)) };
}

/**
 * 음 높이는 그대로, 길이만 factor 배 (2 = 두 배 느리게). WSOLA: 겹치는 창을 옮겨 붙이되,
 * 붙일 자리 근처에서 이어지는 모양이 가장 비슷한 곳을 찾아 붙여 '찌직'이 덜하다.
 */
export function timeStretch(data, factor, { frame = 2048, tolerance = 384 } = {}) {
  if (Math.abs(factor - 1) < 1e-3) return Float32Array.from(data);
  const hopOut = frame / 2;
  const hopIn = hopOut / factor;
  const outLen = Math.round(data.length * factor);
  const out = new Float32Array(outLen + frame);
  const norm = new Float32Array(outLen + frame);
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
  const at = (i) => (i >= 0 && i < data.length ? data[i] : 0);
  let prevPos = 0;
  const cmpLen = 256;
  for (let k = 0; k * hopOut < outLen; k++) {
    const target = Math.round(k * hopIn);
    let pos = target;
    if (k > 0) {
      // 앞 조각이 자연스럽게 이어졌을 자리와 가장 비슷한 곳 찾기
      const natural = prevPos + hopOut;
      let best = -Infinity;
      for (let d = -tolerance; d <= tolerance; d += 4) {
        const cand = target + d;
        let s = 0;
        for (let i = 0; i < cmpLen; i += 2) s += at(natural + i) * at(cand + i);
        if (s > best) {
          best = s;
          pos = cand;
        }
      }
    }
    const o = k * hopOut;
    for (let i = 0; i < frame; i++) {
      out[o + i] += at(pos + i) * win[i];
      norm[o + i] += win[i];
    }
    prevPos = pos;
  }
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  return res;
}

/** 샘플레이트 낮추기 흉내: factor 칸마다 한 값을 잡아 둔다 (SP-1200·MPC60 의 거친 고음). */
export function holdDecimate(data, factor) {
  if (factor <= 1) return data;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[Math.floor(Math.floor(i / factor) * factor)];
  return out;
}

// ---------------------------------------------------------------------------
// 데모 비트: 우리가 직접 합성한 2마디 붐뱁 (저작권 걱정 없이 잘라 보기 연습용)
// ---------------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

function addKick(x, at, sr, gain = 0.9) {
  const n = Math.round(sr * 0.5);
  let ph = 0;
  for (let i = 0; i < n && at + i < x.length; i++) {
    const t = i / sr;
    const f = 48 + 110 * Math.exp(-t / 0.03);
    ph += (2 * Math.PI * f) / sr;
    x[at + i] += gain * Math.sin(ph) * Math.exp(-t / 0.18) * Math.min(1, i / 20);
  }
}

function addSnare(x, at, sr, r, gain = 0.6) {
  const n = Math.round(sr * 0.3);
  let lp = 0;
  for (let i = 0; i < n && at + i < x.length; i++) {
    const t = i / sr;
    lp += (r() - lp) * 0.5;
    const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.05);
    x[at + i] += gain * (0.55 * lp * Math.exp(-t / 0.09) + 0.45 * body) * Math.min(1, i / 10);
  }
}

function addHat(x, at, sr, r, gain = 0.18, open = false) {
  const n = Math.round(sr * (open ? 0.25 : 0.06));
  let prev = 0;
  for (let i = 0; i < n && at + i < x.length; i++) {
    const t = i / sr;
    const v = r();
    const hp = v - prev;
    prev = v;
    x[at + i] += gain * hp * Math.exp(-t / (open ? 0.08 : 0.018));
  }
}

function addStab(x, at, sr, midis, seconds, gain = 0.16) {
  const n = Math.round(sr * seconds);
  for (const m of midis) {
    const f = 440 * 2 ** ((m - 69) / 12);
    for (let i = 0; i < n && at + i < x.length; i++) {
      const t = i / sr;
      const env = Math.min(1, i / 60) * Math.exp(-t / 0.6);
      x[at + i] += gain * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.2));
    }
  }
}

/** 90 BPM 2마디, 16분 스윙 58%. 킥·스네어·하이햇·건반 화음 (Am9 → Fmaj7). */
export function demoBeat(sr = 44100, bpm = 90) {
  const beat = 60 / bpm;
  const bars = 2;
  const x = new Float32Array(Math.round(sr * beat * 4 * bars) + Math.round(sr * 0.6));
  const r = rng(7);
  const sixteenth = beat / 4;
  const swing = 0.58;
  const at = (step) => Math.round(sr * (Math.floor(step / 2) * 2 * sixteenth + (step % 2 ? (swing * 2) * sixteenth : 0)));
  const kicks = [0, 7, 10, 16, 23, 26];
  const snares = [4, 12, 20, 28];
  for (let b = 0; b < bars; b++) {
    for (const k of kicks.filter((s) => s < 16)) addKick(x, at(b * 16 + k), sr);
    for (const s of snares.filter((v) => v < 16)) addSnare(x, at(b * 16 + s), sr, r);
    for (let h = 0; h < 16; h += 2) addHat(x, at(b * 16 + h), sr, r, h % 4 ? 0.12 : 0.18, h === 14);
  }
  addStab(x, at(0), sr, [57, 60, 64, 67, 71], beat * 3.5);
  addStab(x, at(16), sr, [53, 57, 60, 64], beat * 3.5);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < x.length; i++) x[i] = (x[i] / (peak || 1)) * 0.85;
  return { data: x, sr, bpm, name: '데모 비트 · 직접 합성한 붐뱁 90 BPM', length: Math.round(sr * beat * 4 * bars) };
}
