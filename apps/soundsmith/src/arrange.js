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
export function voiceChord(chord, { wide = false, prev = null, low = 52, high = 79 } = {}) {
  // 베이스는 E2–D#3 안에서 (너무 낮으면 탁해서 C·C#·D·D# 는 한 옥타브 위)
  const bassNote = 36 + chord.bass + (chord.bass < 4 ? 12 : 0);
  const left = wide ? [bassNote, bassNote + 12] : [bassNote];
  let colors = chord.tones.map((t) => t % 12);
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
  const right = candidates[0] ?? pcs.map((pc) => 60 + pc);
  return { left, right };
}

/**
 * 진행 + 스타일 → 루퍼 음표 [{ midi, velocity, t, dur, iter: -1, pass: 1 }] (t, dur 는 박).
 * sections: 마디마다 'narrow' | 'wide' (없으면 모두 style 기본값)
 */
export function arrange(bars, { style = 'pad', beatsPerBar = 4, wide = false, widths = null } = {}) {
  const notes = [];
  let prev = null;
  const add = (midi, t, dur, velocity) => notes.push({ midi, velocity, t, dur, iter: -1, pass: 1 });
  bars.forEach((chords, b) => {
    const span = beatsPerBar / chords.length;
    chords.forEach((chord, k) => {
      const t0 = b * beatsPerBar + k * span;
      const isWide = widths ? widths[b] === 'wide' : wide;
      const v = voiceChord(chord, { wide: isWide, prev });
      prev = v.right;
      if (style === 'pad') {
        for (const m of v.left) add(m, t0, span - 0.05, 0.62);
        for (const m of v.right) add(m, t0, span - 0.05, 0.58);
      } else if (style === 'pulse') {
        for (const m of v.left) add(m, t0, span - 0.05, 0.6);
        for (let e = 0; e < span * 2; e++) for (const m of v.right) add(m, t0 + e * 0.5, 0.42, e % 2 ? 0.45 : 0.62);
      } else if (style === 'arp') {
        add(v.left[0], t0, span - 0.05, 0.6);
        const up = [...v.right, v.right[0] + 12];
        for (let e = 0; e < span * 2; e++) add(up[e % up.length], t0 + e * 0.5, 0.48, 0.52 + (e % up.length === 0 ? 0.1 : 0));
      } else {
        for (const m of v.left) add(m, t0, span - 0.05, 0.6);
        for (let beat = 0; beat < span; beat++) {
          const abs = k * span + beat;
          if (abs % 2 === 1) for (const m of v.right) add(m, t0 + beat, 0.35, 0.62);
        }
      }
    });
  });
  return notes;
}

/** 후렴(넓게) 바로 앞 마디: 라이저를 놓기 좋은 곳 (마디 번호들, 0부터) */
export function liftPoints(widths) {
  const out = [];
  for (let i = 1; i < widths.length; i++) if (widths[i] === 'wide' && widths[i - 1] !== 'wide') out.push(i - 1);
  return out;
}
