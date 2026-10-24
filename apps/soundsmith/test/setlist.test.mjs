import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSong, normalizeSetlist, moveSong, keyLabel, MAX_SONGS } from '../src/setlist.js';
import { FACTORY } from '../src/presets.js';

const pad = FACTORY[0].patch;

test('곡: 빈 값·이상한 값도 연주할 수 있는 곡이 된다', () => {
  const s = normalizeSong({ patch: pad, transpose: 30, bpm: 500, memo: 7, title: '   ' });
  assert.equal(s.title, pad.name);
  assert.equal(s.transpose, 12);
  assert.equal(s.bpm, 200);
  assert.equal(s.memo, '');
  assert.deepEqual(s.patch, pad);
  assert.equal(normalizeSong({ patch: pad, bpm: null }).bpm, null);
  assert.equal(normalizeSong({ patch: pad, transpose: -2.4 }).transpose, -2);
  assert.equal(normalizeSong({ patch: pad, title: 'x'.repeat(100) }).title.length, 60);
  // 저장했다 다시 읽어도 같다
  const back = normalizeSong(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
});

test('세트리스트: 깨진 항목은 빼고, 아이디가 겹치면 새로, 최대 곡 수', () => {
  const list = normalizeSetlist([{ id: 'a', patch: pad }, null, 3, { id: 'a', patch: pad }, { title: '음색 없음' }]);
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id);
  assert.deepEqual(normalizeSetlist('x'), []);
  assert.equal(normalizeSetlist(Array.from({ length: 80 }, () => ({ patch: pad }))).length, MAX_SONGS);
});

test('곡 순서 바꾸기와 조옮김 말', () => {
  const list = normalizeSetlist([{ title: '1', patch: pad }, { title: '2', patch: pad }, { title: '3', patch: pad }]);
  assert.deepEqual(moveSong(list, 0, 1).map((s) => s.title), ['2', '1', '3']);
  assert.equal(moveSong(list, 2, 1), list);
  assert.equal(keyLabel(0), '조옮김 없음');
  assert.equal(keyLabel(2), '+2 (C → D)');
  assert.equal(keyLabel(-3), '−3 (C → A)');
});
