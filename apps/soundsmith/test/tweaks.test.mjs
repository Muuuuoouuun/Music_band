import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXES, applyFix } from '../src/tweaks.js';
import { FACTORY } from '../src/presets.js';
import { normalizePatch, PARAMS, getPath } from '../src/patch.js';

const byName = (n) => FACTORY.find((f) => f.patch.name === n).patch;

test('고민별 다듬기: 모든 음색에서 범위 안의 온전한 음색이 되고, 원본은 그대로', () => {
  for (const { patch } of FACTORY) {
    const before = JSON.stringify(patch);
    for (const f of FIXES) {
      const r = applyFix(patch, f.id);
      assert.deepEqual(normalizePatch(JSON.parse(JSON.stringify(r.patch))), r.patch, `${patch.name} / ${f.id}`);
      for (const c of r.changes) {
        const spec = PARAMS[c.path];
        if (spec.kind === 'num') assert.ok(c.to >= spec.min && c.to <= spec.max, `${patch.name} ${c.path} ${c.to}`);
        assert.equal(getPath(r.patch, c.path), c.to);
      }
    }
    assert.equal(JSON.stringify(patch), before);
  }
});

test('고민별 다듬기: 말한 쪽으로 움직인다', () => {
  const pad = byName('워십 패드');
  assert.ok(applyFix(pad, 'brighter').patch.filter.cutoff > pad.filter.cutoff);
  assert.ok(applyFix(pad, 'darker').patch.filter.cutoff < pad.filter.cutoff);
  assert.ok(applyFix(pad, 'faster').patch.ampEnv.a < pad.ampEnv.a);
  assert.ok(applyFix(pad, 'tighter').patch.fx.reverb < pad.fx.reverb);
  assert.ok(applyFix(pad, 'wider').patch.fx.size > pad.fx.size);
  assert.equal(applyFix(pad, 'cut').patch.eq.midFreq, 2000);
  assert.ok(applyFix(pad, 'less-low').patch.eq.low < pad.eq.low);
  assert.ok(applyFix(pad, 'thicker').patch.osc[0].unison > pad.osc[0].unison);
  // 줄 뜯기 음색은 필터 대신 줄의 밝기를
  const guitar = byName('어쿠스틱 기타');
  const g = applyFix(guitar, 'brighter');
  assert.ok(g.patch.pluck.bright > guitar.pluck.bright);
  assert.ok(g.changes.some((c) => c.path === 'pluck.bright'));
  // LFO 가 꺼진 음색은 필터를 천천히 흔들기 시작
  const piano = byName('피아노 (물리 모델)');
  const alive = applyFix(piano, 'alive').patch;
  assert.equal(alive.lfo.target, 'filter');
  assert.ok(alive.lfo.depth > 0.1);
});

test('고민별 다듬기: 바꾼 값을 사람이 읽는 말로, 끝까지 간 값은 빼고', () => {
  const r = applyFix(byName('워십 패드'), 'brighter');
  assert.ok(r.changes.length >= 2);
  assert.match(r.changes[0].text, /차단 주파수 .+ → .+/);
  assert.equal(r.panel, 'filter');
  const open = normalizePatch({ filter: { cutoff: 18000 }, eq: { high: 12 } });
  assert.deepEqual(applyFix(open, 'brighter').changes, []);
  assert.throws(() => applyFix(open, 'nope'));
});
