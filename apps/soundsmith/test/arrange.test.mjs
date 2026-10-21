import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, parseChart, voiceChord, arrange, liftPoints } from '../src/arrange.js';

const pc = (m) => ((m % 12) + 12) % 12;

test('코드 읽기: 근음·베이스·구성음', () => {
  assert.deepEqual(parseChord('G/B'), { name: 'G/B', root: 7, bass: 11, tones: [0, 4, 7] });
  assert.deepEqual(parseChord('Am7').tones, [0, 3, 7, 10]);
  assert.deepEqual(parseChord('Fadd9').tones, [0, 4, 7, 14]);
  assert.equal(parseChord('Bb2').root, 10);
  assert.equal(parseChord('F#m').root, 6);
  assert.deepEqual(parseChord('CM7').tones, [0, 4, 7, 11]);
  assert.equal(parseChord('Dsus4').tones.join(), '0,5,7');
  assert.equal(parseChord('H7'), null);
  assert.equal(parseChord('Cxyz'), null);
});

test('진행 읽기: 마디는 |, 한 마디 두 코드, % 반복, 못 읽은 글자는 따로', () => {
  const { bars, bad } = parseChart('| C | G/B | Am7 F | % | Dm7 % | Qq |');
  assert.deepEqual(bars.map((b) => b.map((c) => c.name)), [['C'], ['G/B'], ['Am7', 'F'], ['Am7', 'F'], ['Dm7', 'Dm7']]);
  assert.deepEqual(bad, ['Qq']);
});

test('보이싱: 베이스는 E2–D#3, 오른손은 코드음만, 넓게는 add9 색, 가까운 자리로 이어진다', () => {
  const g = voiceChord(parseChord('G/B'));
  assert.equal(pc(g.left[0]), 11);
  assert.ok(g.left[0] >= 40 && g.left[0] <= 51);
  assert.ok(g.right.every((m) => [7, 11, 2].includes(pc(m))));
  const wide = voiceChord(parseChord('C'), { wide: true });
  assert.equal(wide.left.length, 2);
  assert.ok(wide.right.some((m) => pc(m) === 2), '넓게 하면 9도(D)가 들어감');
  // 목소리 이끌기: 앞 화음 근처에 머문다
  const a = voiceChord(parseChord('C'));
  const b = voiceChord(parseChord('F'), { prev: a.right });
  const center = (ns) => ns.reduce((x, y) => x + y, 0) / ns.length;
  assert.ok(Math.abs(center(b.right) - center(a.right)) <= 4);
});

test('반주: 스타일마다 박 안에 음표, 넓게 마디 앞이 라이저 자리', () => {
  const { bars } = parseChart('| C | G/B | Am7 | Fadd9 |');
  for (const style of ['pad', 'pulse', 'arp', 'organ']) {
    const notes = arrange(bars, { style });
    assert.ok(notes.length > 4, style);
    assert.ok(notes.every((n) => n.t >= 0 && n.t + n.dur <= 16.01 && n.velocity > 0 && n.velocity <= 1 && n.iter === -1), style);
  }
  const pulse = arrange(bars, { style: 'pulse' });
  assert.ok(pulse.some((n) => n.t === 0.5));
  const organ = arrange(bars, { style: 'organ' });
  assert.ok(organ.filter((n) => n.dur < 0.5).every((n) => n.t % 2 === 1), '오르간 콤핑은 2·4박');
  assert.deepEqual(liftPoints(['narrow', 'narrow', 'wide', 'wide']), [1]);
  assert.deepEqual(liftPoints(['wide', 'narrow', 'wide']), [1]);
});
