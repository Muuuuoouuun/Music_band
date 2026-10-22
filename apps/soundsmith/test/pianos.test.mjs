import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, describePatch, normalizePatch, applyMacro, MACROS, PARAMS, getPath } from '../src/patch.js';
import { FACTORY, factoryById, USES } from '../src/presets.js';

const PIANO_IDS = ['clean-grand', 'blue-vintage', 'pop-keys'];
const IDS_BEFORE = ['worship-pad', 'air-pad', 'swell-strings', 'brass-swell', 'dx-ep', 'church-organ', 'fm-bell', 'glass-bell-pad',
  'synth-bass', 'sub-bass', 'soft-lead', 'digital-pluck', 'acoustic-guitar', 'harp'];

test("'piano' 분류가 있고 합성 피아노 3종이 들어 있다", () => {
  assert.ok(CATEGORIES.some((c) => c.id === 'piano' && c.label === '피아노'));
  for (const id of PIANO_IDS) {
    const f = factoryById(id);
    assert.ok(f, id);
    assert.equal(f.patch.category, 'piano');
    assert.equal(f.patch.source, 'synth', '샘플 없이 합성만');
    assert.equal(f.patch.mono, false, '피아노는 여러 음을 동시에 낸다 (엔진의 mono 는 한 음씩 연주)');
    assert.ok(f.desc.includes('합성'), id);
  }
});

test('기존 기본 음색 id 는 그대로, 순서도 앞쪽 그대로', () => {
  assert.deepEqual(FACTORY.slice(0, IDS_BEFORE.length).map((f) => f.id), IDS_BEFORE);
  assert.equal(new Set(FACTORY.map((f) => f.id)).size, FACTORY.length);
});

test('피아노 3종: 범위 안·JSON 왕복·쓰임새·이름은 풍(오마주) 표기', () => {
  const ok = new Set(USES.map((u) => u.id));
  for (const id of PIANO_IDS) {
    const f = factoryById(id);
    assert.deepEqual(normalizePatch(JSON.parse(JSON.stringify(f.patch))), f.patch);
    assert.ok(f.uses.length && f.uses.every((u) => ok.has(u)));
    assert.match(f.patch.name, /풍/, '상표 이름을 그대로 쓰지 않고 ~풍으로');
    for (const m of MACROS) assert.deepEqual(applyMacro(f.patch, m.id, 0.5), f.patch);
    const text = describePatch(f.patch).map((x) => x.text).join('');
    assert.match(text, /피아노 소리예요/);
    assert.ok(!text.includes('undefined'));
    // 피아노답게: 누르면 줄어드는 소리, 빠른 어택, 높은 음일수록 밝게
    assert.ok(f.patch.ampEnv.a <= 0.005);
    assert.ok(f.patch.ampEnv.s <= 0.05);
    assert.ok(f.patch.filter.keytrack >= 0.5);
  }
});

test('피아노 3종의 성격 차이: 단정한 그랜드 / 어둡고 거친 빈티지 / 밝고 넓은 팝', () => {
  const g = factoryById('clean-grand').patch;
  const b = factoryById('blue-vintage').patch;
  const p = factoryById('pop-keys').patch;
  // 빈티지: 가장 어둡고, 드라이브·테이프 잡음·흔들림이 있고, 거의 모노(코러스 약함)
  assert.ok(b.filter.cutoff < g.filter.cutoff && g.filter.cutoff < p.filter.cutoff);
  assert.ok(b.tone.air < 0 && b.tone.clarity < 0);
  assert.ok(b.fx.drive > g.fx.drive && b.noise > 0 && g.noise === 0 && p.noise === 0);
  assert.ok(b.lfo.depth > 0 && b.lfo.target === 'pitch' && b.lfo.depth < 0.1, '테이프 흔들림은 아주 약하게');
  assert.ok(b.fx.chorus < p.fx.chorus && b.fx.chorus <= 0.2);
  // 그랜드: 효과를 아끼고(코러스 0·드라이브 0) 또렷하게
  assert.equal(g.fx.chorus, 0);
  assert.equal(g.fx.drive, 0);
  assert.ok(g.tone.clarity > 0);
  // 팝: 가장 넓고(코러스·겹치기) 밝다
  assert.ok(p.fx.chorus > g.fx.chorus && p.osc[0].unison > g.osc[0].unison);
  assert.ok(p.tone.air > g.tone.air);
});

test('피아노 배음 모양: 기본음이 가장 크고 위로 갈수록 줄어든다', () => {
  for (const id of PIANO_IDS) {
    const c = factoryById(id).patch.custom;
    assert.equal(c.length, 24);
    assert.equal(Math.max(...c), c[0]);
    assert.ok(c[0] > c[4] && c[4] >= c[12]);
  }
  // 빈티지는 배음이 가장 적고, 팝은 가장 많다 (배음 합)
  const sum = (id) => factoryById(id).patch.custom.reduce((s, v) => s + v, 0);
  assert.ok(sum('blue-vintage') < sum('clean-grand') && sum('clean-grand') < sum('pop-keys'));
  assert.ok(getPath(factoryById('clean-grand').patch, 'osc.0.wave') === 'custom' && PARAMS['osc.0.wave']);
});

// ---------------------------------------------------------------------------
// 로컬 샘플 피아노 (샘플은 저장소에 없다. 이름 읽기·세트 목록·가까운 음 고르기·불러오기 흐름을 검사)
// ---------------------------------------------------------------------------
import { parseSampleName, normalizeSetManifest, pickLayers, pickZone } from '../src/sample.js';
import { loadLocalSet } from '../src/local-samples.js';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('파일 이름에서 음·층 읽기', () => {
  assert.deepEqual(parseSampleName('C4.wav'), { midi: 60, layer: null });
  assert.deepEqual(parseSampleName('F#3.flac'), { midi: 54, layer: null });
  assert.deepEqual(parseSampleName('Bb2.wav'), { midi: 46, layer: null });
  assert.deepEqual(parseSampleName('Ds1v8.flac'), { midi: 27, layer: 8 });
  assert.deepEqual(parseSampleName('A0v1.flac'), { midi: 21, layer: 1 });
  assert.deepEqual(parseSampleName('Woodland_A4_v2.ogg'), { midi: 69, layer: 2 });
  assert.deepEqual(parseSampleName('sub/C-1.wav'), { midi: 0, layer: null });
  assert.deepEqual(parseSampleName('60.wav'), { midi: 60, layer: null });
  assert.equal(parseSampleName('readme.txt'), null);
  assert.equal(parseSampleName('pedalD1.wav'), null);
  assert.equal(parseSampleName('200.wav'), null);
});

test('set.json 검사: 위험한 경로·잘못된 음은 버린다', () => {
  assert.equal(normalizeSetManifest(null), null);
  assert.equal(normalizeSetManifest({ zones: [] }), null);
  const m = normalizeSetManifest({
    name: '  테스트 ', credit: 'c', license: 'l',
    zones: [{ file: 'C4.wav', root: 60 }, { file: '../secret.wav', root: 61 }, { file: '/etc/x.wav', root: 62 }, { file: 'https://x/y.wav', root: 63 }, { file: 'D4.wav', root: 999 }, { file: 'E4.wav', root: 64, layer: 3 }],
  });
  assert.equal(m.name, '테스트');
  assert.deepEqual(m.zones.map((z) => z.file), ['C4.wav', 'E4.wav']);
});

test('같은 음에 층이 여러 개면 가운데 층 하나만, 가까운 녹음을 고른다', () => {
  const zones = [1, 2, 3, 4, 5].flatMap((l) => [{ file: `C4v${l}`, root: 60, layer: l }, { file: `E4v${l}`, root: 64, layer: l }]);
  const picked = pickLayers(zones);
  assert.deepEqual(picked.map((z) => [z.root, z.layer]), [[60, 3], [64, 3]]);
  assert.equal(pickZone(picked, 61).root, 60);
  assert.equal(pickZone(picked, 63).root, 64);
  assert.equal(pickZone(picked, 62).root, 60, '같은 거리면 낮은 쪽');
  assert.equal(pickZone(picked, 20).root, 60);
  assert.equal(pickZone([], 60), null);
});

test('로컬 샘플 불러오기: 폴더가 없으면 null, 있으면 칸마다 기준 주파수가 붙는다', async () => {
  const none = await loadLocalSet('woodland-piano', {}, { fetchFn: async () => ({ ok: false }) });
  assert.equal(none, null);
  assert.equal(await loadLocalSet('../etc', {}, { fetchFn: async () => { throw new Error('호출되면 안 됨'); } }), null);
  assert.equal(await loadLocalSet('x', {}, { fetchFn: async () => { throw new Error('네트워크 없음'); } }), null);
  const files = new Map([
    ['local-samples/t/set.json', JSON.stringify({ name: 'T', credit: '크레딧', license: 'CC BY 3.0', zones: [{ file: 'C4.wav', root: 60 }, { file: 'A4.wav', root: 69 }, { file: 'bad.wav', root: 72 }] })],
    ['local-samples/t/C4.wav', 'c'], ['local-samples/t/A4.wav', 'a'],
  ]);
  const fetchFn = async (url) => (files.has(url)
    ? { ok: true, json: async () => JSON.parse(files.get(url)), arrayBuffer: async () => new TextEncoder().encode(files.get(url)).buffer }
    : { ok: false });
  const ctx = { decodeAudioData: async (ab) => ({ duration: 2, tag: new TextDecoder().decode(ab) }) };
  const progress = [];
  const set = await loadLocalSet('t', ctx, { fetchFn, onProgress: (n, t) => progress.push([n, t]) });
  assert.equal(set.name, 'T');
  assert.equal(set.credit, '크레딧');
  assert.deepEqual(set.sample.zones.map((z) => z.root), [60, 69], '못 읽은 파일(bad.wav)은 건너뛰고 나머지로 연주');
  assert.ok(Math.abs(set.sample.zones[1].rootHz - 440) < 1e-9);
  assert.equal(set.sample.zones[0].end, 2);
  assert.equal(progress.at(-1)[1], 3);
});

test('로컬 샘플 피아노 음색 2종: 샘플 재료이고 로컬 세트를 가리킨다', () => {
  const w = factoryById('woodland-piano-local');
  const s = factoryById('salamander-grand-local');
  assert.equal(w.localSet, 'woodland-piano');
  assert.equal(s.localSet, 'salamander-grand');
  for (const f of [w, s]) {
    assert.equal(f.patch.source, 'sample');
    assert.equal(f.patch.category, 'piano');
    assert.equal(f.patch.ampEnv.s, 1, '샘플이 스스로 줄어드니 서스테인 1');
    assert.match(f.desc, /local-samples/);
  }
  assert.equal(FACTORY.filter((f) => f.localSet).length, 2);
});

test('make-sample-set.mjs: 음 이름이 든 파일로 set.json 을 만든다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-'));
  mkdirSync(join(dir, 'sub'));
  for (const f of ['C4v1.flac', 'C4v2.flac', 'D#4v2.flac', 'sub/A3v2.flac', 'rel5.flac', 'pedalD1.flac', 'notes.txt']) writeFileSync(join(dir, f), 'x');
  const out = execFileSync('node', [new URL('../tools/make-sample-set.mjs', import.meta.url).pathname, dir, '--name', '시험', '--credit', 'cr', '--license', 'CC BY 3.0'], { encoding: 'utf8' });
  assert.match(out, /음 3개/);
  const m = JSON.parse(readFileSync(join(dir, 'set.json'), 'utf8'));
  assert.equal(m.name, '시험');
  assert.deepEqual(m.zones.map((z) => [z.file, z.root, z.layer]), [['sub/A3v2.flac', 57, 2], ['C4v1.flac', 60, 1], ['C4v2.flac', 60, 2], ['D#4v2.flac', 63, 2]]);
  assert.ok(normalizeSetManifest(m));
});

test('샘플 파일은 저장소에 없고 local-samples 는 gitignore 로 막혀 있다', () => {
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /local-samples\/\*/);
  assert.ok(existsSync(new URL('../local-samples/README.md', import.meta.url)));
  const tracked = execFileSync('git', ['ls-files', 'local-samples'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(tracked.every((f) => /README\.md$|\.gitignore$/.test(f)), tracked.join(','));
});
