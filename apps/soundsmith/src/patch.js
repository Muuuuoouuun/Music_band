// 음색(패치) 형식: 무엇을 저장하고, 어떤 범위까지 움직일 수 있는지.
// 화면의 모든 슬라이더·랜덤 만들기·변주·JSON 불러오기가 이 표 하나를 따른다.
import { makeRng } from './rng.js';

export const PATCH_VERSION = 2;

export const SOURCES = [
  { id: 'synth', label: '신스', hint: '오실레이터 두 개 + FM + 노이즈' },
  { id: 'pluck', label: '줄 뜯기', hint: '물리 모델 (Karplus-Strong)' },
  { id: 'sample', label: '샘플', hint: '샘플러 탭에서 고른 소리' },
];

export const CATEGORIES = [
  { id: 'pad', label: '패드' },
  { id: 'keys', label: '건반' },
  { id: 'strings', label: '현악' },
  { id: 'bell', label: '벨' },
  { id: 'bass', label: '베이스' },
  { id: 'lead', label: '리드' },
  { id: 'pluck', label: '줄·플럭' },
  { id: 'choir', label: '합창·관악' },
  { id: 'korean', label: '국악기' },
  { id: 'texture', label: '텍스처' },
];

export const WAVES = [
  { id: 'sine', label: '사인' },
  { id: 'triangle', label: '삼각' },
  { id: 'sawtooth', label: '톱니' },
  { id: 'square', label: '사각' },
  { id: 'warm', label: '따뜻한' },
  { id: 'choir', label: '합창' },
  { id: 'organ', label: '오르간' },
  { id: 'strings', label: '현악' },
  { id: 'brass', label: '금관' },
  { id: 'reed', label: '리드' },
  { id: 'vocal', label: '모음 아' },
  { id: 'glass', label: '유리' },
  { id: 'epiano', label: '틴 건반' },
  { id: 'custom', label: '직접 그림' },
];

export const CUSTOM_LEN = 128;
const gauss = (x, mu, sd) => Math.exp(-0.5 * ((x - mu) / sd) ** 2);
const sparse = (len, table) => {
  const h = new Array(len).fill(0);
  Object.entries(table).forEach(([k, v]) => { h[k - 1] = v; });
  return h;
};

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
  organ: sparse(16, { 1: 1, 2: 0.7, 3: 0.45, 4: 0.5, 5: 0.2, 8: 0.25 }),
  // 활로 켠 현: 톱니보다 고역이 조금 덜하고 4~6배음(몸통 공명) 근처가 솟음
  strings: Array.from({ length: 40 }, (_, i) => (1 / (i + 1) ** 1.1) * (1 + 0.6 * gauss(i + 1, 5, 2.5))),
  // 금관: 2~5배음이 기본음보다 세고 위로 갈수록 빠르게 줄어듦
  brass: Array.from({ length: 32 }, (_, i) => (i + 1) ** 1.2 * Math.exp(-(i + 1) / 2.6)),
  // 클라리넷 같은 리드: 홀수 배음이 주인공, 짝수는 높은 곳에서만 조금
  reed: Array.from({ length: 32 }, (_, i) => {
    const h = i + 1;
    return h % 2 ? 1 / h : (h > 9 ? 0.5 / h : 0.04 / h);
  }),
  // '아' 모음: 첫째·둘째·셋째 포먼트(3, 5~6, 12배음 근처)가 솟음
  vocal: Array.from({ length: 32 }, (_, i) => {
    const h = i + 1;
    return (1 / h ** 0.8) * (0.3 + gauss(h, 3.2, 1.2) + 0.7 * gauss(h, 5.5, 1.5) + 0.35 * gauss(h, 12, 2.5));
  }),
  // 유리: 띄엄띄엄 높은 배음 (맑고 반짝임)
  glass: sparse(16, { 1: 1, 2: 0.15, 4: 0.5, 7: 0.3, 11: 0.22, 16: 0.12 }),
  // 틴(쇠막대) 일렉피아노: 기본음 + 2·4배음, 살짝 높은 쇳소리
  epiano: sparse(14, { 1: 1, 2: 0.35, 3: 0.08, 4: 0.18, 6: 0.05, 7: 0.12, 14: 0.06 }),
};

/** 직접 그린 파형의 기본값: 톱니처럼 1/h. */
export const DEFAULT_CUSTOM = Array.from({ length: CUSTOM_LEN }, (_, i) => Math.round((1 / (i + 1)) * 1000) / 1000);

/** 파형의 배음 표 (직접 그림은 음색의 custom 표). 사인·삼각·톱니·사각도 배음으로 돌려준다. */
export function harmonicsOf(id, custom = DEFAULT_CUSTOM, len = CUSTOM_LEN) {
  if (id === 'custom') return Array.from({ length: len }, (_, i) => custom[i] ?? 0);
  if (HARMONICS[id]) return Array.from({ length: len }, (_, i) => HARMONICS[id][i] ?? 0);
  return Array.from({ length: len }, (_, i) => {
    const h = i + 1;
    if (id === 'sine') return h === 1 ? 1 : 0;
    if (id === 'sawtooth') return 1 / h;
    if (id === 'square') return h % 2 ? 1 / h : 0;
    if (id === 'triangle') return h % 2 ? 1 / (h * h) : 0;
    return 0;
  });
}

/** 파형 한 주기 (그림용). n 개 점, -1..1. */
export function waveCycle(id, n = 64, custom = DEFAULT_CUSTOM, normalize = true) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    if (id === 'sine') out[i] = Math.sin(2 * Math.PI * x);
    else if (id === 'triangle') out[i] = 1 - 4 * Math.abs(((x + 0.25) % 1) - 0.5);
    else if (id === 'sawtooth') out[i] = 2 * ((x + 0.5) % 1) - 1;
    else if (id === 'square') out[i] = x < 0.5 ? 1 : -1;
    else {
      const h = id === 'custom' ? custom : HARMONICS[id] || [1];
      out[i] = h.reduce((s, a, k) => s + a * Math.sin(2 * Math.PI * (k + 1) * x), 0);
    }
  }
  if (!normalize) return out;
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  return out.map((v) => v / peak);
}

/** 잔향 종류: 같은 길이라도 첫 반사·밀도·밝기가 달라 방의 성격이 바뀐다. */
export const REVERB_TYPES = [
  { id: 'room', label: '룸', hint: '작은 방. 첫 반사가 빽빽하고 가까움 (기타·드럼·건반)' },
  { id: 'hall', label: '홀', hint: '공연장. 고르고 부드러운 꼬리 (패드·현악)' },
  { id: 'church', label: '교회', hint: '돌로 된 큰 공간. 천천히 차오르고 어둡게 길게 (오르간·합창)' },
  { id: 'plate', label: '플레이트', hint: '철판 잔향. 반사 없이 바로 빽빽하고 밝음 (보컬·스네어)' },
  { id: 'spring', label: '스프링', hint: '용수철 잔향. 띠잉 하는 금속성 반복 (기타 앰프·빈티지 건반)' },
  { id: 'ambient', label: '앰비언트', hint: '천천히 부풀며 넓게 출렁임 (워십 패드·텍스처)' },
];
export const DELAY_MODES = [
  { id: 'mono', label: '가운데', hint: '같은 자리에서 되풀이' },
  { id: 'pingpong', label: '핑퐁', hint: '왼쪽·오른쪽을 번갈아 오감' },
  { id: 'tape', label: '테이프', hint: '테이프처럼 살짝 흔들리고 반복될수록 따뜻하게' },
];

const FM_RATIOS = [0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 7, 9, 14];
const DELAY_BEATS = [0.25, 0.5, 0.75, 1, 1.5];

const num = (label, unit, min, max, extra = {}) => ({ kind: 'num', label, unit, min, max, scale: 'lin', ...extra });
const log = (label, unit, min, max, extra = {}) => num(label, unit, min, max, { scale: 'log', ...extra });
const int = (label, unit, min, max) => num(label, unit, min, max, { step: 1 });
const choice = (label, values, labels) => ({ kind: 'enum', label, values, labels });
const list = (label, len, min, max) => ({ kind: 'list', label, len, min, max });

/** 맞춤 EQ(톤 매칭) 띠 가운데 주파수: 옥타브마다 하나, 그래픽 EQ 와 같은 자리. */
export const MATCH_BANDS = [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

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
  custom: list('직접 그린 배음', CUSTOM_LEN, 0, 1),
  click: num('어택 소리 (해머·숨)', 'pct', 0, 1),
  clickTone: num('어택 소리 밝기', 'pct', 0, 1),
  drift: num('아날로그 흔들림', 'pct', 0, 1),
  'filter.type': choice('필터 종류', ['lowpass', 'highpass', 'bandpass', 'notch'], ['저역 통과', '고역 통과', '대역 통과', '노치']),
  'filter.slope': choice('기울기', [12, 24], ['12 dB', '24 dB']),
  'filter.cutoff': log('차단 주파수', 'Hz', 40, 18000),
  'filter.q': log('레조넌스', 'q', 0.1, 18),
  'filter.env': num('엔벨로프 양', 'oct', -4, 4),
  'filter.keytrack': num('건반 따라가기', 'pct', 0, 1),
  ...envParams('filterEnv'),
  ...envParams('ampEnv'),
  'pitchEnv.amount': num('음정 엔벨로프', 'st', -24, 24),
  'pitchEnv.decay': log('음정 엔벨로프 시간', 's', 0.005, 4),
  'lfo.target': choice('흔드는 곳', ['pitch', 'filter', 'amp'], ['음정 (비브라토)', '필터 (와우)', '볼륨 (트레몰로)']),
  'lfo.shape': choice('LFO 모양', ['sine', 'triangle', 'square', 'sawtooth'], ['사인', '삼각', '사각 (게이트)', '톱니']),
  'lfo.sync': choice('BPM 에 맞춤', ['off', '1/4', '1/8', '1/8T', '1/16'], ['끔', '4분', '8분', '8분 셋잇단', '16분']),
  'lfo.rate': log('빠르기', 'Hz', 0.05, 30),
  'lfo.depth': num('깊이', 'pct', 0, 1),
  'lfo.delay': num('늦게 시작', 's', 0, 4),
  'fx.drive': num('드라이브', 'pct', 0, 1),
  'fx.chorus': num('코러스', 'pct', 0, 1),
  'fx.delay': num('딜레이', 'pct', 0, 1),
  'fx.delayBeats': choice('딜레이 간격', DELAY_BEATS, ['1/16', '1/8', '점8분', '1/4', '점4분']),
  'fx.feedback': num('딜레이 반복', 'pct', 0, 0.9),
  'fx.delayMode': choice('딜레이 방식', DELAY_MODES.map((m) => m.id), DELAY_MODES.map((m) => m.label)),
  'fx.delayTone': log('딜레이 밝기', 'Hz', 600, 12000),
  'fx.reverb': num('잔향', 'pct', 0, 1),
  'fx.reverbType': choice('잔향 종류', REVERB_TYPES.map((t) => t.id), REVERB_TYPES.map((t) => t.label)),
  'fx.size': log('잔향 길이', 's', 0.5, 8),
  'fx.predelay': num('프리딜레이', 's', 0, 0.25),
  'fx.damp': num('고역 감쇠 (벽 흡음)', 'pct', 0, 1),
  'fx.tone': num('잔향 밝기', 'pct', 0, 1),
  'fx.shimmer': num('쉬머 (옥타브 위 잔향)', 'pct', 0, 1),
  'fx.phaser': num('페이저', 'pct', 0, 1),
  'fx.phaserRate': log('페이저 빠르기', 'Hz', 0.05, 6),
  'fx.lofi': num('로파이 (비트 줄이기)', 'pct', 0, 1),
  'fx.comp': num('컴프레서', 'pct', 0, 1),
  'fx.width': num('스테레오 폭', 'pct', 0, 2),
  'eq.low': num('저음', 'dB', -12, 12),
  'eq.mid': num('중음', 'dB', -12, 12),
  'eq.midFreq': log('중음 위치', 'Hz', 200, 5000),
  'eq.high': num('고음', 'dB', -12, 12),
  'eq.match': list('맞춤 EQ', MATCH_BANDS.length, -15, 15),
  'vel.amp': num('세기 → 볼륨', 'pct', 0, 1),
  'vel.filter': num('세기 → 밝기', 'oct', 0, 3),
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
  custom: DEFAULT_CUSTOM,
  click: 0,
  clickTone: 0.5,
  drift: 0,
  pluck: { bright: 0.6, decay: 2.5, pick: 0.2, body: 0.5 },
  filter: { type: 'lowpass', slope: 12, cutoff: 8000, q: 0.7, env: 0, keytrack: 0.5 },
  filterEnv: { a: 0.01, d: 0.5, s: 0.5, r: 0.5 },
  ampEnv: { a: 0.005, d: 0.3, s: 0.8, r: 0.3 },
  pitchEnv: { amount: 0, decay: 0.08 },
  lfo: { target: 'pitch', rate: 5, depth: 0, delay: 0, shape: 'sine', sync: 'off' },
  fx: {
    drive: 0, chorus: 0, delay: 0, delayBeats: 0.75, feedback: 0.35, delayMode: 'mono', delayTone: 4200,
    reverb: 0.15, reverbType: 'hall', size: 2.2, predelay: 0.02, damp: 0.5, tone: 0.6, shimmer: 0,
    phaser: 0, phaserRate: 0.4, lofi: 0, comp: 0, width: 1,
  },
  eq: { low: 0, mid: 0, midFreq: 1000, high: 0, match: MATCH_BANDS.map(() => 0) },
  vel: { amp: 0.65, filter: 0.8 },
  glide: 0,
  mono: false,
  volume: 0.8,
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
  if (spec.kind === 'list') {
    if (!Array.isArray(v) || v.length > spec.len || !v.length) return [...fallback];
    // 짧으면 나머지는 0 (직접 그린 배음은 높은 배음 없이 적어 둘 수 있다)
    const full = Array.from({ length: spec.len }, (_, i) => (i < v.length ? v[i] : 0));
    return full.map((x, i) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(spec.max, Math.max(spec.min, x)) : fallback[i]));
  }
  if (spec.kind === 'bool') return typeof v === 'boolean' ? v : fallback;
  if (spec.kind === 'enum') return spec.values.includes(v) ? v : fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const c = Math.min(spec.max, Math.max(spec.min, v));
  return spec.step ? Math.round(c / spec.step) * spec.step : c;
}

/** 어떤 입력(프리셋 일부, 불러온 JSON, 1판 음색)이든 앱이 믿고 쓸 수 있는 완전한 음색으로. 없는 값은 담백한 기본값. */
export function normalizePatch(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  let out = structuredClone(BASE_PATCH);
  for (const [path, spec] of Object.entries(PARAMS)) {
    out = setPath(out, path, clampParam(spec, getPath(src, path), getPath(BASE_PATCH, path)));
  }
  out.name = typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 40) : BASE_PATCH.name;
  out.category = CATEGORIES.some((c) => c.id === src.category) ? src.category : BASE_PATCH.category;
  return out;
}

/** 이펙트를 모두 뺀 소리 (A/B 비교용): 드라이브·로파이·페이저·코러스·딜레이·잔향·쉬머·컴프·EQ·폭. */
export function dryPatch(p) {
  return {
    ...p,
    fx: { ...p.fx, drive: 0, lofi: 0, phaser: 0, chorus: 0, delay: 0, reverb: 0, shimmer: 0, comp: 0, width: 1 },
    eq: { ...p.eq, low: 0, mid: 0, high: 0, match: p.eq.match.map(() => 0) },
  };
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
  switch (spec.unit) {
    case 'Hz': return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} Hz`;
    case 's': return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case 'cent': return `${signed(v)} cent`;
    case 'pct': return `${Math.round(v * 100)}%`;
    case 'oct': return path.endsWith('.octave') ? signed(v) : `${signed(v, 1)} oct`;
    case 'st': return Number.isInteger(v) ? signed(v) : `${signed(v, 1)} st`;
    case 'voices': return v === 1 ? '1개' : `${v}개`;
    case 'q': return v.toFixed(v >= 10 ? 0 : 1);
    case 'dB': return `${signed(v, 1)} dB`;
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
    put('eq.high', base.eq.high + d * 6);
    put('clickTone', base.clickTone + d * 0.6);
  } else if (id === 'warm') {
    put('fx.drive', base.fx.drive + d * 0.5);
    put('osc.1.level', base.osc[1].level + d * 0.6);
    put('filter.cutoff', base.filter.cutoff * 2 ** (-d * 0.8));
    put('pluck.body', base.pluck.body + d);
    put('eq.low', base.eq.low + d * 6);
    put('drift', base.drift + d * 0.4);
  } else if (id === 'space') {
    put('fx.reverb', base.fx.reverb + d);
    put('fx.size', base.fx.size * 2 ** (d * 2));
    put('fx.delay', base.fx.delay + d * 0.5);
    put('ampEnv.r', base.ampEnv.r * 2 ** (d * 2));
    put('fx.width', base.fx.width + d * 0.8);
    put('fx.predelay', base.fx.predelay + d * 0.06);
  } else if (id === 'motion') {
    put('fx.chorus', base.fx.chorus + d);
    put('lfo.depth', base.lfo.depth + d * 0.8);
    put('lfo.rate', base.lfo.rate * 2 ** (d * 1.5));
    put('fx.phaser', base.fx.phaser + Math.max(0, d) * 0.6);
  }
  return p;
}

// ---------------------------------------------------------------------------
// 랜덤 만들기 / 변주
// ---------------------------------------------------------------------------

export const RANDOM_KINDS = ['pad', 'keys', 'strings', 'choir', 'bass', 'lead', 'bell', 'pluck', 'texture'];

export function randomPatch(kind = 'pad', seed = Date.now()) {
  const r = makeRng(seed);
  const p = structuredClone(BASE_PATCH);
  const sustainWaves = ['sawtooth', 'warm', 'choir', 'triangle', 'square', 'strings', 'vocal'];
  p.category = kind;
  p.osc[0] = { ...p.osc[0], wave: r.pick(sustainWaves), level: r.range(0.5, 0.7) };
  p.osc[1] = { ...p.osc[1], wave: r.pick(sustainWaves), octave: r.pick([-1, 0, 1]), level: r.range(0.1, 0.4) };
  p.drift = r.range(0, 0.35);
  p.fx.width = r.range(0.9, 1.4);
  if (kind === 'pad') {
    p.osc[0].unison = r.int(3, 7);
    p.osc[0].spread = r.range(8, 24);
    Object.assign(p.filter, { cutoff: r.logRange(600, 4000), q: r.range(0.3, 2), env: r.range(0.2, 1.5), slope: r.pick([12, 24]) });
    p.ampEnv = { a: r.range(0.4, 2.5), d: r.range(1, 3), s: r.range(0.7, 1), r: r.range(1.5, 4) };
    p.filterEnv = { a: r.range(0.5, 3), d: r.range(1, 4), s: r.range(0.3, 0.8), r: r.range(1, 3) };
    p.lfo = { target: r.pick(['filter', 'pitch', 'amp']), rate: r.logRange(0.05, 0.6), depth: r.range(0.1, 0.4), delay: 0 };
    if (p.lfo.target === 'pitch') p.lfo.depth *= 0.3;
    Object.assign(p.fx, { chorus: r.range(0.2, 0.7), reverb: r.range(0.35, 0.75), size: r.range(3, 7), delay: r.range(0, 0.3), width: r.range(1.2, 1.7), predelay: r.range(0.02, 0.08) });
    if (r.chance(0.45)) p.fx.shimmer = r.range(0.2, 0.6);
    if (r.chance(0.3)) p.fx.phaser = r.range(0.15, 0.45);
  } else if (kind === 'keys') {
    p.osc[0].wave = r.pick(['sine', 'triangle', 'warm', 'epiano', 'glass']);
    p.osc[1].level = r.range(0, 0.25);
    if (r.chance(0.6)) p.fm = { amount: r.range(0.2, 0.6), ratio: r.pick([1, 2, 3, 14]), decay: r.range(0.3, 1.5), sustain: r.range(0, 0.2) };
    p.filter.cutoff = r.logRange(2000, 9000);
    p.ampEnv = { a: r.range(0.001, 0.01), d: r.range(0.8, 3), s: r.range(0, 0.3), r: r.range(0.2, 0.8) };
    p.lfo = { target: 'amp', rate: r.range(3, 6), depth: r.range(0, 0.2), delay: 0 };
    Object.assign(p, { click: r.range(0.05, 0.35), clickTone: r.range(0.3, 0.8) });
    Object.assign(p.fx, { chorus: r.range(0, 0.4), reverb: r.range(0.15, 0.4), comp: r.range(0, 0.4) });
    if (r.chance(0.25)) p.fx.lofi = r.range(0.2, 0.5);
  } else if (kind === 'strings') {
    p.osc[0] = { ...p.osc[0], wave: r.pick(['strings', 'sawtooth', 'brass']), unison: r.int(2, 5), spread: r.range(6, 14) };
    p.osc[1] = { ...p.osc[1], wave: 'strings', octave: r.pick([-1, 0]), level: r.range(0.15, 0.35) };
    Object.assign(p.filter, { cutoff: r.logRange(1200, 4000), q: r.range(0.4, 1), env: r.range(0.3, 1.2), keytrack: 0.6 });
    p.ampEnv = { a: r.range(0.15, 0.8), d: 1, s: r.range(0.75, 0.95), r: r.range(0.5, 1.4) };
    p.filterEnv = { a: r.range(0.2, 0.9), d: 1, s: 0.7, r: 1 };
    p.lfo = { target: 'pitch', rate: r.range(4.6, 5.8), depth: r.range(0.06, 0.14), delay: r.range(0.3, 0.7) };
    Object.assign(p.fx, { chorus: r.range(0.1, 0.4), reverb: r.range(0.3, 0.55), size: r.range(2.5, 4.5), width: r.range(1.1, 1.5) });
  } else if (kind === 'choir') {
    p.osc[0] = { ...p.osc[0], wave: r.pick(['vocal', 'choir']), unison: r.int(3, 6), spread: r.range(8, 16) };
    p.osc[1] = { ...p.osc[1], wave: r.pick(['choir', 'sine']), octave: r.pick([-1, 1]), level: r.range(0.1, 0.25) };
    p.noise = r.range(0.03, 0.12);
    Object.assign(p.filter, { cutoff: r.logRange(1500, 4500), q: r.range(0.5, 1.5) });
    p.ampEnv = { a: r.range(0.3, 1.2), d: 1.5, s: 0.9, r: r.range(0.8, 2.5) };
    p.lfo = { target: 'pitch', rate: r.range(4.8, 5.6), depth: r.range(0.06, 0.12), delay: r.range(0.4, 0.9) };
    Object.assign(p.fx, { chorus: r.range(0.3, 0.6), reverb: r.range(0.45, 0.7), size: r.range(3, 6), width: r.range(1.2, 1.6) });
  } else if (kind === 'bass') {
    p.mono = true;
    p.glide = r.range(0, 0.08);
    p.drift = r.range(0, 0.15);
    p.osc[0] = { ...p.osc[0], octave: -1, wave: r.pick(['sawtooth', 'square', 'warm']) };
    p.osc[1] = { ...p.osc[1], octave: r.pick([-2, -1]), wave: r.pick(['sine', 'triangle']), level: r.range(0.3, 0.6) };
    Object.assign(p.filter, { cutoff: r.logRange(150, 900), q: r.range(1, 6), env: r.range(1, 3), slope: r.pick([12, 24, 24]) });
    p.filterEnv = { a: r.range(0.001, 0.01), d: r.range(0.15, 0.6), s: r.range(0, 0.4), r: r.range(0.1, 0.2) };
    p.ampEnv = { a: r.range(0.002, 0.01), d: 0.3, s: r.range(0.6, 0.9), r: r.range(0.08, 0.2) };
    Object.assign(p.fx, { reverb: r.range(0, 0.1), drive: r.range(0, 0.4), comp: r.range(0.2, 0.6), width: r.range(0.6, 1) });
  } else if (kind === 'lead') {
    p.mono = r.chance(0.7);
    p.glide = r.range(0.02, 0.12);
    p.osc[0].wave = r.pick(['sawtooth', 'square', 'reed', 'brass']);
    p.osc[1] = { ...p.osc[1], wave: 'sawtooth', octave: 0, detune: r.range(3, 12), level: r.range(0.2, 0.45) };
    Object.assign(p.filter, { cutoff: r.logRange(1200, 5000), q: r.range(1, 4), env: r.range(0.5, 2) });
    p.filterEnv = { a: 0.01, d: r.range(0.3, 1), s: r.range(0.3, 0.6), r: 0.3 };
    p.ampEnv = { a: r.range(0.01, 0.05), d: 0.3, s: 0.85, r: r.range(0.2, 0.5) };
    p.lfo = { target: 'pitch', rate: r.range(4.5, 6.5), depth: r.range(0.05, 0.15), delay: r.range(0.2, 0.6) };
    Object.assign(p.fx, { delay: r.range(0.2, 0.4), reverb: r.range(0.2, 0.4) });
  } else if (kind === 'bell') {
    p.osc[0] = { ...p.osc[0], wave: r.pick(['sine', 'sine', 'glass']) };
    p.osc[1].level = r.range(0, 0.15);
    p.fm = { amount: r.range(0.3, 0.7), ratio: r.pick([3.5, 5, 7, 9, 14]), decay: r.range(1, 4), sustain: r.range(0, 0.15) };
    p.ampEnv = { a: 0.001, d: r.range(2, 6), s: 0, r: r.range(2, 4) };
    p.click = r.range(0, 0.2);
    Object.assign(p.fx, { reverb: r.range(0.4, 0.7), size: r.range(3, 6), delay: r.range(0.1, 0.3), width: r.range(1.1, 1.6) });
    if (r.chance(0.4)) p.fx.shimmer = r.range(0.2, 0.5);
  } else if (kind === 'texture') {
    p.osc[0] = { ...p.osc[0], wave: r.pick(['glass', 'vocal', 'choir', 'warm']), unison: r.int(2, 6), spread: r.range(10, 40), level: r.range(0.3, 0.55) };
    p.osc[1] = { ...p.osc[1], wave: r.pick(['sine', 'glass', 'triangle']), octave: r.pick([1, 2]), level: r.range(0.05, 0.25) };
    p.noise = r.range(0.05, 0.4);
    Object.assign(p.filter, { type: r.pick(['lowpass', 'bandpass']), cutoff: r.logRange(500, 3500), q: r.range(1, 6), env: r.range(-1, 1.5) });
    p.ampEnv = { a: r.range(1, 5), d: 3, s: 0.9, r: r.range(2, 6) };
    p.filterEnv = { a: r.range(1, 5), d: r.range(2, 6), s: r.range(0.2, 0.8), r: 3 };
    p.lfo = { target: r.pick(['filter', 'amp']), rate: r.logRange(0.05, 0.4), depth: r.range(0.2, 0.6), delay: 0 };
    p.drift = r.range(0.2, 0.7);
    Object.assign(p.fx, { reverb: r.range(0.55, 0.85), size: r.range(5, 8), delay: r.range(0.1, 0.4), shimmer: r.range(0, 0.5), phaser: r.range(0, 0.4), lofi: r.chance(0.3) ? r.range(0.2, 0.5) : 0, width: r.range(1.4, 2) });
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
  const rooms = { pad: ['hall', 'ambient'], keys: ['room', 'plate', 'hall', 'spring'], strings: ['hall', 'church'], choir: ['church', 'hall'], bass: ['room'], lead: ['plate', 'hall'], bell: ['plate', 'ambient', 'hall'], pluck: ['room', 'plate'], texture: ['ambient', 'church'] };
  p.fx.reverbType = r.pick(rooms[kind] ?? ['hall']);
  if (p.fx.delay > 0.05) p.fx.delayMode = r.pick(['mono', 'pingpong', 'pingpong', 'tape']);
  const label = CATEGORIES.find((c) => c.id === kind)?.label ?? '음색';
  p.name = `랜덤 ${label} ${r.int(10, 99)}`;
  return normalizePatch(p);
}

const usesCustom = (p) => p.osc.some((o, i) => o.wave === 'custom' && (i === 0 || o.level > 0.001));

/** 지금 음색을 조금씩 흔든 새 음색. amount 0..1. */
export function mutatePatch(patch, amount = 0.3, seed = Date.now()) {
  const r = makeRng(seed);
  let p = structuredClone(patch);
  for (const [path, spec] of Object.entries(PARAMS)) {
    if (['source', 'volume', 'filter.type', 'mono'].includes(path)) continue;
    const v = getPath(p, path);
    let next = v;
    if (spec.kind === 'list') {
      // 직접 그린 배음만 살짝 흔든다 (맞춤 EQ 는 음원에 맞춘 값이라 그대로)
      if (path === 'custom' && usesCustom(p)) next = v.map((a, i) => (i && r.chance(0.5) ? a * 2 ** (r.range(-1, 1) * amount * 1.5) : a));
    } else if (spec.kind === 'enum') {
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

/**
 * 두 음색 섞기 (모프). t=0 이면 a, 1 이면 b. 숫자는 사이 값(로그 눈금은 곱셈으로), 고르는 값은 가까운 쪽.
 * 프리셋 둘 사이에서 끝없이 새 음색을 꺼낼 수 있다.
 */
export function blendPatches(a, b, t) {
  const x = Math.min(1, Math.max(0, t));
  if (x === 0 || x === 1) return normalizePatch(x === 0 ? a : b);
  let p = structuredClone(x < 0.5 ? a : b);
  for (const [path, spec] of Object.entries(PARAMS)) {
    const va = getPath(a, path);
    const vb = getPath(b, path);
    let v;
    if (spec.kind === 'list') v = va.map((q, i) => q + (vb[i] - q) * x);
    else if (spec.kind !== 'num') v = x < 0.5 ? va : vb;
    else if (spec.scale === 'log') v = va * (vb / va) ** x;
    else v = va + (vb - va) * x;
    p = setPath(p, path, clampParam(spec, v, va));
  }
  // 한쪽에서만 쓰는 오실레이터 2 는 세기로 서서히 들어오게 (파형이 갑자기 바뀌지 않도록)
  if (a.osc[1].wave !== b.osc[1].wave) {
    if (a.osc[1].level <= 0.001) p.osc[1].wave = b.osc[1].wave;
    if (b.osc[1].level <= 0.001) p.osc[1].wave = a.osc[1].wave;
  }
  p.name = `${a.name} × ${b.name}`.slice(0, 40);
  return normalizePatch(p);
}
