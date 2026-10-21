import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTuner, offsets, normalizeTuning, parseScala, exportScala, degreesToCustom, noteName, nearestNote, TEMPERAMENTS } from '../src/tuning.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('평균율 A4=440: 표준 주파수', () => {
  const { freq } = makeTuner({});
  near(freq(69), 440);
  near(freq(60), 261.6255653);
  near(freq(81), 880);
});

test('기준음·조옮김·미세 조정', () => {
  near(makeTuner({ a4: 432 }).freq(69), 432);
  near(makeTuner({ transpose: 2 }).freq(60), makeTuner({}).freq(62));
  near(makeTuner({ fine: 50 }).freq(69), 440 * 2 ** (50 / 1200));
  assert.equal(normalizeTuning({ fine: 100 }).fine, 50);
});

test('음률은 A 를 기준음에 고정하고, 조를 옮기면 표도 같이 돈다', () => {
  for (const id of Object.keys(TEMPERAMENTS).filter((k) => k !== 'custom')) {
    for (let root = 0; root < 12; root++) near(offsets(normalizeTuning({ temperament: id, root }))[9], 0);
  }
  // C 순정률: 장3도 C-E 가 5/4, 완전5도 C-G 가 3/2
  const just = makeTuner({ temperament: 'just', root: 0 });
  near(just.freq(64) / just.freq(60), 5 / 4, 1e-4);
  near(just.freq(67) / just.freq(60), 3 / 2, 1e-4);
  // G 순정률이면 G-B 가 5/4
  const g = makeTuner({ temperament: 'just', root: 7 });
  near(g.freq(71) / g.freq(67), 5 / 4, 1e-4);
  // 가온음률: 장3도 순수
  const mt = makeTuner({ temperament: 'meantone', root: 0 });
  near(mt.freq(64) / mt.freq(60), 5 / 4, 1e-4);
});

test('조옮김을 하면 실제로 나는 음에 음률이 붙는다', () => {
  // D 순정률 + 2반음 조옮김: C4·E4 를 누르면 D4·F#4 가 나고, 이 장3도가 5/4
  const t = makeTuner({ temperament: 'just', root: 2, transpose: 2 });
  near(t.freq(64) / t.freq(60), 5 / 4, 1e-4);
});

test('옥타브 늘이기: A4 위는 높게, 아래는 낮게', () => {
  const t = makeTuner({ stretch: 2 });
  near(t.freq(81), 880 * 2 ** (2 / 1200));
  near(t.freq(57), 220 * 2 ** (-2 / 1200));
});

test('잘못된 튜닝 값은 기본값으로', () => {
  const t = normalizeTuning({ a4: 'x', transpose: 40, temperament: 'custom', custom: [1, 2] });
  assert.equal(t.a4, 440);
  assert.equal(t.transpose, 12);
  assert.equal(t.temperament, 'equal');
});

test('Scala: 내보낸 파일을 다시 읽으면 같은 튜닝', () => {
  for (const id of ['just', 'werckmeister3', 'vallotti']) {
    for (const root of [0, 7]) {
      const t = normalizeTuning({ temperament: id, root });
      const back = parseScala(exportScala(t));
      const custom = degreesToCustom(back.degrees, root);
      offsets(t).forEach((c, i) => near(custom[i], c, 0.02));
    }
  }
});

test('Scala: 비율 표기와 오류 안내', () => {
  const text = '! test\nJust 12\n12\n16/15\n9/8\n6/5\n5/4\n4/3\n45/32\n3/2\n8/5\n5/3\n16/9\n15/8\n2/1\n';
  const s = parseScala(text);
  near(s.degrees[4], 1200 * Math.log2(5 / 4));
  assert.throws(() => parseScala('a\n7\n100.\n200.\n'), /12음/);
  assert.throws(() => parseScala('a\n12\n' + '100.\n'.repeat(11) + '3/1\n'), /옥타브/);
});

test('음이름과 가장 가까운 음', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(70), 'Bb4');
  const n = nearestNote(446, 440);
  assert.equal(n.name, 'A4');
  near(n.cents, 1200 * Math.log2(446 / 440), 1e-9);
});
