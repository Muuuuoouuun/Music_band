import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, tickToSeconds, playedNotes, noteRegions, eventsIn } from '../src/midi.js';

/** 시험용 MIDI 만들기: tracks = [[ [delta, ...bytes], ... ], ...] */
function smf(division, tracks) {
  const vlq = (n) => {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const bytes = [...'MThd'].map((c) => c.charCodeAt(0)).concat(u32(6), [0, 1, 0, tracks.length, division >> 8, division & 255]);
  for (const evs of tracks) {
    const body = evs.flatMap(([d, ...b]) => [...vlq(d), ...b]).concat([0, 0xff, 0x2f, 0]);
    bytes.push(...[...'MTrk'].map((c) => c.charCodeAt(0)), ...u32(body.length), ...body);
  }
  return new Uint8Array(bytes);
}
const tempo = (bpm) => {
  const us = Math.round(60e6 / bpm);
  return [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
};
const name = (s) => [0xff, 0x03, s.length, ...[...s].map((c) => c.charCodeAt(0))];

test('템포가 바뀌어도 초가 맞다 (124 → 70 bpm)', () => {
  const toSec = tickToSeconds(480, [{ tick: 0, usPerBeat: 60e6 / 124 }, { tick: 13440, usPerBeat: 60e6 / 70 }]);
  assert.ok(Math.abs(toSec(480) - 60 / 124) < 1e-9);
  assert.ok(Math.abs(toSec(13440) - 28 * (60 / 124)) < 1e-9);
  assert.ok(Math.abs(toSec(13440 + 480) - (28 * (60 / 124) + 60 / 70)) < 1e-9);
  assert.ok(Math.abs(tickToSeconds(480, [])(960) - 1) < 1e-9); // 템포 없으면 120 bpm
});

test('음표: 이름·세기·시작·끝, 이어지는 상태 바이트, 세기 0 = 놓기', () => {
  const file = smf(480, [
    [[0, ...tempo(120)], [1920, ...tempo(60)]],
    [[0, ...name('Lead')], [0, 0x90, 60, 100], [480, 64, 90], [480, 60, 0], [0, 0x80, 64, 0], [480, 0xc0, 5], [0, 0x90, 67, 80], [480, 0x90, 67, 0]],
  ]);
  const m = parseMidi(file);
  assert.equal(m.tracks.length, 2);
  assert.equal(m.tracks[1].name, 'Lead');
  const [a, b, c] = m.tracks[1].notes;
  assert.deepEqual([a.midi, a.velocity, a.start, a.end], [60, 100, 0, 1]);
  assert.deepEqual([b.midi, b.velocity, b.start, b.end], [64, 90, 0.5, 1]);
  assert.deepEqual([c.midi, c.start, c.end], [67, 1.5, 2]); // 1920틱 뒤로 60 bpm
  assert.equal(m.duration, 2);
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3])));
});

test('키스위치(한 음씩 연주하는 트랙에서 함께 눌린 아주 낮은 음)는 비교 연주에서 뺀다', () => {
  const notes = [
    { midi: 33, velocity: 100, start: 2, end: 3.2 },
    { midi: 70, velocity: 82, start: 2.05, end: 5 },
    { midi: 65, velocity: 58, start: 0.7, end: 2 },
    { midi: 72, velocity: 70, start: 0, end: 0.6 },
  ];
  assert.deepEqual(playedNotes(notes).map((n) => n.midi), [70, 65, 72]);
  // 화음 트랙의 낮은 음(베이스)은 그대로
  const chords = [36, 60, 64, 67].map((m) => ({ midi: m, velocity: 90, start: 0, end: 2 }));
  assert.equal(playedNotes(chords).length, 4);
});

test('한 음 구간: 겹치지 않는 가장 긴 음, 타악기는 다음 음까지 울리는 길이로', () => {
  const notes = [
    { midi: 60, velocity: 100, start: 0, end: 0.5 },
    { midi: 62, velocity: 100, start: 0.5, end: 2.5 },
    { midi: 64, velocity: 100, start: 2.5, end: 2.9 },
    { midi: 65, velocity: 100, start: 2.7, end: 3.5 },
  ];
  const r = noteRegions(notes, { count: 3 });
  assert.equal(r[0].note.midi, 62);
  assert.ok(Math.abs(r[0].start - 0.47) < 1e-9 && Math.abs(r[0].end - 2.48) < 1e-9);
  assert.ok(!r.some((x) => [64, 65].includes(x.note.midi)), '겹치는 음은 빼기');
  const hits = [0, 0.8, 1.6].map((t) => ({ midi: 60, velocity: 110, start: t, end: t + 0.1 }));
  const rh = noteRegions(hits, { count: 2 });
  // 마지막 타격은 뒤에 음이 없어 1.5초 더 울리는 것으로, 앞 타격은 다음 타격 직전까지
  assert.ok(Math.abs(rh[0].start - 1.57) < 1e-9 && Math.abs(rh[0].end - 3.2) < 1e-9, JSON.stringify(rh[0]));
  assert.ok(Math.abs(rh[1].end - (rh[1].note.start + 0.78)) < 1e-9);
  // 한 음씩인 곳이 없으면 가장 긴 화음
  const pad = [50, 60, 65].map((m) => ({ midi: m, velocity: 100, start: 1, end: 3 }));
  assert.deepEqual(noteRegions(pad)[0].notes.map((n) => n.midi), [50, 60, 65]);
});

test('구간 안 음들을 구간 시작 기준으로 (같은 음으로 비교 연주)', () => {
  const notes = [{ midi: 69, velocity: 127, start: 10, end: 11.5 }, { midi: 71, velocity: 64, start: 11.5, end: 13 }];
  const ev = eventsIn(notes, 11.47, 12.5);
  assert.deepEqual(ev.map((e) => e.midi), [71]);
  assert.ok(Math.abs(ev[0].on - 0.03) < 1e-9 && Math.abs(ev[0].off - 1.03) < 1e-9);
  assert.ok(Math.abs(ev[0].velocity - 64 / 127) < 1e-9);
  // 구간 절반 넘게 이어지는 앞 음은 넣고 (구간 시작에 바로 울림), 꼬리만 걸친 앞 음은 뺀다
  const held = eventsIn(notes, 10.2, 12);
  assert.deepEqual(held.map((e) => e.midi), [69, 71]);
  assert.equal(held[0].on, 0);
  assert.ok(Math.abs(held[1].on - 1.3) < 1e-9);
  assert.deepEqual(eventsIn(notes, 10.97, 12.5).map((e) => e.midi), [71]);
});
