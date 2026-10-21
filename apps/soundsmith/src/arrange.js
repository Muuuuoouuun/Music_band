// 반주 만들기: 코드 진행 글자 → 예배 건반식 열린 보이싱 → 루퍼 트랙에 넣을 음표.
// '| C | G/B | Am7 | Fadd9 |' 처럼 마디를 | 로 나누고, 한 마디에 코드 두 개면 띄어 쓴다.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 코드 이름 뒤쪽 → 근음 위 음정(반음). 긴 이름부터 맞춘다.
const QUALITIES = [
  ['maj9', [0, 4, 7, 11, 14]], ['maj7', [0, 4, 7, 11]], ['m7b5', [0, 3, 6, 10]], ['madd9', [0, 3, 7, 14]],
  ['add9', [0, 4, 7, 14]], ['add2', [0, 2, 4, 7]], ['2', [0, 2, 4, 7]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]], ['sus', [0, 5, 7]],
  ['dim7', [0, 3, 6, 9]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['m9', [0, 3, 7, 10, 14]], ['m7', [0, 3, 7, 10]],
  ['m6', [0, 3, 7, 9]], ['mM7', [0, 3, 7, 11]], ['13', [0, 4, 7, 10, 21]], ['9', [0, 4, 7, 10, 14]], ['7sus4', [0, 5, 7, 10]],
  ['7', [0, 4, 7, 10]], ['6', [0, 4, 7, 9]], ['5', [0, 7]], ['m', [0, 3, 7]], ['', [0, 4, 7]],
];

/** 'G/B' → { name, root: 7, bass: 11, tones: [0, 4, 7] } 못 읽으면 null */
export function parseChord(text) {
  const m = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G])([#b♯♭]?))?$/.exec(text.trim());
  if (!m) return null;
  const acc = (a) => (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0);
  const root = (PC[m[1]] + acc(m[2]) + 12) % 12;
  const rest = m[3].replace('M7', 'maj7').replace('min', 'm').replace('-', 'm');
  const q = QUALITIES.find(([suffix]) => rest === suffix);
  if (!q) return null;
  const bass = m[4] ? (PC[m[4]] + acc(m[5]) + 12) % 12 : root;
  return { name: text.trim(), root, bass, tones: q[1] };
}

/** '| C | G/B | Am7 Fadd9 |' → [[chord], [chord], [chord, chord]] 와 읽지 못한 글자들 */
export function parseChart(text) {
  const bars = [];
  const bad = [];
  for (const cell of text.split('|').map((c) => c.trim()).filter(Boolean)) {
    const chords = [];
    for (const word of cell.split(/\s+/)) {
      // % = 앞 코드 그대로 (마디 첫머리에 쓰면 앞 마디 전체)
      if (word === '%' && chords.length) chords.push(chords.at(-1));
      else if (word === '%' && bars.length) chords.push(...bars.at(-1));
      else {
        const c = parseChord(word);
        if (c) chords.push(c);
        else bad.push(word);
      }
    }
    if (chords.length) bars.push(chords);
  }
  return { bars, bad };
}

export const STYLES = [
  { id: 'pad', label: '지속 패드', hint: '마디마다 길게 깔아요' },
  { id: 'pulse', label: '8분 펄스', hint: '8분음표로 같은 화음을 밀어요 (모던 워십)' },
  { id: 'arp', label: '아르페지오', hint: '화음을 한 음씩 위로 흘려요' },
  { id: 'organ', label: '오르간 콤핑', hint: '2·4박에 짧게 치고 베이스는 길게' },
];

const pcOf = (m) => ((m % 12) + 12) % 12;

/**
 * 예배 건반식 열린 보이싱: 왼손 = 베이스(옥타브), 오른손 = 근음·5도·9도·3도를 넓게 (wide) 또는 3화음 가깝게.
 * prev 가 있으면 오른손을 가장 덜 움직이는 자리로 (목소리 이끌기).
 */
export function voiceChord(chord, { wide = false, prev = null, low = 52, high = 79, variant = 0 } = {}) {
  // 베이스는 E2–D#3 안에서 (너무 낮으면 탁해서 C·C#·D·D# 는 한 옥타브 위)
  const bassNote = 36 + chord.bass + (chord.bass < 4 ? 12 : 0);
  let colors = chord.tones.map((t) => t % 12);
  // 좁게: 9·13 처럼 한 옥타브 위에 적힌 음도 근음 위로 차례로 놓아 가깝게 쌓는다 (Cadd9 → C D E G)
  if (!wide) colors = [...new Set(colors)].sort((a, b) => a - b);
  if (wide && colors.length === 3 && colors.includes(4) && colors.includes(7) && !colors.includes(2)) colors = [0, 7, 2, 4]; // 장3화음은 add9 로 넓게
  if (wide && colors.length === 3 && colors.includes(3) && colors.includes(7)) colors = [0, 7, 10, 3]; // 단3화음은 m7 색
  const pcs = [...new Set(colors.map((t) => (chord.root + t) % 12))];
  // 오른손 후보: 위 음역 안에서 pcs 를 차례로 쌓는 모든 시작 자리
  const candidates = [];
  for (let start = low; start < low + 12; start++) {
    if (!pcs.includes(pcOf(start))) continue;
    const notes = [start];
    const order = pcs.slice(pcs.indexOf(pcOf(start))).concat(pcs.slice(0, pcs.indexOf(pcOf(start))));
    for (const pc of order.slice(1)) {
      let n = notes.at(-1) + 1;
      while (pcOf(n) !== pc) n++;
      if (wide && n - notes.at(-1) < 2) n += 12; // 넓게: 반음으로 붙은 음만 한 옥타브 위로 (9도·3도 온음 겹침은 살린다)
      notes.push(n);
    }
    if (notes.at(-1) <= high + (wide ? 7 : 0)) candidates.push(notes);
  }
  const center = (ns) => ns.reduce((a, b) => a + b, 0) / ns.length;
  const target = prev ? center(prev) : wide ? 66 : 64;
  candidates.sort((a, b) => Math.abs(center(a) - target) - Math.abs(center(b) - target));
  // '다른 보이싱으로 다시': 가까운 순서로 다음 자리
  const right = candidates[variant % Math.max(1, candidates.length)] ?? pcs.map((pc) => 60 + pc);
  // 넓게: 베이스를 옥타브로 (오른손과 같은 음이면 겹치지 않게 뺀다)
  const left = (wide ? [bassNote, bassNote + 12] : [bassNote]).filter((m) => !right.includes(m));
  return { left, right };
}

/**
 * 진행 + 스타일 → 루퍼 음표 [{ midi, velocity, t, dur, iter: -1, pass: 1, part: 'left'|'right' }] (t, dur 는 박).
 * widths: 마디마다 'narrow' | 'wide', styles: 마디마다 스타일 (없으면 style), variant: 다른 보이싱 번호,
 * eighth: 8분음표 길이(박) — 4/4·3/4 는 0.5, 6/8 처럼 8분음표가 한 박이면 1. 코드 자리에 { rest: true } 면 그 자리는 쉰다.
 * 돌려주는 배열에 voicings([{ bar, chord, left, right }]) 도 붙여 둔다 (미리 보기·이유 설명용).
 */
export function arrange(bars, { style = 'pad', beatsPerBar = 4, wide = false, widths = null, styles = null, variant = 0, eighth = 0.5 } = {}) {
  const notes = [];
  const voicings = [];
  let prev = null;
  let part = 'right';
  const add = (midi, t, dur, velocity) => notes.push({ midi, velocity, t, dur, iter: -1, pass: 1, part });
  bars.forEach((chords, b) => {
    const span = beatsPerBar / chords.length;
    const st = styles?.[b] ?? style;
    chords.forEach((chord, k) => {
      if (!chord || chord.rest) return;
      const t0 = b * beatsPerBar + k * span;
      const isWide = widths ? widths[b] === 'wide' : wide;
      const v = voiceChord(chord, { wide: isWide, prev, variant });
      prev = v.right;
      voicings.push({ bar: b, chord, ...v });
      const style = st; // eslint-disable-line no-shadow
      const left = (fn) => { part = 'left'; fn(); part = 'right'; };
      if (style === 'pad') {
        left(() => { for (const m of v.left) add(m, t0, span - 0.05, 0.62); });
        for (const m of v.right) add(m, t0, span - 0.05, 0.58);
      } else if (style === 'pulse') {
        left(() => { for (const m of v.left) add(m, t0, span - 0.05, 0.6); });
        for (let e = 0; e < Math.round(span / eighth); e++) for (const m of v.right) add(m, t0 + e * eighth, eighth * 0.84, e % 2 ? 0.45 : 0.62);
      } else if (style === 'arp') {
        left(() => add(v.left[0], t0, span - 0.05, 0.6));
        const up = [...v.right, v.right[0] + 12];
        for (let e = 0; e < Math.round(span / eighth); e++) add(up[e % up.length], t0 + e * eighth, eighth * 0.96, 0.52 + (e % up.length === 0 ? 0.1 : 0));
      } else {
        left(() => { for (const m of v.left) add(m, t0, span - 0.05, 0.6); });
        // 센박을 비우고 여린박에 짧게: 4/4 는 2·4박, 3/4 는 2·3박, 6/8 은 셋씩 묶어 첫 박 뒤.
        // 이 코드가 차지하는 구간 안의 온박만 본다 (한 마디에 코드 둘·셋이어도)
        const group = beatsPerBar % 3 === 0 ? 3 : 2;
        for (let beat = Math.ceil(k * span - 1e-9); beat < (k + 1) * span - 1e-9; beat++) {
          if (beat % group !== 0) for (const m of v.right) add(m, b * beatsPerBar + beat, 0.35, 0.62);
        }
      }
    });
  });
  notes.voicings = voicings;
  return notes;
}

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// 조표에 플랫이 붙는 장조 (F·Bb·Eb·Ab·Db·Gb) 에서는 플랫으로 적는다
const FLAT_KEYS = [5, 10, 3, 8, 1, 6];
export const pcName = (pc, key = 0) => (FLAT_KEYS.includes(((key % 12) + 12) % 12) ? NAMES_FLAT : NAMES_SHARP)[((pc % 12) + 12) % 12];
export const noteText = (m, key = 0) => `${pcName(m, key)}${Math.floor(m / 12) - 1}`;

/** 코드 이름을 반음 semis 만큼 옮긴다 ('G/B' +2 → 'A/C#'). 새 조(key)에 맞춰 샵·플랫. */
export function transposeName(name, semis, key = semis) {
  const m = /^([A-G][#b♯♭]?)(.*?)(?:\/([A-G][#b♯♭]?))?$/.exec(name.trim());
  if (!m) return name;
  const pcOfName = (n) => (PC[n[0]] + (n[1] === '#' || n[1] === '♯' ? 1 : n[1] === 'b' || n[1] === '♭' ? -1 : 0) + 12) % 12;
  const root = pcName(pcOfName(m[1]) + semis, key);
  return m[3] ? `${root}${m[2]}/${pcName(pcOfName(m[3]) + semis, key)}` : `${root}${m[2]}`;
}

/** 보이싱을 왜 이렇게 했는지 한 줄 (미리 보기 아래 '보이싱 이유') */
export function voicingReason(v, key = 0) {
  const notes = [...v.left, ...v.right].sort((a, b) => a - b).map((m) => noteText(m, key)).join(' · ');
  const pcs = v.right.map((m) => (((m - v.chord.root) % 12) + 12) % 12);
  let why = '앞 코드와 가장 가까운 자리로 이어 손 모양이 크게 바뀌지 않아요';
  if (v.chord.bass !== v.chord.root) why = `베이스 ${pcName(v.chord.bass, key)} 위에 ${pcName(v.chord.root, key)} 코드 — 베이스 라인이 계단처럼 이어져요`;
  else if (v.chord.tones.includes(5) && !v.chord.tones.includes(4)) why = '4도를 붙잡아 긴장 — 다음에 3도로 풀면 끝맺는 느낌';
  else if (pcs.includes(2) && pcs.includes(4)) why = '3도 위에 9도를 붙인 열린 add9 — 예배 건반의 넓은 울림';
  else if (pcs.includes(10) && pcs.includes(3)) why = '단7을 열어 부드럽게 — 3도와 7도가 손가락 하나 차이';
  return { name: v.chord.name, notes, why };
}

/**
 * band2sheet 가 내보낸 ChordPro (.cho) 읽기: {title}·{key}·{tempo}·{time}, {start_of_verse: 1절}…,
 * 줄마다 ' | ' 로 나뉜 마디, 마디 안의 [코드]. 돌려주는 값: { title, key, tempo, time, sections: [{ name, kind, bars: [[코드 이름]] }] }
 */
export function parseChordPro(text) {
  const out = { title: '', key: '', tempo: null, time: '', sections: [] };
  let cur = null;
  const open = (name, kind) => {
    cur = { name, kind, bars: [] };
    out.sections.push(cur);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const dir = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i.exec(line);
    if (dir) {
      const [, k, v = ''] = dir;
      const key = k.toLowerCase();
      if (key === 'title' || key === 't') out.title = v;
      else if (key === 'key' && !out.key) out.key = v;
      else if (key === 'tempo') out.tempo = Number(v) || null;
      else if (key === 'time') out.time = v;
      else if (key.startsWith('start_of_')) open(v || key.slice(9), key.slice(9));
      else if (key.startsWith('end_of_')) cur = null;
      else if (key === 'comment' || key === 'c') open(v, 'other');
      continue;
    }
    if (!line.includes('[')) continue;
    if (!cur) open('곡', 'other');
    for (const cell of line.split('|')) {
      const chords = [...cell.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim()).filter((c) => c && c !== '/');
      if (chords.length) cur.bars.push(chords);
      else if (/\[\/\]/.test(cell) && cur.bars.length) cur.bars.push([...cur.bars.at(-1)]);
    }
  }
  out.sections = out.sections.filter((x) => x.bars.length);
  return out;
}

// 건반에서 친 음 → 코드 이름 (같은 음 묶음이 여럿으로 읽히면 단순한 쪽, 베이스가 근음인 쪽을 고른다)
const NAME_ORDER = ['', 'm', '7', 'maj7', 'm7', 'sus4', 'sus2', 'add9', 'madd9', '6', 'm6', 'dim', 'aug', 'm7b5', 'dim7', '9', 'maj9', 'm9', '7sus4', 'mM7', '5'];
const NAMES_MIXED = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * 누르고 있는 음들(midi) → { name: 'Cmaj7/E', root, bass, notes } 또는 코드가 아니면 null.
 * key 를 주면 그 조에 맞춰 샵·플랫으로 적는다 (없으면 C# Eb F# Ab Bb).
 */
export function nameChord(midis, key = null) {
  const sorted = [...new Set(midis)].sort((a, b) => a - b);
  const pcs = [...new Set(sorted.map(pcOf))];
  if (pcs.length < 2) return null;
  const bass = pcOf(sorted[0]);
  const spell = (pc) => (key == null ? NAMES_MIXED[pc] : pcName(pc, key));
  let best = null;
  for (const root of pcs) {
    const rel = new Set(pcs.map((pc) => pcOf(pc - root)));
    for (const [suffix, tones] of QUALITIES) {
      const want = new Set(tones.map(pcOf));
      if (want.size !== rel.size || ![...want].every((t) => rel.has(t))) continue;
      const rank = NAME_ORDER.indexOf(suffix);
      const score = (root === bass ? 0 : 100) + (rank < 0 ? 50 : rank);
      if (!best || score < best.score) best = { score, root, suffix };
    }
  }
  if (!best) return null;
  const name = `${spell(best.root)}${best.suffix}${best.root === bass ? '' : `/${spell(bass)}`}`;
  return { name, root: best.root, bass, notes: sorted };
}

/**
 * ChordPro 섹션의 종류: band2sheet 는 절·후렴·브리지를 {start_of_…} 로, 그 밖(인트로·프리코러스…)은 {comment: …} 로 적는다.
 * 'Pre-Chorus' 는 후렴이 아니다.
 */
export function sectionKind(s) {
  if (['verse', 'chorus', 'bridge'].includes(s.kind)) return s.kind;
  const t = String(s.name ?? '').toLowerCase();
  if (/pre-?\s?chorus|프리/.test(t)) return 'other';
  return /chorus|후렴/.test(t) ? 'chorus' : /bridge|브릿지|브리지/.test(t) ? 'bridge' : /verse|절/.test(t) ? 'verse' : 'other';
}

/** 조 이름 → 조표 기준 음 (단조는 나란한 장조: Em → 7(G)). 코드를 옮기거나 샵·플랫을 고를 때 쓴다. 못 읽으면 null */
export function keyRef(text) {
  const m = /^([A-G])([#b♯♭]?)(m(?!aj))?/.exec(String(text ?? '').trim());
  return m ? (((PC[m[1]] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0) + (m[3] ? 3 : 0)) % 12) + 12) % 12 : null;
}

/** 후렴(넓게) 바로 앞 마디: 라이저를 놓기 좋은 곳 (마디 번호들, 0부터) */
export function liftPoints(widths) {
  const out = [];
  for (let i = 1; i < widths.length; i++) if (widths[i] === 'wide' && widths[i - 1] !== 'wide') out.push(i - 1);
  return out;
}
