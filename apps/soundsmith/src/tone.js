// 톤(음색의 밝기 균형) 계산: 대역 6개, 톤 EQ 의 주파수 응답, 소리의 대역별 비율 재기,
// 레퍼런스에 얼마나 따라갈지 제안, 말 버튼('덜 먹먹하게')이 어느 대역을 왜 움직이는지.
// 브라우저 없이도 돌아가는 순수 함수만 둔다 (엔진·화면·테스트가 같은 식을 쓴다).

// 대역마다 EQ 필터 하나. 가운데 넷은 대역 양 끝 사이를 덮는 피킹(Q = 대역 폭에서), 양 끝은 선반.
export const TONE_BANDS = [
  { id: 'deep', label: '깊은 저음', lo: 40, hi: 120, type: 'lowshelf', f: 100, hint: '킥·베이스가 사는 곳. 많으면 붕붕거려요' },
  { id: 'bass', label: '저음', lo: 120, hi: 300, type: 'peaking', hint: '따뜻함과 두께. 많으면 답답해요' },
  { id: 'mud', label: '먹먹함', lo: 300, hi: 800, type: 'peaking', hint: '많으면 상자 안에서 나는 소리' },
  { id: 'body', label: '몸통', lo: 800, hi: 2500, type: 'peaking', hint: '앞으로 나오는 힘. 보컬과 겹쳐요' },
  { id: 'clarity', label: '명료함', lo: 2500, hi: 6000, type: 'peaking', hint: '또렷함. 많으면 귀가 따가워요' },
  { id: 'air', label: '공기', lo: 6000, hi: 16000, type: 'highshelf', f: 7000, hint: '반짝임과 숨결' },
].map((b) => {
  if (b.type !== 'peaking') return { ...b, q: Math.SQRT1_2 };
  const ratio = b.hi / b.lo;
  return { ...b, f: Math.round(Math.sqrt(b.lo * b.hi)), q: Math.sqrt(ratio) / (ratio - 1) };
});

export const TONE_IDS = TONE_BANDS.map((b) => b.id);
export const TONE_RANGE = 12; // 노브 한쪽 끝 (dB)
export const LOWCUT_OFF = 20; // 로우컷이 이 값이면 꺼짐

export const FLAT_TONE = { deep: 0, bass: 0, mud: 0, body: 0, clarity: 0, air: 0, lowcut: LOWCUT_OFF };

export const isFlat = (tone) => TONE_IDS.every((id) => Math.abs(tone[id]) < 0.05) && tone.lowcut <= LOWCUT_OFF + 0.5;

/** '40–120 Hz', '0.8–2.5 kHz' */
export const rangeText = (b) => (b.hi >= 1000 ? `${+(b.lo / 1000).toFixed(1)}–${+(b.hi / 1000).toFixed(1)} kHz` : `${b.lo}–${b.hi} Hz`);

/** 받침이 있으면 '은', 없으면 '는' */
export const topic = (word) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? '은' : '는';
};

// 1/3 옥타브 띠 (40 Hz ~ 16 kHz, ISO 가운데 주파수)
export const THIRDS = [40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
const SPAN = [40 * 2 ** (-1 / 6), 16000 * 2 ** (1 / 6)];
// 1/3 옥타브 띠마다 속한 대역 (가운데 주파수가 대역 안에 드는 곳 하나)
const THIRD_BAND = THIRDS.map((f) => Math.max(0, TONE_BANDS.findLastIndex((b) => f >= b.lo)));

// ---------------------------------------------------------------------------
// 바이쿼드 응답 (Web Audio BiquadFilterNode 와 같은 식, Audio EQ Cookbook)
// ---------------------------------------------------------------------------

function coeffs(type, f0, q, gainDb, sr) {
  const w0 = (2 * Math.PI * Math.min(f0, sr / 2 - 1)) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = 10 ** (gainDb / 40);
  if (type === 'peaking') {
    const al = sin / (2 * q);
    return [1 + al * A, -2 * cos, 1 - al * A, 1 + al / A, -2 * cos, 1 - al / A];
  }
  if (type === 'highpass') {
    // Web Audio 의 highpass Q 는 dB. 여기 q 는 선형 값으로 받는다.
    const al = sin / (2 * q);
    return [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + al, -2 * cos, 1 - al];
  }
  const al = (sin / 2) * Math.SQRT2; // 선반 기울기 S = 1
  const s = 2 * Math.sqrt(A) * al;
  if (type === 'lowshelf') {
    return [A * (A + 1 - (A - 1) * cos + s), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - s),
      A + 1 + (A - 1) * cos + s, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - s];
  }
  return [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s),
    A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
}

/** 필터 하나의 크기 응답 (dB), freqs 마다. */
export function biquadDb(type, f0, q, gainDb, freqs, sr = 44100) {
  const [b0, b1, b2, a0, a1, a2] = coeffs(type, f0, q, gainDb, sr);
  return freqs.map((f) => {
    const w = (2 * Math.PI * f) / sr;
    const c1 = Math.cos(w); const s1 = Math.sin(w);
    const c2 = Math.cos(2 * w); const s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2; const ni = -(b1 * s1 + b2 * s2);
    const dr = a0 + a1 * c1 + a2 * c2; const di = -(a1 * s1 + a2 * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  });
}

/** 엔진이 만드는 필터 목록 (로우컷 + 대역 6개). 로우컷이 꺼져 있으면 10 Hz 로 비켜 둔다. */
export function toneFilters(tone) {
  return [
    { type: 'highpass', f: tone.lowcut > LOWCUT_OFF + 0.5 ? tone.lowcut : 10, q: Math.SQRT1_2, gain: 0 },
    ...TONE_BANDS.map((b) => ({ type: b.type, f: b.f, q: b.q, gain: tone[b.id] })),
  ];
}

/** 톤 EQ 전체의 응답 (dB). */
export function toneResponse(tone, freqs, sr = 44100) {
  const out = new Array(freqs.length).fill(0);
  for (const f of toneFilters(tone)) {
    if (f.type !== 'highpass' && Math.abs(f.gain) < 1e-3) continue;
    if (f.type === 'highpass' && f.f <= 10) continue;
    biquadDb(f.type, f.f, f.q, f.gain, freqs, sr).forEach((d, i) => { out[i] += d; });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 소리 재기: 평균 파워 스펙트럼 → 1/3 옥타브·대역 6개 비율(전체 대비 dB)·밝기 중심
// ---------------------------------------------------------------------------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k; const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** 채널 여러 개(Float32Array)의 평균 파워 스펙트럼. 조용한 조각도 그대로 평균에 넣는다(에너지 가중). */
export function powerSpectrum(channels, sr, { size = 8192, start = 0, end } = {}) {
  const len = channels[0].length;
  const to = Math.min(len, end ?? len);
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const power = new Float64Array(size / 2);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let frames = 0;
  for (let at = start; at + size <= to || (frames === 0 && at < to); at += size) {
    for (let i = 0; i < size; i++) {
      let v = 0;
      for (const ch of channels) v += ch[at + i] ?? 0;
      re[i] = (v / channels.length) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  return { power, binHz: sr / size, frames };
}

const db = (p) => 10 * Math.log10(Math.max(p, 1e-20));

/**
 * 소리의 밝기 균형. 돌려주는 값: { third: dB[27], bands: dB[6], centroid: Hz, rms }
 * 모두 40 Hz~16 kHz 전체 에너지 대비라, 소리 크기와 상관없이 비교할 수 있다.
 */
export function analyzeTone(channels, sr, opts = {}) {
  const { power, binHz } = powerSpectrum(channels, sr, opts);
  const sumRange = (lo, hi) => {
    let s = 0;
    for (let k = Math.max(1, Math.ceil(lo / binHz)); k <= Math.min(power.length - 1, Math.floor(hi / binHz)); k++) s += power[k];
    return s;
  };
  const total = sumRange(SPAN[0], SPAN[1]) || 1e-20;
  let fw = 0;
  for (let k = Math.ceil(SPAN[0] / binHz); k <= Math.min(power.length - 1, Math.floor(SPAN[1] / binHz)); k++) fw += k * binHz * power[k];
  const start = opts.start ?? 0;
  const end = Math.min(channels[0].length, opts.end ?? channels[0].length);
  let sq = 0;
  for (const ch of channels) for (let i = start; i < end; i++) sq += ch[i] * ch[i];
  return {
    third: THIRDS.map((f) => +db(sumRange(f * 2 ** (-1 / 6), f * 2 ** (1 / 6)) / total).toFixed(1)),
    bands: TONE_BANDS.map((b) => +db(sumRange(b.lo, b.hi) / total).toFixed(1)),
    centroid: Math.round(fw / total),
    rms: Math.sqrt(sq / Math.max(1, (end - start) * channels.length)),
  };
}

/**
 * 톤 EQ 를 거친 뒤의 밝기 균형 (다시 재지 않고 계산). 1/3 옥타브마다 응답을 더한 뒤 전체 대비로 다시 맞춘다.
 * third·bands: 전체 대비 (레퍼런스와 비교하는 값), abs: 톤 없을 때의 전체 대비 (노브를 돌린 만큼 그대로 움직이는 그림용),
 * shift: 전체 크기 변화 dB, gain: 소리 전체가 몇 배 세지는지 (같은 크기로 비교할 때 나눠 줄 값)
 */
export function withTone(measure, tone, sr = 44100) {
  const resp = toneResponse(tone, THIRDS, sr);
  const p = measure.third.map((d, i) => 10 ** ((d + resp[i]) / 10));
  const before = measure.third.reduce((s, d) => s + 10 ** (d / 10), 0);
  const total = p.reduce((s, v) => s + v, 0) || 1e-20;
  const third = p.map((v) => +db(v / total).toFixed(1));
  const sumBands = (pw) => TONE_BANDS.map((_, j) => pw.reduce((s, v, i) => s + (THIRD_BAND[i] === j ? v : 0), 0));
  const bands = sumBands(p).map((s) => db(s / total));
  let fw = 0;
  THIRDS.forEach((f, i) => { fw += f * p[i]; });
  // 대역 경계가 1/3 옥타브와 딱 맞지 않아, 잰 값과 계산한 값의 차이만큼 보정한다
  const flatBands = sumBands(measure.third.map((d) => 10 ** (d / 10))).map((s) => db(s / before));
  const fwFlat = THIRDS.reduce((s, f, i) => s + f * 10 ** (measure.third[i] / 10), 0) / before;
  return {
    third,
    abs: measure.third.map((d, i) => +(d + resp[i]).toFixed(1)),
    shift: db(total / (before || 1e-20)),
    bands: bands.map((v, i) => +(v + measure.bands[i] - flatBands[i]).toFixed(1)),
    centroid: Math.round(((fw / total) * measure.centroid) / (fwFlat || 1)),
    gain: Math.sqrt(total / (before || 1e-20)),
  };
}

// ---------------------------------------------------------------------------
// 레퍼런스에 맞추기: 차이 × 따라갈 정도, 한 번에 대역마다 최대 ±6 dB
// ---------------------------------------------------------------------------

export const MATCH_CAP = 6;

/**
 * ref, now: 대역 6개 dB. amount 0..1. 돌려주는 값: [{ id, diff, move, capped }]
 * move 는 지금 톤 노브에 더할 dB (0.5 dB 단위, 0.5 미만이면 그대로).
 */
export function matchMoves(ref, now, amount = 0.4, cap = MATCH_CAP) {
  return TONE_BANDS.map((b, i) => {
    const diff = +(ref[i] - now[i]).toFixed(1);
    const raw = diff * amount;
    const capped = Math.abs(raw) > cap;
    const c = Math.max(-cap, Math.min(cap, raw));
    const move = Math.abs(c) < 0.5 ? 0 : Math.round(c * 10) / 10;
    return { id: b.id, diff, move, capped };
  });
}

/** 지금 톤에 움직임을 더한 새 톤 (노브 범위 안으로). */
export function addMoves(tone, moves) {
  const out = { ...tone };
  for (const [id, d] of Object.entries(moves)) {
    if (!TONE_IDS.includes(id)) continue;
    out[id] = Math.round(Math.max(-TONE_RANGE, Math.min(TONE_RANGE, out[id] + d)) * 10) / 10;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 말로 맞추기: 들리는 대로 고르면 대역을 움직인다. 레퍼런스가 있으면 차이가 있는 대역만,
// 그 차이의 절반쯤 (한 번에 1~4.5 dB) 움직이고 왜 그런지 숫자로 설명한다.
// ---------------------------------------------------------------------------

export const TONE_WORDS = [
  { id: 'warmer', label: '더 따뜻하게', moves: { bass: 2, mud: 1, clarity: -1 }, why: '따뜻함은 저음(120–300 Hz)의 두께에서 와요.' },
  { id: 'clearer', label: '더 맑게', moves: { mud: -2, clarity: 2 }, why: '먹먹함을 덜고 명료함(2.5–6 kHz)을 살리면 맑아져요.' },
  { id: 'less-muddy', label: '덜 먹먹하게', moves: { bass: -3, mud: -3 }, pick: 'worst', why: '먹먹함은 보통 300–800 Hz 가 많을 때 들려요. 그 아래 120–300 Hz 가 많아도 답답해요.' },
  { id: 'less-harsh', label: '덜 날카롭게', moves: { clarity: -3, air: -1 }, why: '귀가 따가운 소리는 보통 2.5–6 kHz 에서 나요.' },
  { id: 'sparkle', label: '더 반짝이게', moves: { air: 3 }, why: '반짝임과 숨결은 6 kHz 위에 있어요.' },
  { id: 'closer', label: '더 가깝게', moves: { body: 2, clarity: 1 }, fx: { reverb: -0.08 }, why: '몸통(0.8–2.5 kHz)이 살고 잔향이 줄면 앞에서 들려요.' },
  { id: 'wider', label: '더 넓게', moves: {}, fx: { chorus: 0.15 }, why: '코러스로 왼쪽·오른쪽 소리를 조금씩 다르게 해요.' },
  { id: 'softer', label: '더 부드럽게', moves: { clarity: -2, air: -2, body: -1 }, why: '높은 쪽을 고루 내리면 부드러워져요.' },
  // 밴드 안에서: 다른 악기 자리를 비워 준다
  { id: 'room-bass', label: '베이스 자리 비우기', group: 'band', moves: { deep: -2 }, lowcut: 120, why: '베이스·킥은 40–120 Hz 에 살아요. 패드가 거기서 빠지면 저음이 단단해져요.' },
  { id: 'room-vocal', label: '보컬 자리 비우기', group: 'band', moves: { mud: -1.5, body: -3 }, why: '보컬의 몸통은 300 Hz–2.5 kHz 에 있어요. 패드가 거기서 조금 물러나면 가사가 또렷해요.' },
  { id: 'behind', label: '뒤로 물러나기', group: 'band', moves: { body: -2, clarity: -1.5 }, fx: { reverb: 0.08 }, why: '몸통·명료함을 내리고 잔향을 늘리면 뒤로 물러나 들려요.' },
];

export const ROOMS = [
  { id: 'small', label: '작은 예배실', reverb: 0.25, size: 1.6 },
  { id: 'hall', label: '본당', reverb: 0.55, size: 4.5 },
  { id: 'outdoor', label: '야외', reverb: 0.12, size: 1 },
];

const fmtDb = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)} dB`;
const band = (id) => TONE_BANDS.find((b) => b.id === id);
const half = (v) => Math.round(v * 2) / 2;

/**
 * 말 하나를 눌렀을 때 움직일 값과 이유.
 * now: 지금(톤 거친 뒤) 대역 6개 dB 또는 null, ref: 레퍼런스 대역 6개 또는 null.
 * 돌려주는 값: { moves: { bandId: dB }, reason: [{ text, strong }], summary }
 */
export function wordMoves(word, { now = null, ref = null } = {}) {
  const parts = [];
  const say = (text, strong = false) => parts.push({ text, strong });
  const moves = {};
  const entries = Object.entries(word.moves);
  if (now && ref && entries.length) {
    // 레퍼런스 쪽으로 가는 대역만, 차이의 절반쯤
    const gaps = entries.map(([id, d]) => {
      const i = TONE_IDS.indexOf(id);
      return { id, d, i, gap: Math.sign(d) * (ref[i] - now[i]) };
    });
    let toward = gaps.filter((g) => g.gap >= 1);
    if (word.pick === 'worst' && toward.length > 1) toward = [toward.reduce((a, b) => (b.gap > a.gap ? b : a))];
    if (word.why) say(`${word.why} `);
    if (toward.length) {
      for (const g of toward) moves[g.id] = Math.sign(g.d) * Math.min(4.5, Math.max(1, half(g.gap / 2)));
      for (const g of gaps) {
        const b = band(g.id);
        say(`${b.label}(${rangeText(b)})${topic(b.label)} 지금 `);
        say(fmtDb(now[g.i]), true);
        say(`, 레퍼런스는 ${fmtDb(ref[g.i])}`);
        if (moves[g.id]) {
          say(' — ');
          say(`${Math.abs(ref[g.i] - now[g.i]).toFixed(1)} dB ${g.d < 0 ? '많아요' : '적어요'}`, true);
          say(`. 그래서 ${fmtDb(moves[g.id])}. `);
        } else say(' — 이미 레퍼런스 쪽이라 그대로 둬요. ');
      }
    } else {
      Object.assign(moves, word.moves);
      say('레퍼런스와는 이미 비슷해요. 귀가 원하는 대로 기본만큼 움직였어요.');
    }
  } else {
    Object.assign(moves, word.moves);
    if (word.why) say(`${word.why} `);
    if (entries.length && !ref) say('레퍼런스를 두면 실제로 차이 나는 대역만 골라 움직여요. ');
  }
  if (word.lowcut) say(`로우컷 ${word.lowcut} Hz. `);
  if (word.fx?.reverb) say(word.fx.reverb > 0 ? '잔향을 조금 늘렸어요. ' : '잔향을 조금 줄였어요. ');
  if (word.fx?.chorus) say('코러스를 늘려 좌우로 퍼지게 했어요. ');
  const short = Object.entries(moves).filter(([, d]) => d).map(([id, d]) => `${band(id).label} ${fmtDb(d).replace('.0 dB', ' dB')}`);
  if (word.lowcut) short.push(`로우컷 ${word.lowcut} Hz`);
  if (word.fx?.reverb) short.push(word.fx.reverb > 0 ? '잔향 +' : '잔향 −');
  if (word.fx?.chorus) short.push('코러스 +');
  return { moves, reason: parts, summary: short.join(' · ') || '그대로' };
}
