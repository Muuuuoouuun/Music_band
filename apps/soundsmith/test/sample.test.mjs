import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, trimSilence, findLoop, crossfadeLoop, bakePingPong, peaks, encodeWav, sfzText, demoSample, toMono, bakeSample } from '../src/sample.js';

const SR = 44100;
const tone = (hz, sec, sr = SR) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / sr) + 0.2 * Math.sin((4 * Math.PI * hz * i) / sr));

test('음높이 찾기: 사인·배음 섞인 소리·데모 소리', () => {
  for (const hz of [55, 110, 261.63, 440, 987.77]) {
    const r = detectPitch(tone(hz, 0.8), SR);
    assert.ok(Math.abs(1200 * Math.log2(r.hz / hz)) < 5, `${hz} -> ${r.hz}`);
  }
  const d = detectPitch(demoSample(SR), SR);
  assert.equal(d.note, 45); // A2
  assert.ok(Math.abs(d.cents) < 15);
  assert.equal(detectPitch(new Float32Array(SR), SR), null);
});

test('무음 자르기', () => {
  const x = new Float32Array(SR * 2);
  x.set(tone(220, 1), Math.round(SR * 0.5));
  const { start, end } = trimSilence(x, SR);
  assert.ok(Math.abs(start / SR - 0.5) < 0.02 && Math.abs(end / SR - 1.5) < 0.02, `${start / SR} ${end / SR}`);
});

test('루프 찾기: 일정한 소리는 주기의 정수배로 거의 완벽하게 이어진다', () => {
  const x = tone(220, 1.5);
  const loop = findLoop(x, SR, { hz: 220 });
  assert.ok(loop.cost < 0.01, `cost ${loop.cost}`);
  const cycles = ((loop.loopEnd - loop.loopStart) * 220) / SR;
  assert.ok(Math.abs(cycles - Math.round(cycles)) < 0.05, `cycles ${cycles}`);
  const d = demoSample(SR);
  const dl = findLoop(d, SR, { hz: 110 });
  assert.ok(dl.loopEnd > dl.loopStart && dl.cost < 0.3, `demo cost ${dl.cost}`);
});

test('크로스페이드는 루프 끝 직전만 바꾸고, 끝 지점을 루프 시작 직전 소리로 만든다', () => {
  const x = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
  const y = crossfadeLoop(x, 400, 900, 100);
  assert.deepEqual([...y.subarray(0, 800)], [...x.subarray(0, 800)]);
  assert.ok(Math.abs(y[899] - x[399]) < 0.02);
});

test('왕복 루프 굽기', () => {
  const x = Float32Array.from([0, 1, 2, 3, 4, 5]);
  const { data, loopStart, loopEnd } = bakePingPong(x, 2, 5);
  assert.deepEqual([...data], [0, 1, 2, 3, 4, 4, 3, 2]);
  assert.equal(loopStart, 2);
  assert.equal(loopEnd, 8);
});

test('파형 요약·모노 합치기', () => {
  const p = peaks(Float32Array.from([0.5, -0.25, 1, -1]), 2);
  assert.deepEqual([...p], [-0.25, 0.5, -1, 1]);
  assert.deepEqual([...toMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])])], [0.5, 0.5]);
});

test('WAV 머리말과 SFZ 정의', () => {
  const wav = encodeWav(Float32Array.from([0, 1, -1]), 48000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(40, true), 6);
  assert.equal(v.getInt16(46, true), 32767);
  assert.equal(v.getInt16(48, true), -32768);
  const sfz = sfzText({ file: 'a.wav', name: '첼로', root: 45, tune: -6.4, loop: { start: 100, end: 200 }, env: { a: 0.01, d: 1, s: 0.8, r: 0.5 } });
  assert.match(sfz, /pitch_keycenter=45 tune=-6/);
  assert.match(sfz, /loop_start=100 loop_end=199/);
  assert.match(sfz, /ampeg_sustain=80/);
});

test('굽기: 크로스페이드를 넣으면 들리는 이음새가 좋아지고, 위치는 잘라낸 소리 기준', () => {
  const data = demoSample(SR);
  const loop = findLoop(data, SR, { hz: 110 });
  const base = { data, sr: SR, start: 1000, end: data.length - 1000, detected: { hz: 110 }, loopMode: 'forward', loopStart: loop.loopStart, loopEnd: loop.loopEnd };
  const raw = bakeSample({ ...base, xfadeMs: 0 });
  const smooth = bakeSample({ ...base, xfadeMs: 40 });
  assert.equal(raw.loop.start, loop.loopStart - 1000);
  assert.equal(raw.data.length, data.length - 2000);
  assert.ok(raw.seamCost < 0.05 && smooth.seamCost < 0.05, `${raw.seamCost} ${smooth.seamCost}`);
  // 일부러 어긋난 루프는 크로스페이드가 이음새를 크게 줄인다
  const bad = { ...base, loopStart: loop.loopStart + 97 };
  const badRaw = bakeSample({ ...bad, xfadeMs: 0 });
  const badSmooth = bakeSample({ ...bad, xfadeMs: 60 });
  assert.ok(badRaw.seamCost > 0.3 && badSmooth.seamCost < badRaw.seamCost / 3, `${badRaw.seamCost} -> ${badSmooth.seamCost}`);
  const pp = bakeSample({ ...base, loopMode: 'pingpong', xfadeMs: 0 });
  assert.equal(pp.loop.end - pp.loop.start, 2 * (loop.loopEnd - loop.loopStart));
  const off = bakeSample({ ...base, loopMode: 'off', xfadeMs: 0 });
  assert.equal(off.loop, null);
  assert.ok(Math.abs(off.data.reduce((m, v) => Math.max(m, Math.abs(v)), 0) * off.gain - 10 ** (-1 / 20)) < 1e-6);
});
