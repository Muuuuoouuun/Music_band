import test from 'node:test';
import assert from 'node:assert/strict';
import { loopClock, barBeat, quantizeBeat, eventsInWindow, LooperState, exampleLoop } from '../src/looper.js';

test('박 시계: 4/4·6/8', () => {
  const c = loopClock({ bpm: 120, meter: '4/4', bars: 2 });
  assert.equal(c.beats, 8);
  assert.equal(c.seconds, 4);
  const s = loopClock({ bpm: 60, meter: '6/8', bars: 1 });
  assert.equal(s.beats, 6);
  assert.equal(s.seconds, 3);
  assert.equal(barBeat(5.5, 4), '2.2');
});

test('퀀타이즈는 루프 안으로 감싼다', () => {
  assert.equal(quantizeBeat(1.9, 0.5, 8), 2);
  assert.equal(quantizeBeat(7.9, 0.5, 8), 0);
  assert.equal(quantizeBeat(1.37, 0, 8), 1.37);
});

test('녹음한 바퀴에서는 다시 울리지 않고 다음 바퀴부터 돌아온다', () => {
  const L = new LooperState(2);
  L.nextPass();
  L.noteOn(0, 60, 0.8, 1.0, 4);
  L.noteOff(0, 60, 1.5, 4);
  const notes = L.tracks[0].notes;
  assert.equal(notes.length, 1);
  assert.deepEqual(eventsInWindow(notes, 4, 0.5, 2), []);
  const ev = eventsInWindow(notes, 4, 4.5, 6);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].at, 5);
  assert.equal(eventsInWindow(notes, 4, 0, 16).length, 3);
});

test('끝에서 친 음이 퀀타이즈로 처음으로 넘어가면 바로 겹쳐 울리지 않는다', () => {
  const L = new LooperState(1);
  L.quantize = 0.5;
  L.nextPass();
  L.noteOn(0, 64, 0.8, 3.95, 4);
  L.noteOff(0, 64, 4.4, 4);
  const [n] = L.tracks[0].notes;
  assert.equal(n.t, 0);
  assert.deepEqual(eventsInWindow([n], 4, 3.9, 4.5), []);
  assert.equal(eventsInWindow([n], 4, 7.9, 8.5)[0].at, 8);
});

test('실행 취소는 마지막 바퀴만, 솔로·뮤트', () => {
  const L = new LooperState(2);
  L.nextPass();
  L.noteOn(0, 60, 1, 0, 4); L.noteOff(0, 60, 1, 4);
  L.nextPass();
  L.noteOn(0, 62, 1, 5, 4); L.noteOff(0, 62, 6, 4);
  L.undo(0);
  assert.deepEqual(L.tracks[0].notes.map((n) => n.midi), [60]);
  L.tracks[1].solo = true;
  assert.equal(L.audible(L.tracks[0]), false);
  assert.equal(L.audible(L.tracks[1]), true);
});

test('누르고 있던 음은 녹음을 멈출 때 닫힌다', () => {
  const L = new LooperState(1);
  L.noteOn(0, 48, 1, 2, 8);
  L.closePending(0, 4, 8);
  assert.equal(L.tracks[0].notes[0].dur, 2);
});

test('예시 루프는 4마디 안에 들어 있다', () => {
  const ex = exampleLoop();
  const beats = loopClock(ex).beats;
  for (const track of ex.tracks) for (const n of track) assert.ok(n.t >= 0 && n.t < beats && n.t + n.dur <= beats + 1e-9);
});
