// 음색(패치) 형식: 무엇을 저장하고, 어떤 범위까지 움직일 수 있는지.
// 화면의 모든 슬라이더·랜덤 만들기·변주·JSON 불러오기가 이 표 하나를 따른다.
import { makeRng } from './rng.js';
import { FLAT_TONE, LOWCUT_OFF, TONE_BANDS } from './tone.js';

export const PATCH_VERSION = 1;

export const SOURCES = [
  { id: 'synth', label: '신스', hint: '오실레이터 두 개 + FM + 노이즈' },
  { id: 'pluck', label: '줄 뜯기', hint: '물리 모델 (Karplus-Strong)' },
  { id: 'sample', label: '샘플', hint: '샘플러 탭에서 고른 소리' },
];

export const CATEGORIES = [
  { id: 'pad', label: '패드' },
  { id: 'keys', label: '건반' },
  { id: 'strings', label: '현·관' },
  { id: 'bell', label: '벨' },
  { id: 'bass', label: '베이스' },
  { id: 'lead', label: '리드' },
  { id: 'pluck', label: '줄·플럭' },
];

export const WAVES = [
  { id: 'sine', label: '사인' },
  { id: 'triangle', label: '삼각' },
  { id: 'sawtooth', label: '톱니' },
  { id: 'square', label: '사각' },
  { id: 'warm', label: '따뜻한' },
  { id: 'choir', label: '합창' },
  { id: 'organ', label: '오르간' },
  { id: 'custom', label: '직접 그림' },
];

export const HARMONIC_COUNT = 24;

// 직접 만든 파형의 배음 세기 (사인 성분, 1번 = 기본음)
export const HARMONICS = {
  // band2sheet 반주 합성기의 'warm': 배음이 1/h^1.25 로 줄어 톱니보다 부드럽다
  warm: Array.from({ length: 32 }, (_, i) => 1 / (i + 1) ** 1.25),
  // AirChoir 패드: 1/h^1.6 에 3~5배음('오~' 모음 근처)을 살짝 살림
  choir: Array.from({ length: 24 }, (_, i) => {
    const h = i + 1;
    return (1 / h ** 1.6) * (1 + 0.6 * Math.exp(-0.5 * ((h - 4) / 1.5) ** 2));
  }),
  // 파이프 오르간 스톱 8' 4' 2⅔' 2' 1⅗' 1' (= 1, 2, 3, 4, 5, 8배음)
  organ: (() => {
    const h = new Array(16).fill(0);
    Object.entries({ 1: 1, 2: 0.7, 3: 0.45, 4: 0.5, 5: 0.2, 8: 0.25 }).forEach(([k, v]) => { h[k - 1] = v; });
    return h;
  })(),
};

/** 파형의 배음 세기 24개 (최대 1). '직접 그림'을 시작할 때 지금 파형에서 출발한다. */
export function harmonicsOf(id, custom = null) {
  let h;
  if (id === 'custom' && custom) h = custom.slice(0, HARMONIC_COUNT);
  else if (id === 'sine') h = [1];
  else if (id === 'sawtooth') h = Array.from({ length: HARMONIC_COUNT }, (_, i) => 1 / (i + 1));
  else if (id === 'square') h = Array.from({ length: HARMONIC_COUNT }, (_, i) => ((i + 1) % 2 ? 1 / (i + 1) : 0));
  else if (id === 'triangle') h = Array.from({ length: HARMONIC_COUNT }, (_, i) => ((i + 1) % 2 ? 1 / (i + 1) ** 2 : 0));
  else h = HARMONICS[id] ?? [1];
  const out = Array.from({ length: HARMONIC_COUNT }, (_, i) => Math.max(0, h[i] ?? 0));
  const top = Math.max(...out) || 1;
  return out.map((v) => Math.round((v / top) * 1000) / 1000);
}

/** 파형 한 주기 (그림용). n 개 점, -1..1. */
export function waveCycle(id, n = 64, custom = null) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    if (id === 'sine') out[i] = Math.sin(2 * Math.PI * x);
    else if (id === 'triangle') out[i] = 1 - 4 * Math.abs(((x + 0.25) % 1) - 0.5);
    else if (id === 'sawtooth') out[i] = 2 * ((x + 0.5) % 1) - 1;
    else if (id === 'square') out[i] = x < 0.5 ? 1 : -1;
    else {
      const h = id === 'custom' ? harmonicsOf('custom', custom) : HARMONICS[id] || [1];
      out[i] = h.reduce((s, a, k) => s + a * Math.sin(2 * Math.PI * (k + 1) * x), 0);
    }
  }
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  return out.map((v) => v / peak);
}

const FM_RATIOS = [0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 7, 9, 14];
const DELAY_BEATS = [0.25, 0.5, 0.75, 1, 1.5];

const num = (label, unit, min, max, extra = {}) => ({ kind: 'num', label, unit, min, max, scale: 'lin', ...extra });
const log = (label, unit, min, max, extra = {}) => num(label, unit, min, max, { scale: 'log', ...extra });
const int = (label, unit, min, max) => num(label, unit, min, max, { step: 1 });
const choice = (label, values, labels) => ({ kind: 'enum', label, values, labels });

const oscParams = (i) => ({
  [`osc.${i}.wave`]: choice('파형', WAVES.map((w) => w.id), WAVES.map((w) => w.label)),
  [`osc.${i}.octave`]: int('옥타브', 'oct', -2, 2),
  [`osc.${i}.semi`]: int('반음', 'st', -12, 12),
  [`osc.${i}.detune`]: num('미세 음정', 'cent', -50, 50),
  [`osc.${i}.level`]: num('세기', 'pct', 0, 1),
  [`osc.${i}.unison`]: int('겹치기', 'voices', 1, 7),
  [`osc.${i}.spread`]: num('겹친 소리 퍼짐', 'cent', 0, 50),
});

const envParams = (key) => ({
  [`${key}.a`]: log('어택', 's', 0.001, 8),
  [`${key}.d`]: log('디케이', 's', 0.01, 8),
  [`${key}.s`]: num('서스테인', 'pct', 0, 1),
  [`${key}.r`]: log('릴리즈', 's', 0.01, 10),
});

export const PARAMS = {
  source: choice('소리 재료', SOURCES.map((s) => s.id), SOURCES.map((s) => s.label)),
  ...oscParams(0),
  ...oscParams(1),
  'fm.amount': num('FM 세기', 'pct', 0, 1),
  'fm.ratio': choice('FM 비율', FM_RATIOS, FM_RATIOS.map((r) => `×${r}`)),
  'fm.decay': log('FM 줄어드는 시간', 's', 0.05, 6),
  'fm.sustain': num('FM 남는 양', 'pct', 0, 1),
  noise: num('숨소리(노이즈)', 'pct', 0, 1),
  'pluck.bright': num('밝기', 'pct', 0, 1),
  'pluck.decay': log('울림 시간', 's', 0.2, 8),
  'pluck.pick': num('뜯는 위치', 'pct', 0.05, 0.5),
  'pluck.body': num('울림통', 'pct', 0, 1),
  'filter.type': choice('필터 종류', ['lowpass', 'highpass', 'bandpass'], ['저역 통과', '고역 통과', '대역 통과']),
  'filter.cutoff': log('차단 주파수', 'Hz', 40, 18000),
  'filter.q': log('레조넌스', 'q', 0.1, 18),
  'filter.env': num('엔벨로프 양', 'oct', -4, 4),
  'filter.keytrack': num('건반 따라가기', 'pct', 0, 1),
  ...envParams('filterEnv'),
  ...envParams('ampEnv'),
  'lfo.target': choice('흔드는 곳', ['pitch', 'filter', 'amp'], ['음정 (비브라토)', '필터 (와우)', '볼륨 (트레몰로)']),
  'lfo.rate': log('빠르기', 'Hz', 0.05, 12),
  'lfo.depth': num('깊이', 'pct', 0, 1),
  'lfo.delay': num('늦게 시작', 's', 0, 4),
  'fx.drive': num('드라이브', 'pct', 0, 1),
  'fx.chorus': num('코러스', 'pct', 0, 1),
  'fx.delay': num('딜레이', 'pct', 0, 1),
  'fx.delayBeats': choice('딜레이 간격', DELAY_BEATS, ['1/16', '1/8', '점8분', '1/4', '점4분']),
  'fx.feedback': num('딜레이 반복', 'pct', 0, 0.9),
  'fx.reverb': num('잔향', 'pct', 0, 1),
  'fx.size': log('잔향 길이', 's', 0.5, 8),
  // 톤 맞추기: 효과까지 거친 소리 전체에 거는 대역 6개 + 로우컷 (믹서 채널 EQ 처럼)
  ...Object.fromEntries(TONE_BANDS.map((b) => [`tone.${b.id}`, num(b.label, 'dB', -12, 12)])),
  'tone.lowcut': log('로우컷', 'Hz', LOWCUT_OFF, 400),
  glide: num('글라이드', 's', 0, 1),
  mono: { kind: 'bool', label: '한 음씩 (모노)' },
  volume: num('볼륨', 'pct', 0, 1),
};

// 프리셋이 비워 둔 값은 이 '담백한' 소리로 채운다.
export const BASE_PATCH = {
  v: PATCH_VERSION,
  name: '새 음색',
  category: 'pad',
  source: 'synth',
  osc: [
    { wave: 'sawtooth', octave: 0, semi: 0, detune: 0, level: 0.7, unison: 1, spread: 0 },
    { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 0, unison: 1, spread: 0 },
  ],
  fm: { amount: 0, ratio: 1, decay: 0.8, sustain: 0.2 },
  noise: 0,
  pluck: { bright: 0.6, decay: 2.5, pick: 0.2, body: 0.5 },
  filter: { type: 'lowpass', cutoff: 8000, q: 0.7, env: 0, keytrack: 0.5 },
  filterEnv: { a: 0.01, d: 0.5, s: 0.5, r: 0.5 },
  ampEnv: { a: 0.005, d: 0.3, s: 0.8, r: 0.3 },
  lfo: { target: 'pitch', rate: 5, depth: 0, delay: 0 },
  fx: { drive: 0, chorus: 0, delay: 0, delayBeats: 0.75, feedback: 0.35, reverb: 0.15, size: 2.2 },
  tone: { ...FLAT_TONE },
  glide: 0,
  mono: false,
  volume: 0.8,
  custom: harmonicsOf('choir'),
};

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** 사본에 값 하나를 넣어 돌려준다 (원본은 그대로). */
export function setPath(obj, path, value) {
  const copy = structuredClone(obj);
  const keys = path.split('.');
  let o = copy;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
  return copy;
}

function clampParam(spec, v, fallback) {
  if (spec.kind === 'bool') return typeof v === 'boolean' ? v : fallback;
  if (spec.kind === 'enum') return spec.values.includes(v) ? v : fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const c = Math.min(spec.max, Math.max(spec.min, v));
  return spec.step ? Math.round(c / spec.step) * spec.step : c;
}

/** 어떤 입력(프리셋 일부, 불러온 JSON)이든 앱이 믿고 쓸 수 있는 완전한 음색으로. */
export function normalizePatch(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  let out = structuredClone(BASE_PATCH);
  for (const [path, spec] of Object.entries(PARAMS)) {
    out = setPath(out, path, clampParam(spec, getPath(src, path), getPath(BASE_PATCH, path)));
  }
  out.name = typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 40) : BASE_PATCH.name;
  out.custom = Array.isArray(src.custom) && src.custom.length === HARMONIC_COUNT && src.custom.every(Number.isFinite)
    ? src.custom.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000)
    : BASE_PATCH.custom.slice();
  out.category = CATEGORIES.some((c) => c.id === src.category) ? src.category : BASE_PATCH.category;
  return out;
}

// ---------------------------------------------------------------------------
// 슬라이더 위치(0..1) <-> 실제 값, 값 읽기 좋게 쓰기
// ---------------------------------------------------------------------------

export function toUnit(spec, v) {
  if (spec.scale === 'log') return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
  return (v - spec.min) / (spec.max - spec.min);
}

export function fromUnit(spec, u) {
  const x = Math.min(1, Math.max(0, u));
  const v = spec.scale === 'log' ? spec.min * (spec.max / spec.min) ** x : spec.min + x * (spec.max - spec.min);
  return clampParam(spec, v, spec.min);
}

const signed = (v, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`;

export function formatValue(path, v) {
  const spec = PARAMS[path];
  if (!spec) return String(v);
  if (spec.kind === 'bool') return v ? '켬' : '끔';
  if (spec.kind === 'enum') return spec.labels[spec.values.indexOf(v)] ?? String(v);
  if (path === 'tone.lowcut' && v <= LOWCUT_OFF + 0.5) return '끔';
  switch (spec.unit) {
    case 'Hz': return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} Hz`;
    case 's': return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case 'cent': return `${signed(v)} cent`;
    case 'pct': return `${Math.round(v * 100)}%`;
    case 'oct': return path.endsWith('.octave') ? signed(v) : `${signed(v, 1)} oct`;
    case 'st': return signed(v);
    case 'voices': return v === 1 ? '1개' : `${v}개`;
    case 'q': return v.toFixed(v >= 10 ? 0 : 1);
    case 'dB': return Math.abs(v) < 0.05 ? '0 dB' : `${signed(v, 1)} dB`;
    default: return String(v);
  }
}

// ---------------------------------------------------------------------------
// 엔벨로프 (화면 그림과 엔진의 '놓는 순간 높이'가 같은 식을 쓴다)
// ---------------------------------------------------------------------------

/** 누른 뒤 t 초의 높이 (0..1). 디케이는 시간 상수 d/4 로 서스테인에 다가간다. */
export function envLevel(env, t) {
  if (t <= 0) return 0;
  if (t < env.a) return t / env.a;
  return env.s + (1 - env.s) * Math.exp(-(t - env.a) / Math.max(env.d / 4, 1e-4));
}

/** held 초 누르고 놓은 뒤 t 초의 높이. 릴리즈는 시간 상수 r/5. */
export function releaseLevel(env, held, t) {
  return envLevel(env, held) * Math.exp(-Math.max(0, t) / Math.max(env.r / 5, 1e-4));
}

// ---------------------------------------------------------------------------
// 도우미 슬라이더: 0.5 = 지금 소리 그대로, 좌우로 여러 값을 함께 움직임
// ---------------------------------------------------------------------------

export const MACROS = [
  { id: 'bright', label: '밝기', low: '어둡게', high: '또렷하게' },
  { id: 'warm', label: '따뜻함', low: '가볍게', high: '두껍게' },
  { id: 'space', label: '공간', low: '가까이', high: '넓은 홀' },
  { id: 'motion', label: '움직임', low: '고요하게', high: '출렁이게' },
];

const clampTo = (path, v) => clampParam(PARAMS[path], v, getPath(BASE_PATCH, path));

export function applyMacro(base, id, value) {
  const d = Math.min(1, Math.max(0, value)) - 0.5;
  const p = structuredClone(base);
  const put = (path, v) => {
    const keys = path.split('.');
    let o = p;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys.at(-1)] = clampTo(path, v);
  };
  if (id === 'bright') {
    put('filter.cutoff', base.filter.cutoff * 2 ** (d * 6));
    put('pluck.bright', base.pluck.bright + d);
  } else if (id === 'warm') {
    put('fx.drive', base.fx.drive + d * 0.5);
    put('osc.1.level', base.osc[1].level + d * 0.6);
    put('filter.cutoff', base.filter.cutoff * 2 ** (-d * 0.8));
    put('pluck.body', base.pluck.body + d);
  } else if (id === 'space') {
    put('fx.reverb', base.fx.reverb + d);
    put('fx.size', base.fx.size * 2 ** (d * 2));
    put('fx.delay', base.fx.delay + d * 0.5);
    put('ampEnv.r', base.ampEnv.r * 2 ** (d * 2));
  } else if (id === 'motion') {
    put('fx.chorus', base.fx.chorus + d);
    put('lfo.depth', base.lfo.depth + d * 0.8);
    put('lfo.rate', base.lfo.rate * 2 ** (d * 1.5));
  }
  return p;
}

// ---------------------------------------------------------------------------
// 랜덤 만들기 / 변주
// ---------------------------------------------------------------------------

export const RANDOM_KINDS = ['pad', 'keys', 'bass', 'lead', 'bell', 'pluck'];

export function randomPatch(kind = 'pad', seed = Date.now()) {
  const r = makeRng(seed);
  const p = structuredClone(BASE_PATCH);
  const sustainWaves = ['sawtooth', 'warm', 'choir', 'triangle', 'square'];
  p.category = kind;
  p.osc[0] = { ...p.osc[0], wave: r.pick(sustainWaves), level: r.range(0.5, 0.7) };
  p.osc[1] = { ...p.osc[1], wave: r.pick(sustainWaves), octave: r.pick([-1, 0, 1]), level: r.range(0.1, 0.4) };
  if (kind === 'pad') {
    p.osc[0].unison = r.int(3, 6);
    p.osc[0].spread = r.range(8, 22);
    Object.assign(p.filter, { cutoff: r.logRange(600, 4000), q: r.range(0.3, 2), env: r.range(0.2, 1.5) });
    p.ampEnv = { a: r.range(0.4, 2.5), d: r.range(1, 3), s: r.range(0.7, 1), r: r.range(1.5, 4) };
    p.filterEnv = { a: r.range(0.5, 3), d: r.range(1, 4), s: r.range(0.3, 0.8), r: r.range(1, 3) };
    p.lfo = { target: r.pick(['filter', 'pitch', 'amp']), rate: r.logRange(0.05, 0.6), depth: r.range(0.1, 0.4), delay: 0 };
    if (p.lfo.target === 'pitch') p.lfo.depth *= 0.3;
    Object.assign(p.fx, { chorus: r.range(0.2, 0.7), reverb: r.range(0.35, 0.75), size: r.range(3, 7), delay: r.range(0, 0.3) });
  } else if (kind === 'keys') {
    p.osc[0].wave = r.pick(['sine', 'triangle', 'warm']);
    p.osc[1].level = r.range(0, 0.25);
    if (r.chance(0.6)) p.fm = { amount: r.range(0.2, 0.6), ratio: r.pick([1, 2, 3, 14]), decay: r.range(0.3, 1.5), sustain: r.range(0, 0.2) };
    p.filter.cutoff = r.logRange(2000, 9000);
    p.ampEnv = { a: r.range(0.001, 0.01), d: r.range(0.8, 3), s: r.range(0, 0.3), r: r.range(0.2, 0.8) };
    p.lfo = { target: 'amp', rate: r.range(3, 6), depth: r.range(0, 0.2), delay: 0 };
    Object.assign(p.fx, { chorus: r.range(0, 0.4), reverb: r.range(0.15, 0.4) });
  } else if (kind === 'bass') {
    p.mono = true;
    p.glide = r.range(0, 0.08);
    p.osc[0] = { ...p.osc[0], octave: -1, wave: r.pick(['sawtooth', 'square', 'warm']) };
    p.osc[1] = { ...p.osc[1], octave: r.pick([-2, -1]), wave: r.pick(['sine', 'triangle']), level: r.range(0.3, 0.6) };
    Object.assign(p.filter, { cutoff: r.logRange(150, 900), q: r.range(1, 6), env: r.range(1, 3) });
    p.filterEnv = { a: r.range(0.001, 0.01), d: r.range(0.15, 0.6), s: r.range(0, 0.4), r: r.range(0.1, 0.2) };
    p.ampEnv = { a: r.range(0.002, 0.01), d: 0.3, s: r.range(0.6, 0.9), r: r.range(0.08, 0.2) };
    Object.assign(p.fx, { reverb: r.range(0, 0.1), drive: r.range(0, 0.4) });
  } else if (kind === 'lead') {
    p.mono = r.chance(0.7);
    p.glide = r.range(0.02, 0.12);
    p.osc[0].wave = r.pick(['sawtooth', 'square']);
    p.osc[1] = { ...p.osc[1], wave: 'sawtooth', octave: 0, detune: r.range(3, 12), level: r.range(0.2, 0.45) };
    Object.assign(p.filter, { cutoff: r.logRange(1200, 5000), q: r.range(1, 4), env: r.range(0.5, 2) });
    p.filterEnv = { a: 0.01, d: r.range(0.3, 1), s: r.range(0.3, 0.6), r: 0.3 };
    p.ampEnv = { a: r.range(0.01, 0.05), d: 0.3, s: 0.85, r: r.range(0.2, 0.5) };
    p.lfo = { target: 'pitch', rate: r.range(4.5, 6.5), depth: r.range(0.05, 0.15), delay: r.range(0.2, 0.6) };
    Object.assign(p.fx, { delay: r.range(0.2, 0.4), reverb: r.range(0.2, 0.4) });
  } else if (kind === 'bell') {
    p.osc[0] = { ...p.osc[0], wave: 'sine' };
    p.osc[1].level = r.range(0, 0.15);
    p.fm = { amount: r.range(0.3, 0.7), ratio: r.pick([3.5, 5, 7, 9, 14]), decay: r.range(1, 4), sustain: r.range(0, 0.15) };
    p.ampEnv = { a: 0.001, d: r.range(2, 6), s: 0, r: r.range(2, 4) };
    Object.assign(p.fx, { reverb: r.range(0.4, 0.7), size: r.range(3, 6), delay: r.range(0.1, 0.3) });
  } else {
    if (r.chance(0.5)) {
      p.source = 'pluck';
      p.pluck = { bright: r.range(0.3, 0.95), decay: r.range(1, 5), pick: r.range(0.1, 0.45), body: r.range(0.2, 0.9) };
      p.ampEnv = { a: 0.001, d: 1, s: 1, r: r.range(0.2, 0.6) };
    } else {
      Object.assign(p.filter, { cutoff: r.logRange(300, 900), q: r.range(1, 4), env: r.range(2, 3.5) });
      p.filterEnv = { a: 0.001, d: r.range(0.15, 0.4), s: 0, r: 0.2 };
      p.ampEnv = { a: 0.001, d: r.range(0.4, 0.9), s: 0, r: 0.4 };
    }
    Object.assign(p.fx, { delay: r.range(0.15, 0.4), reverb: r.range(0.2, 0.4) });
  }
  const label = CATEGORIES.find((c) => c.id === kind)?.label ?? '음색';
  p.name = `랜덤 ${label} ${r.int(10, 99)}`;
  return normalizePatch(p);
}

/** 지금 음색을 조금씩 흔든 새 음색. amount 0..1. */
export function mutatePatch(patch, amount = 0.3, seed = Date.now()) {
  const r = makeRng(seed);
  let p = structuredClone(patch);
  for (const [path, spec] of Object.entries(PARAMS)) {
    // 톤은 음색을 다 만든 뒤 방·밴드에 맞추는 값이라 변주에서 흔들지 않는다
    if (['source', 'volume', 'filter.type', 'mono'].includes(path) || path.startsWith('tone.')) continue;
    const v = getPath(p, path);
    let next = v;
    if (spec.kind === 'enum') {
      if (r.chance(amount * 0.25)) next = r.pick(spec.values);
    } else if (spec.kind === 'num' && spec.step) {
      if (r.chance(0.12 * amount * 2)) next = v + r.pick([-1, 1]);
    } else if (spec.kind === 'num' && r.chance(0.45)) {
      next = spec.scale === 'log'
        ? v * 2 ** (r.range(-1, 1) * amount * 2)
        : v + r.range(-1, 1) * amount * (spec.max - spec.min) * 0.35;
    }
    p = setPath(p, path, clampParam(spec, next, v));
  }
  p.name = `${patch.name.replace(/ 변주\d*$/, '')} 변주`.slice(0, 40);
  return normalizePatch(p);
}

// ---------------------------------------------------------------------------
// 지금 소리를 한두 문장으로 (실험실 '지금 소리' 칸). 숫자 부분은 굵게 보이도록 조각으로 돌려준다.
// ---------------------------------------------------------------------------

const NOUN = { pad: '패드예요', keys: '건반 소리예요', strings: '현악 소리예요', bell: '벨 소리예요', bass: '베이스예요', lead: '리드 소리예요', pluck: '플럭 소리예요' };

export function describePatch(p) {
  const parts = [];
  const say = (text, strong = false) => parts.push({ text, strong });
  const bright = p.source === 'pluck' ? 600 + p.pluck.bright * 9000 : p.filter.type === 'lowpass' ? p.filter.cutoff * 2 ** (p.filter.env * 0.5) : 4000;
  const tone = bright < 700 ? '어둡고 부드러운' : bright < 2500 ? '따뜻한' : bright < 7000 ? '또렷한' : '반짝이는';
  say(`${p.fx.drive > 0.3 ? '거칠고 ' : ''}${tone}`, true);
  say(` ${p.source === 'pluck' ? '줄 뜯는 소리예요' : p.source === 'sample' ? '샘플 소리예요' : NOUN[p.category] ?? '소리예요'}. `);
  const a = p.ampEnv.a;
  if (a < 0.02) say('누르자마자 소리가 나고');
  else if (a < 0.3) say('부드럽게 시작하고');
  else {
    say(`${a.toFixed(1)}초`, true);
    say('에 걸쳐 천천히 커지고');
  }
  const rv = p.fx.reverb;
  say(rv < 0.15 ? ', 가까이서 울려요. ' : rv < 0.4 ? ', 작은 방처럼 울려요. ' : rv < 0.65 ? ', 넓은 홀처럼 울려요. ' : ', 큰 예배당처럼 길게 울려요. ');
  const decays = p.source !== 'pluck' && p.ampEnv.s < 0.1;
  if (decays) {
    say('누르고 있어도 ');
    say(`${p.ampEnv.d.toFixed(1)}초`, true);
    say('쯤이면 잦아들어요.');
  } else if (p.ampEnv.r >= 1) {
    say('손을 떼면 ');
    say(`${p.ampEnv.r.toFixed(1)}초`, true);
    say(' 동안 남아요.');
  } else say(p.ampEnv.r >= 0.3 ? '손을 떼면 짧게 남아요.' : '손을 떼면 바로 멈춰요.');
  if (p.lfo.depth > 0.12) say({ pitch: ' 음이 살짝 떨려요(비브라토).', filter: ' 밝기가 숨 쉬듯 천천히 변해요.', amp: ' 소리가 물결처럼 흔들려요.' }[p.lfo.target]);
  else if (p.fx.chorus > 0.4) say(' 좌우로 넓게 퍼져요.');
  return parts;
}
