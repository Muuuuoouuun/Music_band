// 루퍼: 연주한 음을 박 위치로 기억해 마디 수만큼 돌려 주는 기록. 소리 대신 음표를 담기 때문에
// 나중에 트랙 음색을 바꾸거나, 퀀타이즈를 다시 하거나, 튜닝을 바꿔도 그대로 따라간다.

export const METERS = [
  { id: '4/4', beatsPerBar: 4, label: '4/4' },
  { id: '3/4', beatsPerBar: 3, label: '3/4' },
  { id: '6/8', beatsPerBar: 6, label: '6/8', beatUnit: 8 },
];

export const QUANTIZE = [
  { id: 'off', grid: 0, label: '끄기' },
  { id: '1/4', grid: 1, label: '4분' },
  { id: '1/8', grid: 0.5, label: '8분' },
  { id: '1/16', grid: 0.25, label: '16분' },
  { id: '1/8T', grid: 1 / 3, label: '8분 셋잇단' },
];

export const TRACK_COLORS = ['brass', 'signal', 'rose', 'sky'];

/** 박(beat) 단위 시계. 6/8 은 8분음표를 한 박으로 센다. */
export function loopClock({ bpm = 72, meter = '4/4', bars = 2 } = {}) {
  const m = METERS.find((x) => x.id === meter) ?? METERS[0];
  const beatSec = (60 / bpm) * (m.beatUnit === 8 ? 0.5 : 1);
  const beats = m.beatsPerBar * bars;
  return { bpm, meter: m.id, bars, beatsPerBar: m.beatsPerBar, beatSec, beats, seconds: beats * beatSec };
}

/** 박 위치 -> "마디.박" (1부터). */
export function barBeat(beat, beatsPerBar) {
  const b = Math.max(0, beat);
  return `${Math.floor(b / beatsPerBar) + 1}.${Math.floor(b % beatsPerBar) + 1}`;
}

export function quantizeBeat(t, grid, loopBeats) {
  if (!grid) return t;
  const q = Math.round(t / grid) * grid;
  return ((q % loopBeats) + loopBeats) % loopBeats;
}

export function makeTrack(i, sound = null) {
  return { id: `t${i + 1}`, name: `트랙 ${i + 1}`, color: TRACK_COLORS[i % TRACK_COLORS.length], notes: [], muted: false, solo: false, volume: 0.8, sound };
}

/** 박 구간 [from, to) 안에서 울려야 할 음들. 트랜스포트가 시작된 뒤 계속 늘어나는 절대 박 위치를 쓴다. */
export function eventsInWindow(notes, loopBeats, from, to) {
  const out = [];
  if (to <= from) return out;
  const firstLoop = Math.floor(from / loopBeats);
  const lastLoop = Math.floor(to / loopBeats);
  for (let k = firstLoop; k <= lastLoop; k++) {
    for (const note of notes) {
      const at = k * loopBeats + note.t;
      // 녹음한 바퀴에는 이미 손으로 친 소리가 났으므로 다음 바퀴부터 돌려 준다
      if (k <= note.iter) continue;
      if (at >= from && at < to) out.push({ note, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export class LooperState {
  constructor(trackCount = 4) {
    this.tracks = Array.from({ length: trackCount }, (_, i) => makeTrack(i));
    this.pending = new Map();
    this.pass = 0;
    this.quantize = 0;
  }

  audible(track) {
    const anySolo = this.tracks.some((t) => t.solo);
    return anySolo ? track.solo : !track.muted;
  }

  /** 새 녹음 바퀴 시작 (실행 취소는 이 번호 단위로 지운다). */
  nextPass() {
    this.pass += 1;
    return this.pass;
  }

  /** absBeat: 트랜스포트 시작 뒤의 절대 박. loopBeats 로 나눠 루프 안 위치와 바퀴 번호를 얻는다. */
  noteOn(trackIndex, midi, velocity, absBeat, loopBeats) {
    const iter = Math.floor(absBeat / loopBeats);
    const t = absBeat - iter * loopBeats;
    this.pending.set(`${trackIndex}:${midi}`, { trackIndex, midi, velocity, t, iter, pass: this.pass });
  }

  noteOff(trackIndex, midi, absBeat, loopBeats) {
    const key = `${trackIndex}:${midi}`;
    const p = this.pending.get(key);
    if (!p) return null;
    this.pending.delete(key);
    const held = Math.max(0.05, Math.min(loopBeats, absBeat - (p.iter * loopBeats + p.t)));
    const t = quantizeBeat(p.t, this.quantize, loopBeats);
    // 퀀타이즈로 다음 바퀴 처음으로 넘어간 음은, 이번 바퀴에 이미 친 것으로 본다
    const iter = this.quantize && t < p.t - this.quantize / 2 ? p.iter + 1 : p.iter;
    const note = { midi: p.midi, velocity: p.velocity, t, dur: held, iter, pass: p.pass };
    this.tracks[trackIndex].notes.push(note);
    return note;
  }

  /** 녹음을 멈출 때 아직 누르고 있던 음을 닫는다. */
  closePending(trackIndex, absBeat, loopBeats) {
    for (const p of [...this.pending.values()]) if (p.trackIndex === trackIndex) this.noteOff(trackIndex, p.midi, absBeat, loopBeats);
  }

  undo(trackIndex) {
    const t = this.tracks[trackIndex];
    if (!t.notes.length) return false;
    const last = Math.max(...t.notes.map((n) => n.pass));
    t.notes = t.notes.filter((n) => n.pass !== last);
    return true;
  }

  clear(trackIndex) {
    this.tracks[trackIndex].notes = [];
  }

  /** 박자·마디 수를 바꾸면 루프 밖으로 나간 음은 지운다. */
  fitTo(loopBeats) {
    for (const t of this.tracks) t.notes = t.notes.filter((n) => n.t < loopBeats).map((n) => ({ ...n, dur: Math.min(n.dur, loopBeats) }));
  }

  /** 다시 재생할 때는 처음 바퀴부터 모두 들리게. */
  rewind() {
    for (const t of this.tracks) for (const n of t.notes) n.iter = -1;
    this.pending.clear();
  }
}

/** 예시 루프: 72 BPM 4/4 4마디, C - G/B - Am7 - Fadd9 (패드·베이스·일렉피아노 분산화음). */
export function exampleLoop() {
  const bars = [
    { pad: [48, 55, 60, 64], bass: 36, arp: [60, 67, 72, 76] },
    { pad: [47, 55, 59, 62], bass: 35, arp: [59, 67, 71, 74] },
    { pad: [45, 52, 57, 60, 67], bass: 33, arp: [57, 64, 69, 72] },
    { pad: [41, 53, 57, 60, 67], bass: 29, arp: [57, 65, 69, 72] },
  ];
  const pad = [];
  const bass = [];
  const arp = [];
  bars.forEach((b, i) => {
    const t0 = i * 4;
    for (const m of b.pad) pad.push({ midi: m, velocity: 0.7, t: t0, dur: 3.9, iter: -1, pass: 1 });
    bass.push({ midi: b.bass, velocity: 0.85, t: t0, dur: 2.4, iter: -1, pass: 1 });
    bass.push({ midi: b.bass + 12, velocity: 0.6, t: t0 + 3, dur: 0.9, iter: -1, pass: 1 });
    b.arp.forEach((m, k) => arp.push({ midi: m, velocity: 0.55 + 0.1 * (k === 0), t: t0 + k * 1, dur: 0.9, iter: -1, pass: 1 }));
  });
  return { bpm: 72, meter: '4/4', bars: 4, tracks: [pad, bass, arp] };
}
