// MIDI 파일 읽기: 트랙마다 음표(높이·세기·시작·끝 초)를 꺼낸다. 템포가 중간에 바뀌어도(템포 맵) 초가 맞다.
// 음원 따라 만들기에서 멀티트랙 음원과 함께 받은 MIDI 로 '한 음 구간'을 찾고, 같은 음으로 비교 연주할 때 쓴다.

function vlq(b, i) {
  let v = 0;
  for (let k = 0; k < 4; k++) {
    const c = b[i++];
    v = (v << 7) | (c & 0x7f);
    if (!(c & 0x80)) return [v, i];
  }
  throw new Error('MIDI 길이 값이 깨졌어요');
}

const text = (bytes) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
};

/**
 * MIDI(SMF 0·1) → { division, tempos: [{ tick, usPerBeat }], tracks: [{ name, notes: [{ midi, velocity, start, end }] }], duration }
 * start·end 는 초. 소리 없는 트랙(템포·박자만)도 남겨 두고, 음표 없는 트랙은 notes 가 빈 배열.
 */
export function parseMidi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const str = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 14 || str(0) !== 'MThd') throw new Error('MIDI 파일이 아니에요');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const headLen = dv.getUint32(4);
  const ntrk = dv.getUint16(10);
  const division = dv.getUint16(12);
  let i = 8 + headLen;
  const tempos = [];
  const raw = [];
  for (let t = 0; t < ntrk && i + 8 <= b.length; t++) {
    if (str(i) !== 'MTrk') throw new Error('MIDI 트랙이 깨졌어요');
    const len = dv.getUint32(i + 4);
    let j = i + 8;
    const end = Math.min(b.length, j + len);
    i = end;
    let tick = 0;
    let run = 0;
    let name = '';
    const open = new Map();
    const notes = [];
    while (j < end) {
      let d;
      [d, j] = vlq(b, j);
      tick += d;
      const st = b[j];
      if (st === 0xff) {
        const type = b[j + 1];
        let l;
        let k;
        [l, k] = vlq(b, j + 2);
        const data = b.subarray(k, k + l);
        j = k + l;
        if (type === 0x03 && !name) name = text(data).trim();
        if (type === 0x51 && l === 3) tempos.push({ tick, usPerBeat: (data[0] << 16) | (data[1] << 8) | data[2] });
        if (type === 0x2f) break;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        let l;
        let k;
        [l, k] = vlq(b, j + 1);
        j = k + l;
        continue;
      }
      if (st & 0x80) {
        run = st;
        j++;
      }
      const kind = run & 0xf0;
      const ch = run & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) {
        j += 1;
        continue;
      }
      const a = b[j];
      const v = b[j + 1];
      j += 2;
      const key = ch * 128 + a;
      if (kind === 0x90 && v > 0) {
        if (!open.has(key)) open.set(key, []);
        open.get(key).push({ tick, velocity: v });
      } else if (kind === 0x80 || kind === 0x90) {
        const stack = open.get(key);
        const on = stack?.shift();
        if (on) notes.push({ midi: a, velocity: on.velocity, channel: ch, startTick: on.tick, endTick: Math.max(on.tick + 1, tick) });
      }
    }
    // 끝나지 않은 음은 트랙 끝에서 닫는다
    for (const [key, stack] of open) for (const on of stack) notes.push({ midi: key % 128, velocity: on.velocity, channel: Math.floor(key / 128), startTick: on.tick, endTick: Math.max(on.tick + 1, tick) });
    raw.push({ name, notes });
  }
  const toSec = tickToSeconds(division, tempos);
  const tracks = raw.map((t) => ({
    name: t.name,
    notes: t.notes
      .map((n) => ({ midi: n.midi, velocity: n.velocity, channel: n.channel, start: toSec(n.startTick), end: toSec(n.endTick) }))
      .sort((p, q) => p.start - q.start || p.midi - q.midi),
  }));
  const duration = Math.max(0, ...tracks.flatMap((t) => t.notes.map((n) => n.end)));
  return { division, tempos: tempos.sort((p, q) => p.tick - q.tick), tracks, duration };
}

/** 틱 → 초. 템포 맵(템포가 바뀌는 곳마다 구간을 나눠 더한다). SMPTE 나눔도 받는다. */
export function tickToSeconds(division, tempos) {
  if (division & 0x8000) {
    const fps = 256 - (division >> 8);
    const perFrame = division & 0xff;
    return (tick) => tick / (fps * perFrame);
  }
  const map = [...tempos].sort((p, q) => p.tick - q.tick);
  if (!map.length || map[0].tick > 0) map.unshift({ tick: 0, usPerBeat: 500000 });
  const segs = [];
  let sec = 0;
  for (let k = 0; k < map.length; k++) {
    segs.push({ tick: map[k].tick, sec, spt: map[k].usPerBeat / 1e6 / division });
    if (k + 1 < map.length) sec += (map[k + 1].tick - map[k].tick) * (map[k].usPerBeat / 1e6 / division);
  }
  return (tick) => {
    let s = segs[0];
    for (const x of segs) if (x.tick <= tick) s = x;
    return s.sec + (tick - s.tick) * s.spt;
  };
}

/**
 * 키스위치(가상악기의 주법 바꾸기 건반) 걸러내기: 거의 한 음씩 연주하는 트랙에서 다른 음과 함께 눌린,
 * 트랙 가운데 높이보다 15반음 넘게 낮은 음. 실제 소리가 아니라 주법 신호라 비교 연주에서 뺀다.
 */
export function playedNotes(notes) {
  if (notes.length < 2) return notes;
  const sorted = [...notes].map((n) => n.midi).sort((p, q) => p - q);
  const median = sorted[Math.floor(sorted.length / 2)];
  const overlaps = (n, m) => m !== n && m.start < n.end - 0.02 && n.start < m.end - 0.02;
  const poly = Math.max(...notes.map((n) => notes.filter((m) => overlaps(n, m)).length));
  return notes.filter((n) => {
    if (n.midi > median - 15) return true;
    const together = notes.some((m) => m.midi > n.midi + 12 && (overlaps(n, m) || Math.abs(m.start - n.start) < 0.12));
    return !(together && poly <= 2);
  });
}

/**
 * 비교하기 좋은 한 음 구간: 다른 음과 겹치지 않고 오래 울리는 음 (꼬리는 다음 음 직전까지).
 * 반환: [{ start, end, note }] 긴 것부터. 화음만 있는 트랙은 가장 긴 화음을 { notes } 로.
 */
export function noteRegions(notes, { count = 3, minLength = 0.25, maxLength = 4 } = {}) {
  const played = playedNotes(notes);
  const out = [];
  for (const n of played) {
    const others = played.filter((m) => m !== n);
    const clash = others.some((m) => m.start < n.end - 0.02 && n.start < m.end - 0.02);
    if (clash) continue;
    // 구간은 다음 음 직전까지 (타악기처럼 음표는 짧아도 소리는 그때까지 울린다)
    const next = Math.min(...others.filter((m) => m.start >= n.end - 0.02).map((m) => m.start), Infinity);
    const end = Math.min(n.start + maxLength, Number.isFinite(next) ? next - 0.02 : n.end + 1.5);
    if (end - n.start < minLength) continue;
    out.push({ start: Math.max(0, n.start - 0.03), end, note: n, notes: [n] });
  }
  out.sort((p, q) => q.end - q.start - (p.end - p.start));
  if (out.length) return out.slice(0, count);
  // 한 음만 울리는 곳이 없으면: 같이 시작하는 음 묶음(화음) 중 가장 긴 것
  const chords = [];
  for (const n of played) {
    const group = played.filter((m) => Math.abs(m.start - n.start) < 0.05);
    if (chords.some((c) => Math.abs(c.start - n.start) < 0.05)) continue;
    const end = Math.max(...group.map((m) => m.end));
    if (end - n.start >= minLength) chords.push({ start: Math.max(0, n.start - 0.03), end: Math.min(n.start + maxLength, end + 0.8), notes: group });
  }
  chords.sort((p, q) => q.end - q.start - (p.end - p.start));
  return chords.slice(0, count);
}

/**
 * 구간 안에서 울리는 음들 (구간 시작 기준 초): 같은 음·같은 때로 비교 연주할 때.
 * 구간 앞에서 시작한 음은 구간의 절반 넘게 이어질 때만 넣는다 (앞 음의 꼬리를 새로 친 음으로 연주하지 않게).
 */
export function eventsIn(notes, start, end) {
  const half = (end - start) / 2;
  return playedNotes(notes)
    .filter((n) => n.end > start && n.start < end && (n.start >= start - 0.05 || n.end - start >= half))
    .map((n) => ({ midi: n.midi, velocity: n.velocity / 127, on: Math.max(0, n.start - start), off: Math.min(end - start, n.end - start) }));
}
