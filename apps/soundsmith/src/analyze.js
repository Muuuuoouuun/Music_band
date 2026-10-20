// 음원 듣고 따라 만들기: 고른 구간의 소리를 재서(배음·엔벨로프·밝기·비브라토·숨소리·폭·잔향·톤 균형)
// 비슷한 음색을 만든다. 한 음이면 배음을 그대로 옮겨 다시 합성하고, 화음·믹스면 가장 닮은 기본 음색에서
// 출발해 맞춤 EQ 로 톤 균형을 맞춘다. 브라우저 API 없이 Float32Array 만 다뤄서 노드에서도 검사한다.
import { detectPitch, peakOf } from './sample.js';
import { BASE_PATCH, CUSTOM_LEN, MATCH_BANDS, PARAMS, harmonicsOf, normalizePatch, waveCycle } from './patch.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const log2 = Math.log2;
const median = (arr) => {
  if (!arr.length) return 0;
  const s = Float64Array.from(arr).sort();
  return s[Math.floor(s.length / 2)];
};

// ---------------------------------------------------------------------------
// FFT (반복 radix-2, 크기마다 표를 한 번만 만든다)
// ---------------------------------------------------------------------------

const fftTables = new Map();
function tables(n) {
  let t = fftTables.get(n);
  if (!t) {
    const rev = new Uint32Array(n);
    const bits = Math.round(log2(n));
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    fftTables.set(n, (t = { rev, cos, sin }));
  }
  return t;
}

/** 제자리 FFT. inverse 면 역변환(1/n 포함). n 은 2의 거듭제곱. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  const { rev, cos, sin } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = i + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const hannCache = new Map();
function hann(n) {
  if (!hannCache.has(n)) hannCache.set(n, Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)));
  return hannCache.get(n);
}

/** 한 프레임의 크기 스펙트럼 (0..n/2). */
function magnitude(x, offset, n, out = new Float64Array(n / 2 + 1)) {
  const w = hann(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[offset + i] ?? 0) * w[i];
  fft(re, im);
  for (let k = 0; k <= n / 2; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

/** 구간 안 프레임들의 평균 파워 스펙트럼 (너무 길면 프레임을 건너뛴다). */
export function averagePower(x, start, end, n = 4096, maxFrames = 160) {
  const span = end - start - n;
  const power = new Float64Array(n / 2 + 1);
  if (span < 0) {
    const pad = new Float32Array(n);
    pad.set(x.subarray(start, end));
    const m = magnitude(pad, 0, n);
    for (let k = 0; k < m.length; k++) power[k] = m[k] * m[k];
    return power;
  }
  const frames = Math.max(1, Math.min(maxFrames, Math.floor(span / (n / 2)) + 1));
  const m = new Float64Array(n / 2 + 1);
  for (let f = 0; f < frames; f++) {
    const off = start + Math.round((span * f) / Math.max(1, frames - 1));
    magnitude(x, off, n, m);
    for (let k = 0; k < m.length; k++) power[k] += (m[k] * m[k]) / frames;
  }
  return power;
}

/** 옥타브 띠(맞춤 EQ 자리)마다 에너지 dB. 평균을 0 으로 맞춘 '톤 균형'. */
export function bandLevels(power, sr, n, centers = MATCH_BANDS) {
  const out = centers.map((fc) => {
    const lo = Math.max(1, Math.floor(((fc / Math.SQRT2) * n) / sr));
    const hi = Math.min(power.length - 1, Math.ceil(((fc * Math.SQRT2) * n) / sr));
    let e = 1e-14;
    for (let k = lo; k <= hi; k++) e += power[k];
    return 10 * Math.log10(e);
  });
  return relative(out);
}

/** dB 목록을 '큰 띠 기준 평균 0' 으로 (아주 작은 띠는 평균에서 뺀다). */
function relative(db) {
  const top = Math.max(...db);
  const used = db.filter((v) => v > top - 45);
  const mean = used.reduce((s, v) => s + v, 0) / used.length;
  return db.map((v) => Math.round((v - mean) * 10) / 10);
}

/** 그림용 1/3 옥타브 곡선 (25Hz~16kHz). */
export function thirdOctave(power, sr, n) {
  const centers = Array.from({ length: 29 }, (_, i) => 25 * 2 ** (i / 3));
  return { centers, db: bandLevels(power, sr, n, centers) };
}

// ---------------------------------------------------------------------------
// 소리 재기
// ---------------------------------------------------------------------------

function rmsFrames(x, start, end, hop) {
  const frames = Math.max(1, Math.floor((end - start) / hop));
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const a = start + f * hop;
    for (let i = a; i < a + hop; i++) s += x[i] * x[i];
    out[f] = Math.sqrt(s / hop);
  }
  return out;
}

/** 볼륨 엔벨로프: 어택·디케이·서스테인·릴리즈를 엔진과 같은 뜻(디케이는 시간 상수 ×4)으로. */
export function measureEnvelope(env, frameSec) {
  let top = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[top]) top = i;
  if (env[top] < 1e-5) return null;
  // 첫 봉우리: 잔향·코러스가 쌓여 나중에 더 커져도 악기가 다 올라온 곳은 처음 봉우리다
  // (앞뒤 150ms 안에서 가장 크고, 전체 최고의 70% 이상)
  const sm = env.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(env.length - 1, i + 2); j++) { s += env[j]; c++; }
    return s / c;
  });
  const reach = Math.round(0.15 / frameSec);
  let peakIdx = top;
  for (let i = 0; i < top; i++) {
    if (sm[i] < sm[top] * 0.7) continue;
    let isMax = true;
    for (let j = Math.max(0, i - reach); j <= Math.min(env.length - 1, i + reach) && isMax; j++) if (sm[j] > sm[i]) isMax = false;
    if (isMax) {
      peakIdx = i;
      break;
    }
  }
  const peak = env[peakIdx];
  const f = (sec) => Math.max(1, Math.round(sec / frameSec));
  const dbAt = (i) => 20 * Math.log10(env[Math.min(env.length - 1, Math.max(0, i))] + 1e-9);
  let onset = 0;
  while (onset < peakIdx && env[onset] < peak * 0.1) onset++;
  let attackEnd = onset;
  while (attackEnd < peakIdx && env[attackEnd] < peak * 0.9) attackEnd++;
  // 겹친 소리의 맥놀이로 봉우리가 늦게 잡혀도, 고르게 이어지는 높이(중앙값)의 90% 에 닿는 때로 어택을 다시 잰다
  let half = 0;
  while (half < env.length - 1 && env[half] < env[top] * 0.5) half++;
  const plateau = median(Array.from(env.slice(half, Math.max(half + 1, Math.min(env.length, top + Math.round(1 / frameSec))))));
  let early = onset;
  while (early < attackEnd && env[early] < plateau * 0.9) early++;
  attackEnd = Math.min(attackEnd, early);
  let noteEnd = env.length - 1;
  while (noteEnd > peakIdx && env[noteEnd] < peak * 0.1) noteEnd--;
  // 손을 뗀 곳: 0.2초 넘게 고르게 이어지다가 0.1초 안에 6dB 넘게 떨어지는 마지막 자리
  // (잔향 꼬리가 길어 소리가 오래 남아도 찾을 수 있게, 끝 높이가 아니라 떨어지는 모양으로 찾는다)
  let off = null;
  for (let i = env.length - 1 - f(0.1); i > peakIdx + f(0.2); i--) {
    if (env[i] < peak * 0.25 || env[i + f(0.1)] > env[i] * 0.5) continue;
    let j = i;
    const plateau = median(Array.from(env.slice(Math.max(peakIdx, i - f(0.4)), i + 1)));
    while (j > peakIdx && env[j] < plateau * 0.85) j--;
    if (env[j] >= env[Math.max(peakIdx, j - f(0.2))] * 0.8) {
      off = j;
      break;
    }
  }
  const sustainEnd = off ?? noteEnd;
  const span = sustainEnd - peakIdx;
  const mid = [];
  for (let i = peakIdx + Math.floor(span * 0.3); i <= peakIdx + Math.floor(span * 0.8); i++) mid.push(env[i] / peak);
  // 서스테인은 어택 끝 무렵 높이 기준 (늦게 온 맥놀이 봉우리 기준이면 낮게 잡힌다)
  let earlyPeak = 0;
  for (let i = onset; i <= Math.min(env.length - 1, attackEnd + f(0.1)); i++) earlyPeak = Math.max(earlyPeak, env[i]);
  const level = peak / Math.max(earlyPeak, 1e-9);
  let sustain = span > 3 ? Math.min(1, median(mid) * level) : 0;
  // 끝까지 줄어들기만 하면(타악·줄·피아노) 서스테인 0 으로 본다
  const at = (x) => env[peakIdx + Math.floor(span * x)] / peak;
  const decaying = off == null && span > 8 && at(0.8) < at(0.3) * 0.6 && at(0.55) < at(0.3) * 0.85;
  if (decaying) sustain = 0;
  const target = sustain + 0.37 * (1 - sustain);
  let d = peakIdx;
  while (d < sustainEnd && env[d] / peak > target) d++;
  const decay = clamp(Math.max(1, d - peakIdx) * frameSec * 4, 0.05, 8);
  // 릴리즈: 뗀 뒤 처음 60ms 의 기울기(dB/초)로 시간 상수를 구한다 (엔진은 시간 상수 r/5)
  let release = null;
  if (off != null) {
    const slope = (dbAt(off) - dbAt(off + f(0.06))) / (f(0.06) * frameSec);
    if (slope > 0) release = clamp((5 * 8.69) / slope, 0.03, 10);
  }
  return {
    attack: clamp((attackEnd - onset) * frameSec, 0.001, 8),
    decay,
    sustain: clamp(sustain, 0, 1),
    release: release ?? clamp(sustain > 0.2 ? 0.3 : decay * 0.2, 0.03, 3),
    releaseMeasured: release != null,
    onset: onset * frameSec,
    peakAt: peakIdx * frameSec,
    attackEnd: attackEnd * frameSec,
    offAt: off != null ? off * frameSec : null,
    noteEnd: noteEnd * frameSec,
    peak,
  };
}

/** 정해진 음 근처에서 주기를 계속 따라가 cent 흔들림 줄을 만든다 (비브라토). */
function trackCents(x, sr, f0, start, end, hopSec = 0.01) {
  const p0 = sr / f0;
  const w = Math.round(Math.max(2 * p0, sr * 0.02));
  const lo = Math.floor(p0 * 0.94);
  const hi = Math.ceil(p0 * 1.06);
  const hop = Math.round(sr * hopSec);
  const out = [];
  for (let a = start; a + w + hi < end; a += hop) {
    let best = lo;
    let bestD = Infinity;
    const d = new Float64Array(hi - lo + 3);
    for (let tau = lo - 1; tau <= hi + 1; tau++) {
      let s = 0;
      for (let i = 0; i < w; i += 2) {
        const diff = x[a + i] - x[a + i + tau];
        s += diff * diff;
      }
      d[tau - lo + 1] = s;
      if (tau >= lo && tau <= hi && s < bestD) { bestD = s; best = tau; }
    }
    const y1 = d[best - lo];
    const y2 = d[best - lo + 1];
    const y3 = d[best - lo + 2];
    const den = y1 - 2 * y2 + y3;
    const tau = best + (den > 0 ? clamp((0.5 * (y1 - y3)) / den, -1, 1) : 0);
    out.push(1200 * log2(p0 / tau));
  }
  return out;
}

/** 줄(초당 rate 개 값)에서 lo..hi Hz 사이 가장 강한 흔들림: { rate, depth(진폭), strength } */
function dominantWobble(series, rate, lo, hi) {
  const n = series.length;
  if (n < rate * 0.8) return null;
  // 직선 추세를 빼서 느린 음정 변화는 지운다
  const xm = (n - 1) / 2;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) { sy += series[i]; sxy += (i - xm) * series[i]; sxx += (i - xm) ** 2; }
  const slope = sxy / sxx;
  const mean = sy / n;
  const y = series.map((v, i) => v - mean - slope * (i - xm));
  const win = (i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  let best = null;
  let total = 0;
  let count = 0;
  for (let f = lo; f <= hi + 1e-9; f += 0.1) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * f * i) / rate;
      re += y[i] * win(i) * Math.cos(a);
      im -= y[i] * win(i) * Math.sin(a);
    }
    const mag = (4 * Math.hypot(re, im)) / n; // 핸 창 보정(×2) 포함 진폭
    total += mag;
    count++;
    if (!best || mag > best.depth) best = { rate: Math.round(f * 10) / 10, depth: mag };
  }
  best.strength = best.depth / (total / count || 1);
  return best;
}

/** 배음 세기 표: 평균 스펙트럼에서 k·f0 근처 봉우리를 찾는다. 늘어난 배음(피아노)도 따라간다. */
function measureHarmonics(x, sr, f0, start, end, count = CUSTOM_LEN, vibCents = 0) {
  let n = 4096;
  while (n < (8 * sr) / f0 && n < 32768) n *= 2;
  const power = averagePower(x, start, Math.max(end, start + n), n, 48);
  const mag = power.map(Math.sqrt);
  const binHz = sr / n;
  const perHarm = f0 / binHz;
  const amps = new Array(count).fill(0);
  const freqs = new Array(count).fill(0);
  let stretch = 1;
  let harmE = 0;
  for (let k = 1; k <= count; k++) {
    const want = (k * f0 * stretch) / binHz;
    if (want >= mag.length - 3) break;
    const tol = Math.max(1.5, Math.min(0.35 * perHarm, 2 + 0.02 * k * perHarm));
    const a = Math.max(1, Math.floor(want - tol));
    const b = Math.min(mag.length - 2, Math.ceil(want + tol));
    let pk = a;
    for (let i = a; i <= b; i++) if (mag[i] > mag[pk]) pk = i;
    const around = [];
    for (let i = Math.max(1, Math.round(want - perHarm / 2)); i <= Math.min(mag.length - 1, Math.round(want + perHarm / 2)); i++) around.push(mag[i]);
    const floor = median(around);
    if (mag[pk] < floor * 2.2 || pk === a || pk === b) continue;
    const y1 = Math.log(mag[pk - 1] + 1e-12);
    const y2 = Math.log(mag[pk] + 1e-12);
    const y3 = Math.log(mag[pk + 1] + 1e-12);
    const den = y1 - 2 * y2 + y3;
    const shift = den < 0 ? clamp((0.5 * (y1 - y3)) / den, -0.5, 0.5) : 0;
    amps[k - 1] = Math.exp(y2 - 0.25 * (y1 - y3) * shift);
    freqs[k - 1] = (pk + shift) * binHz;
    for (let i = Math.max(1, Math.floor(want - tol)); i <= Math.min(mag.length - 1, Math.ceil(want + tol)); i++) harmE += power[i];
    // 센 배음이 정수배에서 얼마나 벗어나는지로 다음 배음 자리를 고친다 (늘어난 배음)
    if (k >= 2 && amps[k - 1] > 0.02 * Math.max(...amps)) stretch = 0.7 * stretch + 0.3 * (freqs[k - 1] / (k * f0));
  }
  let total = 1e-14;
  const lo = Math.floor((0.5 * f0) / binHz);
  const hi = Math.min(power.length - 1, Math.ceil(((count + 0.5) * f0) / binHz));
  for (let i = lo; i <= hi; i++) total += power[i];
  const top = Math.max(...amps) || 1;
  // 늘어난 배음(피아노 줄)은 높은 배음일수록 한쪽(위)으로만 벗어난다. 비브라토로 번진 값은 위아래로 흩어져 0 근처
  // 기준음은 낮은 배음들로 다시 잰다 (비브라토가 있으면 YIN 값이 한쪽으로 치우칠 수 있다)
  const low = [];
  for (let i = 0; i < 3; i++) if (amps[i] > 0.1 * top && freqs[i]) low.push(freqs[i] / (i + 1));
  const fRef = low.length ? median(low) : f0;
  const devs = [];
  amps.forEach((a, i) => {
    if (i >= 4 && a > 0.05 * top && freqs[i]) devs.push(freqs[i] / ((i + 1) * fRef) - 1);
  });
  // 정수배가 아닌 센 봉우리 (벨·종). FM 비율 고를 때 쓴다
  const partials = [];
  for (let i = 2; i < mag.length - 2; i++) {
    if (mag[i] > mag[i - 1] && mag[i] >= mag[i + 1] && mag[i] > top * 0.08) {
      const ratio = (i * binHz) / f0;
      const local = median(Array.from(mag.subarray(Math.max(1, i - Math.round(perHarm)), Math.min(mag.length, i + Math.round(perHarm)))));
      if (ratio > 0.4 && Math.abs(ratio - Math.round(ratio)) > 0.15 && mag[i] > local * 4) partials.push({ ratio: Math.round(ratio * 100) / 100, amp: mag[i] / top });
    }
  }
  partials.sort((p, q) => q.amp - p.amp);
  // 배음 사이 바닥(숨·바람 소리): 배음 한가운데 사이 지점들의 중앙값을 가장 센 배음과 견준다.
  // 흰 잡음 σ 와 사인 진폭 A 의 핸 창 FFT 비는 (4σ/A)·√(3/8n) 이므로 거꾸로 σ/A 를 얻는다.
  // 비브라토로 번진 배음이 사이를 채우는 높이 위는 보지 않는다
  const vibTop = vibCents > 0 ? (0.3 * fRef) / (2 ** (vibCents / 1200) - 1) : Infinity;
  const between = [];
  const lowFloor = [];
  const highFloor = [];
  for (let k = 1; k < count; k++) {
    const f = (k + 0.5) * fRef;
    if (f < 700 || f > Math.min(9000, sr * 0.4, vibTop)) continue;
    const i = Math.round(f / binHz);
    const v = Math.min(mag[i - 1], mag[i], mag[i + 1]);
    between.push(v);
    (f < 3000 ? lowFloor : highFloor).push(v);
  }
  const strongest = Math.max(...amps) || 1;
  const noiseLevel = between.length >= 3 ? median(between) / strongest / (4 * Math.sqrt(3 / (8 * n))) : 0;
  // 바닥이 높은 쪽으로 갈수록 얼마나 어두워지나 (dB). 숨소리는 고르고, 겹친 소리의 번짐은 높은 곳에서 사라진다
  const noiseTilt = lowFloor.length && highFloor.length ? 20 * Math.log10((median(highFloor) + 1e-12) / (median(lowFloor) + 1e-12)) : 0;
  return {
    noiseLevel,
    noiseTilt,
    amps: amps.map((a) => Math.round((a / top) * 1000) / 1000),
    harmonicity: clamp(harmE / total, 0, 1),
    inharmonicity: devs.length >= 3 ? Math.max(0, median(devs)) : 0,
    partials: partials.slice(0, 6),
    n,
  };
}

/** 프레임마다 스펙트럼 무게중심(Hz)과 변화량(새 음이 들어오는 순간) */
function spectralTrack(x, sr, start, end, n = 2048) {
  const hop = n / 2;
  const cents = [];
  const flux = [];
  const energy = [];
  let prev = null;
  const m = new Float64Array(n / 2 + 1);
  for (let a = start; a + n <= end; a += hop) {
    magnitude(x, a, n, m);
    let s = 0;
    let w = 0;
    let fl = 0;
    for (let k = 1; k < m.length; k++) {
      s += m[k] * k;
      w += m[k];
      if (prev) {
        const d = Math.log(m[k] + 1e-9) - Math.log(prev[k] + 1e-9);
        if (d > 0 && k * (sr / n) < 8000) fl += d;
      }
    }
    cents.push(w > 0 ? (s / w) * (sr / n) : 0);
    energy.push(w);
    flux.push(fl);
    prev = Float64Array.from(m);
  }
  return { centroid: cents, flux, energy, hopSec: hop / sr };
}

function onsetsFromFlux(flux, energy, hopSec) {
  if (flux.length < 3) return [];
  const loud = Math.max(...energy);
  const mean = flux.reduce((s, v) => s + v, 0) / flux.length;
  const sd = Math.sqrt(flux.reduce((s, v) => s + (v - mean) ** 2, 0) / flux.length);
  const out = [];
  for (let i = 1; i < flux.length - 1; i++) {
    // 새 음: 변화량이 튀고, 소리가 실제로 커지는 순간 (잦아드는 꼬리의 맥놀이는 빼고)
    const rising = Math.max(energy[i], energy[i + 1]) > 1.25 * energy[i - 1];
    if (flux[i] > mean + 2 * sd && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && energy[i] > loud * 0.1 && rising) {
      if (!out.length || (i - out.at(-1)) * hopSec > 0.08) out.push(i);
    }
  }
  return out;
}

/** 음 높이별(도·도#…) 에너지: 화음 구성음 찾기 */
function chromaOf(power, sr, n) {
  const c = new Array(12).fill(0);
  for (let k = Math.ceil((55 * n) / sr); k < Math.min(power.length, (4200 * n) / sr); k++) {
    const midi = 69 + 12 * log2((k * sr) / n / 440);
    c[((Math.round(midi) % 12) + 12) % 12] += power[k];
  }
  const top = Math.max(...c) || 1;
  return c.map((v) => v / top);
}

/**
 * 고른 구간을 잰다. channels: [L, R?] Float32Array. 반환값은 음색 만들기·닮은 정도 계산에 쓰는 특징 묶음.
 * kind: 'tone' 한 음 | 'chord' 화음·지속음 | 'mix' 여러 악기·여러 음 | 'noise' 음높이 없음 | 'silent'
 */
export function analyzeAudio(channels, sr, { start = 0, end = null, maxSeconds = 12 } = {}) {
  const L = channels[0];
  const R = channels[1] ?? channels[0];
  const stop = Math.min(end ?? L.length, L.length, start + Math.round(maxSeconds * sr));
  const len = stop - start;
  if (len < sr * 0.05) return { kind: 'silent', seconds: len / sr };
  const mono = new Float32Array(len);
  let midE = 0;
  let sideE = 0;
  for (let i = 0; i < len; i++) {
    const l = L[start + i];
    const r = R[start + i];
    mono[i] = (l + r) / 2;
    midE += mono[i] * mono[i];
    sideE += ((l - r) / 2) ** 2;
  }
  if (peakOf(mono) < 1e-4) return { kind: 'silent', seconds: len / sr };
  const width = midE > 0 ? Math.sqrt(sideE / midE) : 0;
  const frameSec = 0.01;
  const env = rmsFrames(mono, 0, len, Math.round(sr * frameSec));
  const envelope = measureEnvelope(env, frameSec);
  // 안정된 부분 (어택이 끝난 뒤 ~ 소리가 크게 줄기 전)
  const stableA = Math.round((envelope.attackEnd + 0.04) * sr);
  let stableB = Math.round(envelope.noteEnd * sr);
  if (envelope.sustain < 0.25) {
    let i = Math.round(envelope.peakAt / frameSec);
    while (i < env.length - 1 && env[i] > envelope.peak * 0.25) i++;
    stableB = Math.max(stableA + Math.round(sr * 0.12), i * Math.round(sr * frameSec));
  }
  stableB = Math.min(len, Math.max(stableB, stableA + Math.round(sr * 0.1)));
  const pitch = detectPitch(mono, sr, { start: Math.min(stableA, len - 1), end: stableB });
  const n = 4096;
  const power = averagePower(mono, 0, len, n);
  const bands = bandLevels(power, sr, n);
  const curve = thirdOctave(power, sr, n);
  const chroma = chromaOf(power, sr, n);
  const track = spectralTrack(mono, sr, 0, len);
  const onsets = onsetsFromFlux(track.flux, track.energy, track.hopSec);
  const onsetRate = onsets.length / (len / sr);
  // 밝기: 첫 60ms 와 안정 부분의 무게중심
  const frameOf = (t) => clamp(Math.round(t / track.hopSec), 0, Math.max(0, track.centroid.length - 1));
  const loudEnough = (i) => track.energy[i] > Math.max(...track.energy) * 0.05;
  const early = [];
  for (let i = frameOf(envelope.onset); i <= frameOf(envelope.onset + 0.06); i++) if (loudEnough(i)) early.push(track.centroid[i]);
  const steady = [];
  for (let i = frameOf(stableA / sr); i <= frameOf(stableB / sr); i++) if (loudEnough(i)) steady.push(track.centroid[i]);
  const brightness = { early: median(early) || median(steady), sustain: median(steady) || median(early) };
  // 밝기가 가라앉는 시간 (필터 엔벨로프 디케이)
  let settle = 0.3;
  if (brightness.early > brightness.sustain * 1.15) {
    const goal = brightness.sustain + 0.37 * (brightness.early - brightness.sustain);
    let i = frameOf(envelope.onset);
    while (i < track.centroid.length - 1 && track.centroid[i] > goal) i++;
    settle = clamp((i - frameOf(envelope.onset)) * track.hopSec, 0.02, 4);
  }
  // 첫소리의 잡음 (해머·피크·숨): 첫 프레임 변화량이 안정 부분보다 얼마나 큰가
  const fluxSteady = median(track.flux.slice(frameOf(stableA / sr), frameOf(stableB / sr) + 1)) || 1;
  const fluxHit = Math.max(0, ...track.flux.slice(frameOf(envelope.onset), frameOf(envelope.onset + 0.05) + 1));
  const transient = clamp((log2(fluxHit / fluxSteady + 1) - 2) / 5, 0, 1);

  let harm = null;
  let vibrato = null;
  if (pitch && pitch.clarity > 0.6) {
    const cents = trackCents(mono, sr, pitch.hz, stableA, stableB);
    const wob = dominantWobble(cents, 100, 3, 9);
    if (wob && wob.depth > 6 && wob.strength > 2.2) vibrato = { rate: wob.rate, depth: Math.round(wob.depth) };
    harm = measureHarmonics(mono, sr, pitch.hz, stableA, stableB, CUSTOM_LEN, vibrato?.depth ?? 0);
  }
  // 트레몰로: 서스테인의 크기 흔들림 (dB)
  let tremolo = null;
  if (envelope.sustain > 0.4 && !vibrato) {
    const a = Math.round(stableA / sr / frameSec);
    const b = Math.round(stableB / sr / frameSec);
    const db = Array.from(env.slice(a, b), (v) => 20 * Math.log10(v + 1e-9));
    const wob = dominantWobble(db, 1 / frameSec, 2, 9);
    if (wob && wob.depth > 1 && wob.strength > 2.5) tremolo = { rate: wob.rate, depth: Math.round(wob.depth * 10) / 10 };
  }
  // 음 시작마다 0.25초 뒤 얼마나 남는지 (믹스에서 패드형인지 건반형인지)
  const keep = onsets.map((i) => {
    const t = i * track.hopSec;
    const a = env[Math.min(env.length - 1, Math.round((t + 0.03) / frameSec))];
    const b = env[Math.min(env.length - 1, Math.round((t + 0.25) / frameSec))];
    return a > 0 ? clamp(b / a, 0, 1.5) : 1;
  });
  const sustainRatio = keep.length ? median(keep) : envelope.sustain;
  // 잔향: 음이 끝난 뒤 남는 꼬리 (구간 안에 끝이 있을 때)
  const space = measureSpace(env, frameSec, envelope);
  // 소리 중심 높이 (화음을 비교용으로 칠 자리)
  let num = 0;
  let den = 0;
  for (let k = Math.ceil((70 * n) / sr); k < (1200 * n) / sr; k++) {
    num += power[k] * log2((k * sr) / n);
    den += power[k];
  }
  const centerMidi = den > 0 ? clamp(Math.round(69 + 12 * (num / den - log2(440))), 36, 84) : 60;
  const strongPcs = chroma.map((v, pc) => ({ v, pc })).filter((c) => c.v >= 0.45).sort((p, q) => q.v - p.v).map((c) => c.pc);

  let kind = 'mix';
  // 화음은 구성음들의 '가상 기본음'(C·E·G → 두 옥타브 아래 C)으로 한 음처럼 보일 수 있다.
  // 진짜 한 음은 1·2배음 중 하나가 세므로, 처음 센 배음이 3배음 이상이면 화음으로 본다
  const amps = harm?.amps ?? [];
  let firstStrong = amps.findIndex((v) => v > 0.3);
  // 기본음이 거의 없고 2배음부터 센데 3·5배음도 세면, 한 옥타브 위 음에 1.5·2.5배 소리가 있는 셈 → 화음(E·B·E·G#)
  if (firstStrong === 1 && amps[0] < 0.12 && (amps[2] > 0.3 || amps[4] > 0.3)) firstStrong = 2;
  if (!pitch && onsetRate < 1.2 && strongPcs.length > 6) kind = 'noise';
  else if (pitch && pitch.clarity >= 0.75 && harm && harm.harmonicity >= 0.4 && onsetRate <= 2.5 && firstStrong >= 0 && firstStrong <= 1) kind = 'tone';
  else if (strongPcs.length >= 2 && strongPcs.length <= 6 && onsetRate <= 2.5) kind = 'chord';
  return {
    kind,
    seconds: len / sr,
    sr,
    pitch,
    harmonics: harm?.amps ?? null,
    harmonicity: harm?.harmonicity ?? 0,
    noiseLevel: harm?.noiseLevel ?? 0,
    noiseTilt: harm?.noiseTilt ?? 0,
    inharmonicity: harm?.inharmonicity ?? 0,
    partials: harm?.partials ?? [],
    envelope,
    brightness: { ...brightness, settle },
    transient,
    vibrato,
    tremolo,
    width,
    space,
    bands,
    curve,
    chroma,
    strongPcs,
    centerMidi,
    onsetRate,
    sustainRatio,
  };
}

/**
 * 꼬리에서 잔향 재기. 마른 소리는 한 기울기로 곧장 사라지고, 잔향이 있으면 처음엔 빨리 줄다가(악기 릴리즈)
 * 나중엔 느리게(방 울림) 줄어드는 두 기울기가 된다.
 * resid: 뗀 뒤(타악은 봉우리 뒤) 0.3초에 남은 크기(dB, 서스테인·봉우리 기준), rt60: 나중 기울기로 본 60dB 감쇠 시간.
 * 원음과 만든 음색을 같은 자로 재서 견주므로 엔진에 맞춘 절대값보다 '같은 방법'이 중요하다.
 */
function measureSpace(env, frameSec, e) {
  const db = (i) => 20 * Math.log10(env[Math.min(env.length - 1, Math.max(0, i))] + 1e-9);
  const f = (sec) => Math.round(sec / frameSec);
  const sustained = e.sustain > 0.2 && e.offAt != null;
  const from = sustained ? f(e.offAt) : f(e.peakAt);
  if (!sustained && e.sustain > 0.2) return { amount: 0.25, rt60: 2.4, measured: false };
  if (from + f(0.7) >= env.length) return { amount: 0.25, rt60: 2.4, measured: false };
  const ref = sustained ? 20 * Math.log10(e.sustain * e.peak + 1e-9) : db(from);
  const resid = db(from + f(0.3)) - ref;
  const lateEnd = Math.min(env.length - 1, from + f(1.2));
  const late = (db(from + f(0.3)) - db(lateEnd)) / ((lateEnd - from - f(0.3)) * frameSec);
  let floor = 0;
  for (let i = 0; i < env.length; i++) floor = Math.min(floor, db(i));
  const rt60 = clamp(late > 0.5 ? 60 / late : 8, 0.3, 8);
  const audible = db(from + f(0.3)) > floor + 6;
  if (sustained) {
    const early = (db(from) - db(from + f(0.08))) / 0.08;
    const wet = audible && late < early * 0.5;
    // 처음 짐작: 엔진 잔향 '양'은 대략 resid ≈ 20·log10(양) − 13 (방 길이 3초 기준). 나머지는 렌더해 보며 맞춘다
    return { amount: wet ? clamp(10 ** ((resid + 13) / 20), 0.03, 0.9) : 0.04, rt60: wet ? rt60 : 1, resid, measured: true };
  }
  // 타악: 디케이로 예상한 기울기보다 꼬리가 느리게 줄면 그만큼 잔향
  const expected = 8.69 / Math.max(0.01, e.decay / 4);
  const wet = audible && late < expected * 0.6;
  return { amount: wet ? clamp(0.2 + (1 - late / expected) * 0.4, 0, 0.8) : 0.08, rt60: wet ? rt60 : 1.2, resid, measured: true };
}

// ---------------------------------------------------------------------------
// 이펙트 꼬리 재기 (잔향·딜레이 시험)
// ---------------------------------------------------------------------------

/**
 * 슈뢰더 적분: 끝에서부터 거꾸로 에너지를 더한 곡선(dB). 잔향이 줄어드는 기울기를 잡음 없이 볼 수 있다.
 * RT60 은 −5dB~−25dB 구간 기울기(T20)를 60dB 로 늘린 값, 짧으면 −5~−15dB(T10).
 */
export function decayRt60(x, sr, { from = 0 } = {}) {
  const n = x.length - from;
  if (n < sr * 0.05) return null;
  const edc = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc += x[from + i] * x[from + i];
    edc[i] = acc;
  }
  if (acc <= 0) return null;
  const db = (i) => 10 * Math.log10(edc[i] / acc + 1e-30);
  const at = (level) => {
    let i = 0;
    while (i < n - 1 && db(i) > level) i++;
    return i;
  };
  for (const [hi, lo, k] of [[-5, -25, 3], [-5, -15, 6]]) {
    const a = at(hi);
    const b = at(lo);
    if (b > a + sr * 0.01 && db(b) <= lo + 0.5) return ((b - a) / sr) * k;
  }
  return null;
}

/**
 * 이펙트 시험 결과 재기: full·dry 렌더(같은 줄에서 딜레이·잔향만 뺀 것)로 젖은 소리를 구한다.
 * 반환: rt60(꼬리 60dB 감쇠), onset(짧은 소리를 넣은 뒤 젖은 소리가 시작되는 때), wetDb(직접음 대비),
 * width(젖은 소리의 좌우 넓이), echoes([{ t, left, right }] 딜레이 반복과 좌우 비율), 그림용 곡선.
 */
export function tailStats(full, dry, sr, { start = 0, frame = 0.005 } = {}) {
  const n = full[0].length;
  const wet = full.map((ch, c) => Float32Array.from(ch, (v, i) => v - dry[c][i]));
  const mono = Float32Array.from(wet[0], (v, i) => (v + wet[1][i]) / 2);
  let eWet = 0;
  let eDry = 0;
  let side = 0;
  let mid = 0;
  for (let i = 0; i < n; i++) {
    eWet += wet[0][i] ** 2 + wet[1][i] ** 2;
    eDry += dry[0][i] ** 2 + dry[1][i] ** 2;
    side += ((wet[0][i] - wet[1][i]) / 2) ** 2;
    mid += mono[i] ** 2;
  }
  const hop = Math.max(1, Math.round(sr * frame));
  const frames = Math.floor(n / hop);
  const curve = (chs) => Array.from({ length: frames }, (_, f) => {
    let e = 0;
    for (const ch of chs) for (let i = f * hop; i < (f + 1) * hop; i++) e += ch[i] * ch[i];
    return 10 * Math.log10(e / hop + 1e-20);
  });
  const fullDb = curve(full);
  const wetCurve = curve(wet);
  const left = curve([wet[0]]);
  const right = curve([wet[1]]);
  const top = Math.max(...wetCurve);
  const silent = eWet < eDry * 1e-5;
  let onset = null;
  if (!silent) {
    const f = wetCurve.findIndex((v) => v > top - 20);
    onset = Math.max(0, f * frame - start);
  }
  // 딜레이 반복: 젖은 소리 곡선의 봉우리 (전체 최고에서 30dB 안, 60ms 넘게 떨어진 것)
  const echoes = [];
  if (!silent) {
    for (let f = 2; f < frames - 2; f++) {
      const v = wetCurve[f];
      if (v < top - 30 || v < wetCurve[f - 1] || v < wetCurve[f + 1] || v < wetCurve[f - 2] || v < wetCurve[f + 2]) continue;
      // 주변 0.1초의 평균보다 확실히 튀어나온 봉우리만
      const around = wetCurve.slice(Math.max(0, f - 20), f + 20);
      const mean = around.reduce((a, b) => a + b, 0) / around.length;
      if (v < mean + 4) continue;
      const t = f * frame - start;
      if (echoes.length && t - echoes.at(-1).t < 0.06) continue;
      echoes.push({ t, left: left[f], right: right[f] });
    }
  }
  const startIdx = Math.max(0, Math.round((start + (onset ?? 0)) * sr));
  return {
    silent,
    rt60: silent ? null : decayRt60(mono, sr, { from: startIdx }),
    onset,
    wetDb: silent ? null : 10 * Math.log10(eWet / (eDry || 1e-20)),
    width: silent || mid <= 0 ? 0 : Math.sqrt(side / mid),
    echoes: echoes.slice(0, 12),
    curve: { frame, start, full: fullDb, wet: wetCurve },
  };
}

// ---------------------------------------------------------------------------
// 필터·EQ 응답 (Web Audio BiquadFilter 와 같은 식) — 배음 보정과 맞춤 EQ 계산에 쓴다
// ---------------------------------------------------------------------------

function biquadMag(b0, b1, b2, a0, a1, a2, w) {
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2;
  const ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2;
  const di = -(a1 * s1 + a2 * s2);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}

export function lowpassMag(f, cutoff, q, sr) {
  const w0 = (2 * Math.PI * Math.min(cutoff, sr * 0.49)) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return biquadMag((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha, (2 * Math.PI * Math.min(f, sr * 0.499)) / sr);
}

export function peakingDb(f, f0, gainDb, q, sr) {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(f0, sr * 0.45)) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  const m = biquadMag(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A, (2 * Math.PI * Math.min(f, sr * 0.499)) / sr);
  return 20 * Math.log10(m);
}

/** 맞춤 EQ 띠들을 겹쳐 놓았을 때의 실제 응답이 목표(dB)에 가깝도록 띠 값을 몇 번 고쳐 맞춘다. */
export function fitGraphicEq(target, { sr = 44100, q = 1.41, max = PARAMS['eq.match'].max } = {}) {
  const g = target.map((v) => clamp(v, -max, max));
  for (let it = 0; it < 12; it++) {
    const resp = MATCH_BANDS.map((f) => MATCH_BANDS.reduce((s, fc, j) => s + peakingDb(f, fc, g[j], q, sr), 0));
    for (let j = 0; j < g.length; j++) g[j] = clamp(g[j] + 0.8 * (target[j] - resp[j]), -max, max);
  }
  return g.map((v) => Math.round(v * 10) / 10);
}

/** 두 톤 균형의 차이 → 맞춤 EQ 목표. 거의 없는 띠는 건드리지 않고, 이웃 띠와 살짝 고르게 한다. */
export function matchTarget(ref, cand, { amount = 1, limit = 12 } = {}) {
  const top = Math.max(...ref);
  const raw = ref.map((r, i) => (r < top - 40 ? 0 : r - cand[i]));
  const used = raw.filter((v, i) => ref[i] >= top - 40);
  const mean = used.reduce((s, v) => s + v, 0) / (used.length || 1);
  const centered = raw.map((v, i) => (ref[i] < top - 40 ? 0 : v - mean));
  const smooth = centered.map((v, i) => 0.25 * (centered[i - 1] ?? v) + 0.5 * v + 0.25 * (centered[i + 1] ?? v));
  return smooth.map((v) => clamp(v * amount, -limit, limit));
}

// ---------------------------------------------------------------------------
// 닮은 정도 (0~100)
// ---------------------------------------------------------------------------

export function similarity(ref, cand) {
  const parts = {};
  const top = Math.max(...ref.bands);
  const used = ref.bands.map((v, i) => i).filter((i) => ref.bands[i] > top - 40);
  const d = used.reduce((s, i) => s + Math.abs(ref.bands[i] - cand.bands[i]), 0) / used.length;
  parts.tone = Math.exp(-d / 6);
  const tone = ref.kind === 'tone' && ref.harmonics && cand.harmonics;
  if (tone) {
    const a = ref.harmonics.map(Math.sqrt);
    const b = cand.harmonics.map(Math.sqrt);
    const dot = a.reduce((s, v, i) => s + v * b[i], 0);
    parts.harmonics = clamp(dot / (Math.hypot(...a) * Math.hypot(...b) || 1), 0, 1);
  }
  const ea = ref.envelope;
  const eb = cand.envelope;
  parts.envelope = ea && eb
    ? Math.exp(-Math.abs(Math.log((ea.attack + 0.01) / (eb.attack + 0.01))) / 2) * (1 - 0.7 * Math.abs(ea.sustain - eb.sustain))
    : 0.5;
  parts.width = 1 - Math.min(1, Math.abs(ref.width - cand.width) * 1.5);
  parts.bright = Math.exp(-Math.abs(log2((ref.brightness.sustain + 1) / (cand.brightness.sustain + 1))) / 1.2);
  const sa = ref.space;
  const sb = cand.space;
  const space = sa?.measured && sb?.measured && sa.resid != null && sb.resid != null;
  if (space) parts.space = Math.exp(-Math.abs(sa.resid - sb.resid) / 8) * Math.exp(-Math.abs(log2(sa.rt60 / sb.rt60)) / 1.5);
  const w = tone
    ? { tone: 0.3, harmonics: 0.25, envelope: 0.15, width: 0.1, bright: 0.12, space: 0.08 }
    : { tone: 0.45, envelope: 0.2, width: 0.1, bright: 0.17, space: 0.08 };
  if (!space) delete w.space;
  let score = 0;
  let total = 0;
  for (const [k, v] of Object.entries(w)) {
    score += v * parts[k];
    total += v;
  }
  return { score: Math.round((score / total) * 100), parts };
}

// ---------------------------------------------------------------------------
// 특징 → 음색
// ---------------------------------------------------------------------------

const FM_RATIOS = PARAMS['fm.ratio'].values;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** 한 음을 다시 합성: 배음 표를 그대로 옮기고 엔벨로프·밝기·흔들림·공간을 맞춘다. */
export function patchFromTone(a, { name = '닮은 음색' } = {}) {
  const p = structuredClone(BASE_PATCH);
  const f0 = a.pitch.hz;
  const note = a.pitch.note;
  const e = a.envelope;
  const notes = [];
  p.source = 'synth';
  // 밝기가 첫소리에서 더 높으면 필터 엔벨로프로, 아니면 필터를 열어 두고 배음 표만으로
  const ratio = a.brightness.early / Math.max(1, a.brightness.sustain);
  const envOct = ratio > 1.15 ? clamp(log2(ratio) * 1.6, 0.3, 3) : 0;
  let base = 18000;
  if (envOct > 0) {
    base = clamp(a.brightness.sustain * 2.2, 400, 12000);
    p.filter.keytrack = 0.8;
    p.filter.env = round(envOct, 2);
    p.filterEnv = { a: clamp(e.attack * 0.5, 0.001, 2), d: clamp(a.brightness.settle * 4, 0.05, 6), s: 0, r: clamp(e.release, 0.05, 6) };
    notes.push(`첫소리가 더 밝아서 필터가 ${a.brightness.settle < 0.2 ? '빠르게' : '천천히'} 닫히게 했어요`);
  } else {
    // 밝기 변화가 없으면, 원음 스펙트럼이 봉우리보다 30dB 떨어지는 높이의 절반에 필터를 둔다.
    // 배음 표는 아래에서 그만큼 보정하므로 배음은 그대로이고, 숨소리·겹친 소리의 높은 잡음만 원음처럼 깎인다
    const { centers, db } = a.curve;
    let iMax = centers.findIndex((c) => c >= f0 * 0.8);
    if (iMax < 0) iMax = 0;
    for (let i = iMax; i < db.length; i++) if (db[i] > db[iMax]) iMax = i;
    let fr = 18000;
    for (let i = iMax + 1; i < db.length; i++) {
      if (db[i] < db[iMax] - 30) {
        fr = centers[i];
        break;
      }
    }
    // 숨소리처럼 고른 잡음이 있으면(바닥이 높은 곳까지 이어짐) 필터로 깎지 않는다
    const breathy = a.noiseLevel > 0.005 && a.noiseTilt > -6;
    if (fr < 14000 && !breathy) {
      p.filter.keytrack = 0.5;
      base = clamp(fr * 0.5, f0 * 3, 16000);
    } else p.filter.keytrack = 0;
  }
  const velShift = 2 ** ((0.8 - 0.7) * p.vel.filter);
  p.filter.cutoff = clamp(base / 2 ** ((p.filter.keytrack * (note - 60)) / 12) / velShift, 40, 18000);
  p.filter.q = 0.7;
  // 필터가 깎는 만큼 배음 표를 미리 키워 둔다 (안정 부분에서 원음과 같은 배음이 되도록)
  const custom = a.harmonics.slice(0, CUSTOM_LEN).map((amp, i) => {
    const comp = base < 17000 ? Math.min(16, 1 / lowpassMag((i + 1) * f0, base, 0.7, a.sr)) : 1;
    return amp * comp;
  });
  const top = Math.max(...custom) || 1;
  p.custom = custom.map((v) => round(v / top));
  p.osc[0] = { ...p.osc[0], wave: 'custom', level: 0.75 };
  notes.push(`배음 ${p.custom.filter((v) => v > 0.01).length}개를 재서 파형을 직접 그렸어요`);
  // 숨소리·잡음: 배음 사이 바닥 높이(σ/A)를 엔진 노이즈 값으로. 노이즈 σ = 0.35·noise/√3, 가장 센 배음 = 세기 × (그린 파형의 가장 센 배음/최고점)
  const cyc = waveCycle('custom', 256, p.custom, false);
  const cycPeak = cyc.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  p.noise = round(clamp(a.noiseLevel * p.osc[0].level * (1 / cycPeak) * (Math.sqrt(3) / 0.35), 0, 0.6), 3);
  if (p.noise > 0.05) notes.push('배음 사이의 바람·숨소리를 노이즈로 더했어요');
  // 엔벨로프
  p.ampEnv = { a: round(e.attack), d: round(e.decay), s: round(e.sustain, 2), r: round(e.release) };
  // 늘어난 배음·종소리
  const inh = a.inharmonicity;
  const bellish = a.partials[0] && a.partials[0].amp > 0.25 && a.harmonicity < 0.85;
  // 비브라토가 있으면 높은 배음 자리가 번져 늘어난 것처럼 보이므로 그때는 배음 늘어남을 믿지 않는다
  const stretched = inh > 0.005 && !a.vibrato;
  if (stretched || bellish) {
    const want = bellish ? a.partials[0].ratio : 2;
    const ratioFm = FM_RATIOS.reduce((b, r) => (Math.abs(r - want) < Math.abs(b - want) ? r : b), FM_RATIOS[0]);
    p.fm = { amount: round(clamp(0.12 + inh * 6 + (a.partials[0]?.amp ?? 0) * 0.3, 0.1, 0.55), 2), ratio: ratioFm, decay: round(clamp(e.decay * 0.4, 0.1, 4)), sustain: 0.1 };
    notes.push(bellish ? `정수배에서 벗어난 배음(×${want})이 있어 FM 으로 쇳소리를 더했어요` : '높은 배음이 위로 늘어나(피아노 줄처럼) FM 으로 살짝 맞췄어요');
  }
  // 흔들림
  if (a.vibrato) {
    p.lfo = { target: 'pitch', rate: a.vibrato.rate, depth: round(clamp(a.vibrato.depth / 50, 0.02, 1), 2), delay: round(clamp(e.attack + 0.15, 0, 1.5), 2) };
    notes.push(`비브라토 ${a.vibrato.rate}Hz · ±${a.vibrato.depth} cent`);
  } else if (a.tremolo) {
    p.lfo = { target: 'amp', rate: a.tremolo.rate, depth: round(clamp(a.tremolo.depth / 8, 0.05, 0.8), 2), delay: 0 };
    notes.push(`트레몰로 ${a.tremolo.rate}Hz`);
  }
  // 첫소리 잡음
  if (a.transient > 0.15 && e.attack < 0.05) {
    p.click = round(clamp(a.transient * 0.6, 0, 0.6), 2);
    p.clickTone = round(clamp(log2(a.brightness.early / 700) / 3.6, 0, 1), 2);
    notes.push('해머·피크 같은 첫소리를 어택 소리로 넣었어요');
  }
  applySpace(p, a, notes);
  // 잔향도 좌우를 넓히므로(대략 양 × 0.6) 그만큼 빼고 남는 폭만 겹치기·코러스로
  const dryWidth = a.width - p.fx.reverb * 0.6;
  if (dryWidth > 0.25) {
    p.osc[0].unison = 3;
    p.osc[0].spread = round(clamp(dryWidth * 22, 4, 18), 1);
    p.fx.chorus = round(clamp((dryWidth - 0.2) * 1.2, 0, 0.6), 2);
    notes.push('좌우로 넓은 소리라 겹치기·코러스를 더했어요');
  }
  p.category = guessCategory(a);
  if (p.category === 'bass' && e.sustain > 0.3) {
    p.mono = true;
    p.glide = 0.03;
  }
  p.name = name.slice(0, 40);
  return { patch: normalizePatch(p), notes, render: [note] };
}

function applySpace(p, a, notes) {
  p.fx.reverb = round(a.space.amount, 2);
  p.fx.size = round(a.space.rt60, 2);
  // 짧은 꼬리는 작은 방, 아주 긴 꼬리는 교회처럼
  if (a.space.measured) p.fx.reverbType = a.space.rt60 < 1.2 ? 'room' : a.space.rt60 > 4 ? 'church' : 'hall';
  p.fx.width = round(clamp(0.7 + Math.max(0, a.width - p.fx.reverb * 0.6) * 1.8, 0, 2), 2);
  if (a.space.measured) notes.push(`잔향 ${a.space.rt60.toFixed(1)}초 · 양 ${Math.round(a.space.amount * 100)}%`);
}

function guessCategory(a) {
  const e = a.envelope;
  const f0 = a.pitch?.hz ?? 220;
  if (f0 < 140 && e.attack < 0.08) return 'bass';
  if (a.partials[0]?.amp > 0.25 && a.harmonicity < 0.85) return e.decay > 1.5 ? 'bell' : 'keys';
  if (a.inharmonicity > 0.005 && !a.vibrato) return 'keys';
  if (e.sustain < 0.2) return e.decay < 1.2 ? 'pluck' : 'keys';
  if (e.attack > 0.25) return a.vibrato ? (a.harmonicity < 0.6 ? 'choir' : 'strings') : 'pad';
  if (a.vibrato) return 'lead';
  return 'keys';
}

/** 기본 음색의 대략적인 성격 (렌더 없이 값으로) — 믹스·화음에서 가장 닮은 출발점 고르기 */
export function patchTraits(p) {
  const sustain = p.source === 'pluck' ? 0.1 : p.ampEnv.s + (p.ampEnv.s < 0.3 ? Math.min(0.4, p.ampEnv.d / 10) : 0);
  const h = harmonicsOf(p.osc[0].wave, p.custom, 32);
  let num = 0;
  let den = 0;
  h.forEach((amp, i) => {
    const f = (i + 1) * 262;
    const g = p.source === 'pluck' ? (p.pluck.bright + 0.3) / (i + 1) ** 0.5 : amp * lowpassMag(f, p.filter.cutoff * 2 ** Math.max(0, p.filter.env * 0.5), p.filter.q, 44100);
    num += g * g * f;
    den += g * g;
  });
  const fmLift = p.source === 'synth' ? 1 + p.fm.amount * 2 : 1;
  return {
    attack: p.source === 'pluck' ? 0.002 : p.ampEnv.a,
    sustain: clamp(sustain, 0, 1),
    bright: (den > 0 ? num / den : 1000) * fmLift,
    width: p.fx.width * (1 + 0.3 * (p.osc[0].unison > 1)) * (1 + 0.4 * p.fx.chorus),
    space: p.fx.reverb,
  };
}

/** 특징으로 본 대략적인 성격 */
export function audioTraits(a) {
  return {
    attack: a.kind === 'mix' ? (a.sustainRatio > 0.7 ? 0.3 : 0.005) : a.envelope.attack,
    sustain: a.kind === 'tone' ? a.envelope.sustain : clamp(a.sustainRatio, 0, 1),
    bright: a.brightness.sustain,
    width: 0.7 + a.width * 1.8,
    space: a.space.amount,
  };
}

/** 성격 거리 (작을수록 닮음) */
export function traitDistance(x, y) {
  return Math.abs(Math.log((x.attack + 0.01) / (y.attack + 0.01))) * 0.8
    + Math.abs(x.sustain - y.sustain) * 2.2
    + Math.abs(log2((x.bright + 50) / (y.bright + 50))) * 1.2
    + Math.abs(x.width - y.width) * 0.6
    + Math.abs(x.space - y.space) * 0.8;
}

/** 화음·믹스: 가장 닮은 기본 음색에서 출발해 공간·폭·엔벨로프를 원음 쪽으로 옮긴다. */
export function patchFromMix(a, presets, { name = '닮은 음색' } = {}) {
  const want = audioTraits(a);
  const ranked = presets
    .map((entry) => ({ entry, d: traitDistance(want, patchTraits(entry.patch)) }))
    .sort((x, y) => x.d - y.d);
  const adapt = (from) => adaptToMix(from, a, name);
  const from = ranked[0].entry.patch;
  const p = adapt(from);
  // 다음 후보 둘도 같은 방법으로 옮겨 둔다 (렌더해 보고 더 닮은 쪽을 고르게)
  const alternatives = ranked.slice(1, 3).map((r) => ({ patch: adapt(r.entry.patch), from: r.entry.patch.name }));
  const notes = [`값으로 본 가장 닮은 기본 음색 '${from.name}'·'${ranked[1]?.entry.patch.name}'·'${ranked[2]?.entry.patch.name}'을 연주해 견줬어요`];
  // 비교용으로 칠 음: 센 음 높이(최대 4개)를 소리 중심 높이 근처에 쌓는다
  const pcs = a.strongPcs.slice(0, 4);
  const root = pcs.length ? pcs[0] : a.centerMidi % 12;
  const baseMidi = a.centerMidi - ((a.centerMidi - root + 120) % 12);
  const render = (pcs.length ? pcs : [root]).map((pc) => baseMidi + ((pc - root + 12) % 12));
  notes.push(a.kind === 'chord' ? '화음·지속음이라 톤 균형(맞춤 EQ) 위주로 맞춰요' : '여러 소리가 섞인 구간이라 톤 균형(맞춤 EQ) 위주로 맞춰요');
  return { patch: p, notes, render, from: from.name, alternatives, ranked: ranked.slice(0, 3).map((r) => r.entry.patch.name) };
}

/** 기본 음색을 원음 쪽으로: 공간·폭·(화음이면) 어택·비브라토를 옮기고 맞춤 EQ 는 비운다 */
function adaptToMix(from, a, name) {
  const p = structuredClone(from);
  const mix = (x, y, t) => x + (y - x) * t;
  p.fx.reverb = round(mix(p.fx.reverb, a.space.amount, a.space.measured ? 0.8 : 0.4), 2);
  if (a.space.measured) p.fx.size = round(a.space.rt60, 2);
  p.fx.width = round(clamp(mix(p.fx.width, 0.7 + a.width * 1.8, 0.7), 0, 2), 2);
  if (a.kind === 'chord' && a.envelope.attack > 0.15) p.ampEnv.a = round(mix(p.ampEnv.a, a.envelope.attack, 0.6));
  if (a.vibrato && p.lfo.depth < 0.05) p.lfo = { target: 'pitch', rate: a.vibrato.rate, depth: round(a.vibrato.depth / 50, 2), delay: 0.4 };
  p.eq = { ...p.eq, match: p.eq.match.map(() => 0) };
  p.name = name.slice(0, 40);
  return normalizePatch(p);
}

/** 분석 결과에 맞는 출발 음색. kind 에 따라 다시 합성하거나 가장 닮은 기본 음색을 고른다. */
export function planPatch(a, presets, opts = {}) {
  if (a.kind === 'tone' && a.harmonics && a.pitch) return { mode: 'resynth', ...patchFromTone(a, opts) };
  return { mode: 'nearest', ...patchFromMix(a, presets, opts) };
}

/** 지금 음색에 원음의 톤 균형(맞춤 EQ)·공간·폭만 입힌다. */
export function applyTone(patch, a, eqMatch) {
  const p = structuredClone(patch);
  p.eq = { ...p.eq, match: eqMatch };
  p.fx.width = round(clamp(0.7 + a.width * 1.8, 0, 2), 2);
  if (a.space.measured) {
    p.fx.reverb = round(a.space.amount, 2);
    p.fx.size = round(a.space.rt60, 2);
  }
  return normalizePatch(p);
}

// ---------------------------------------------------------------------------
// 긴 음원에서 들을 만한 구간 고르기
// ---------------------------------------------------------------------------

/**
 * 소리가 크고 고르게 이어지는 구간(기본 2.5초) 후보를 점수 순으로 count 개 고른다 (서로 겹치지 않게).
 * 첫 후보는 패드·지속음 분석에 좋다. 반환: [{ start, end }] 샘플 번호.
 */
export function suggestRegions(x, sr, { seconds = 2.5, count = 3 } = {}) {
  const hop = Math.round(sr * 0.05);
  const env = rmsFrames(x, 0, x.length, hop);
  const db = Array.from(env, (v) => 20 * Math.log10(v + 1e-9));
  const win = Math.max(4, Math.round(seconds / 0.05));
  if (db.length <= win) return [{ start: 0, end: x.length }];
  const med = median(db);
  const scored = [];
  for (let s = 0; s + win <= db.length; s += 2) {
    let sum = 0;
    let sq = 0;
    let jumps = 0;
    for (let i = s; i < s + win; i++) {
      sum += db[i];
      sq += db[i] * db[i];
      if (i > s && db[i] - db[i - 1] > 5) jumps++;
    }
    const mean = sum / win;
    const sd = Math.sqrt(Math.max(0, sq / win - mean * mean));
    if (mean < med - 6) continue;
    scored.push({ score: mean - 1.5 * sd - 3 * jumps, s });
  }
  scored.sort((p, q) => q.score - p.score);
  const picked = [];
  for (const c of scored) {
    if (picked.every((p) => Math.abs(p.s - c.s) >= win)) picked.push(c);
    if (picked.length >= count) break;
  }
  if (!picked.length) return [{ start: 0, end: Math.min(x.length, win * hop) }];
  return picked.map((c) => ({ start: c.s * hop, end: Math.min(x.length, (c.s + win) * hop) }));
}

export function suggestRegion(x, sr, opts) {
  return suggestRegions(x, sr, { ...opts, count: 1 })[0];
}

// ---------------------------------------------------------------------------
// 늘리기 (Paulstretch): 어떤 소리든 흐르는 앰비언트 패드로
// ---------------------------------------------------------------------------

/**
 * 창마다 크기 스펙트럼만 남기고 위상을 흩어 다시 겹쳐 붙인다. factor 배로 길어지고, 음높이는 그대로.
 * 반환: 최고점 0.9 로 맞춘 Float32Array.
 */
export function paulstretch(x, sr, factor = 8, { windowSec = 0.37, seed = 1 } = {}) {
  let n = 1024;
  while (n < windowSec * sr && n < 65536) n *= 2;
  const half = n / 2;
  const win = Float64Array.from({ length: n }, (_, i) => (1 - ((2 * i) / (n - 1) - 1) ** 2) ** 1.25);
  const outLen = Math.round(x.length * factor) + n;
  const out = new Float32Array(outLen);
  const hopIn = half / factor;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let pos = 0, o = 0; o + n <= outLen; pos += hopIn, o += half) {
    const at = Math.floor(pos);
    for (let i = 0; i < n; i++) {
      re[i] = (x[at + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= half; k++) {
      const m = Math.hypot(re[k], im[k]);
      const ph = 2 * Math.PI * rnd();
      re[k] = m * Math.cos(ph);
      im[k] = m * Math.sin(ph);
      if (k > 0 && k < half) {
        re[n - k] = re[k];
        im[n - k] = -im[k];
      }
    }
    im[0] = 0;
    im[half] = 0;
    fft(re, im, true);
    for (let i = 0; i < n; i++) out[o + i] += re[i] * win[i];
  }
  const trimmed = out.subarray(half, half + Math.round(x.length * factor));
  const peak = peakOf(trimmed) || 1;
  return Float32Array.from(trimmed, (v) => (v / peak) * 0.9);
}
