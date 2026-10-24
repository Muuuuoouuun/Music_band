// 튜닝: 기준음(A4), 조옮김, 미세 조정, 음률, 음마다 직접 cent, 옥타브 늘이기, Scala(.scl) 주고받기.
// 모든 악기(신스·줄·샘플·루퍼 트랙)가 freq(midi) 하나로 음높이를 얻는다.

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const mod12 = (n) => ((n % 12) + 12) % 12;

export function noteName(midi) {
  const m = Math.round(midi);
  return `${NOTE_NAMES[mod12(m)]}${Math.floor(m / 12) - 1}`;
}

// 12평균율에서 벗어나는 양 (cent), C 를 기준 조로 놓은 표
export const TEMPERAMENTS = {
  equal: { label: '12평균율', note: '현대 표준. 어느 조든 똑같이 조금씩 어긋나서 전조가 자유로움',
    cents: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  just: { label: '순정률', note: '기준 조의 장3화음이 맥놀이 없이 맑음. 먼 조로 가면 크게 틀어짐',
    cents: [0, 11.73, 3.91, 15.64, -13.69, -1.96, -9.78, 1.96, 13.69, -15.64, -3.91, -11.73] },
  pythagorean: { label: '피타고라스', note: '완전5도가 모두 순수. 장3도는 밝고 날카로움',
    cents: [0, 13.69, 3.91, -5.87, 7.82, -1.96, 11.73, 1.96, 15.64, 5.87, -3.91, 9.78] },
  meantone: { label: '1/4 쉼표 가온음률', note: '르네상스·초기 바로크 오르간. 장3도가 순수하고 늑대 5도가 하나',
    cents: [0, -23.95, -6.84, 10.26, -13.69, 3.42, -20.53, -3.42, -27.37, -10.26, 6.84, -17.11] },
  werckmeister3: { label: '베르크마이스터 III', note: '바로크 건반. 모든 조를 쓸 수 있고 조마다 색이 다름',
    cents: [0, -9.78, -7.82, -5.87, -9.78, -1.96, -11.73, -3.91, -7.82, -11.73, -3.91, -7.82] },
  vallotti: { label: '발로티', note: '18세기 이탈리아. 평균율에 가깝지만 가까운 조가 더 맑음',
    cents: [5.87, 0, 1.96, 3.91, -1.96, 7.82, -1.96, 3.91, 1.96, 0, 5.87, -3.91] },
  custom: { label: '직접 조정', note: '음마다 cent 를 손으로 정함 (Scala 파일도 여기로 들어옴)', cents: null },
};

export const A4_PRESETS = [
  { hz: 415, label: '바로크' },
  { hz: 432, label: '432' },
  { hz: 440, label: '표준' },
  { hz: 442, label: '오케스트라' },
  { hz: 443, label: '유럽 오케스트라' },
];

export const DEFAULT_TUNING = { a4: 440, transpose: 0, fine: 0, temperament: 'equal', root: 0, stretch: 0, custom: null };

const clamp = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

export function normalizeTuning(t = {}) {
  const src = t && typeof t === 'object' ? t : {};
  const custom = Array.isArray(src.custom) && src.custom.length === 12 && src.custom.every(Number.isFinite)
    ? src.custom.map((c) => clamp(c, -100, 100, 0)) : null;
  const temperament = Object.hasOwn(TEMPERAMENTS, src.temperament) ? src.temperament : 'equal';
  return {
    a4: clamp(src.a4, 400, 480, 440),
    transpose: Math.round(clamp(src.transpose, -12, 12, 0)),
    fine: clamp(src.fine, -50, 50, 0),
    temperament: temperament === 'custom' && !custom ? 'equal' : temperament,
    root: Math.round(clamp(src.root, 0, 11, 0)),
    stretch: clamp(src.stretch, 0, 3, 0),
    custom,
  };
}

/** 12개 음이름(C..B)마다 평균율에서 벗어나는 cent. 음률표는 기준 조로 돌리고 A 가 기준음에 맞게 옮긴다. */
export function offsets(t) {
  if (t.temperament === 'custom' && t.custom) return t.custom.slice();
  const table = TEMPERAMENTS[t.temperament]?.cents ?? TEMPERAMENTS.equal.cents;
  const rot = Array.from({ length: 12 }, (_, pc) => table[mod12(pc - t.root)]);
  const a = rot[9];
  return rot.map((c) => Math.round((c - a) * 100) / 100);
}

/** freq(midi) 와 그 계산에 쓴 값들. 누른 건반이 아니라 실제로 나는 음(조옮김 후)에 음률을 적용한다. */
export function makeTuner(input) {
  const t = normalizeTuning(input);
  const off = offsets(t);
  const centsAt = (midi) => {
    const sounding = midi + t.transpose;
    return off[mod12(Math.round(sounding))] + t.fine + (t.stretch * (sounding - 69)) / 12;
  };
  const freq = (midi) => t.a4 * 2 ** ((midi + t.transpose - 69) / 12 + centsAt(midi) / 1200);
  return { tuning: t, offsets: off, centsAt, freq };
}

/**
 * 들린 소리(hz)가 지금 튜닝의 가장 가까운 음에서 몇 cent 벗어났나 (음률·미세 조정·옥타브 늘이기 포함, 조옮김은 소리 높이라 무관).
 * 반환: { note, target(Hz), cents }
 */
export function pitchOffset(input, hz) {
  if (!(hz > 0)) return null;
  const t = normalizeTuning(input);
  const off = offsets(t);
  const note = Math.round(69 + 12 * Math.log2(hz / t.a4));
  const target = t.a4 * 2 ** ((note - 69) / 12 + (off[mod12(note)] + t.fine + (t.stretch * (note - 69)) / 12) / 1200);
  return { note, target, cents: 1200 * Math.log2(hz / target) };
}

/**
 * 다른 악기(교회 피아노·오르간 등)에 맞추기: 그 악기 소리 hz 가 지금 튜닝에서 딱 맞게 들리는 기준음.
 * 화면 범위(415~466 Hz) 밖이면 clamped. 반환: { a4, cents, note, clamped }
 */
export function matchA4(input, hz) {
  const t = normalizeTuning(input);
  const o = pitchOffset(t, hz);
  if (!o) return null;
  const want = Math.round(t.a4 * 2 ** (o.cents / 1200) * 10) / 10;
  const a4 = Math.min(466, Math.max(415, want));
  return { a4, cents: o.cents, note: o.note, clamped: a4 !== want };
}

/** 주파수 -> 가장 가까운 음과 그 음에서 벗어난 cent (기준음 a4, 평균율 기준; 튜너 화면용). */
export function nearestNote(hz, a4 = 440) {
  if (!(hz > 0)) return null;
  const midi = 69 + 12 * Math.log2(hz / a4);
  const note = Math.round(midi);
  return { midi, note, name: noteName(note), cents: (midi - note) * 100 };
}

// ---------------------------------------------------------------------------
// Scala (.scl): 마이크로톤 음계 표준 텍스트 형식. 12음 + 2/1 옥타브만 받는다.
// ---------------------------------------------------------------------------

function scalaValue(token) {
  if (token.includes('.')) return Number(token);
  const [n, d = '1'] = token.split('/');
  const r = Number(n) / Number(d);
  return r > 0 ? 1200 * Math.log2(r) : NaN;
}

/** .scl 텍스트 -> { name, degrees: 기준음에서 각 계단까지 cent (0 포함 12개) } */
export function parseScala(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => !l.trimStart().startsWith('!'));
  if (lines.length < 2) throw new Error('Scala 파일 형식이 아니에요. 설명 줄과 음 개수 줄이 필요해요.');
  const name = lines[0].trim() || '이름 없는 음계';
  const count = Number.parseInt(lines[1].trim(), 10);
  if (count !== 12) throw new Error(`12음 음계만 건반에 맞출 수 있어요 (이 파일은 ${Number.isFinite(count) ? count : '?'}음).`);
  const values = lines.slice(2).map((l) => l.trim()).filter(Boolean).slice(0, count).map((l) => scalaValue(l.split(/\s+/)[0]));
  if (values.length !== count || values.some((v) => !Number.isFinite(v))) throw new Error('음높이 줄을 읽지 못했어요. cent(소수점) 또는 비율(3/2)이어야 해요.');
  if (Math.abs(values[11] - 1200) > 0.5) throw new Error('마지막 음이 옥타브(2/1)인 음계만 지원해요.');
  return { name, degrees: [0, ...values.slice(0, 11)] };
}

/** 계단 cent -> 음이름별 평균율 차이 (기준 조 root, A 를 기준음에 맞춤). custom 에 그대로 넣는다. */
export function degreesToCustom(degrees, root) {
  const dev = degrees.map((c, k) => c - 100 * k);
  const rot = Array.from({ length: 12 }, (_, pc) => dev[mod12(pc - root)]);
  const a = rot[9];
  return rot.map((c) => Math.round((c - a) * 100) / 100);
}

export function exportScala(input, name = '음색 공방 튜닝') {
  const t = normalizeTuning(input);
  const off = offsets(t);
  const lines = ['! soundsmith.scl', '!', `${name} (${TEMPERAMENTS[t.temperament].label}, 기준 ${NOTE_NAMES[t.root]})`, ' 12', '!'];
  for (let k = 1; k < 12; k++) lines.push(` ${(100 * k + off[mod12(t.root + k)] - off[t.root]).toFixed(5)}`);
  lines.push(' 2/1');
  return `${lines.join('\n')}\n`;
}
