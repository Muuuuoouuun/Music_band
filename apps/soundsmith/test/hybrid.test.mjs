import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePatch, normalizeLayer, formatValue, PARAMS, MAX_LAYERS, describePatch } from '../src/patch.js';
import { FACTORY, factoryById } from '../src/presets.js';
import { drawbarGain, drawbarSpectrum, DRAWBAR_HARMONICS, ROTOR } from '../src/fx.js';
import { LIBRARIES, zoneList, pickZone, layerFor, onsetIndex, Library } from '../src/library.js';
import { nextDownbeat, TRANSITIONS } from '../src/fxgen.js';

test('겹치기: 최대 2개, 범위·옥타브·세기를 자르고, 겹친 음색 안에는 다시 겹치지 않는다', () => {
  const p = normalizePatch({
    keys: { lo: 60, hi: 300 },
    layers: [
      { patch: { name: '안쪽', layers: [{ patch: {} }] }, level: 3, octave: 5, lo: -4, hi: 59 },
      { patch: {}, level: 0.4 },
      { patch: {} },
      'junk',
    ],
  });
  assert.equal(p.layers.length, MAX_LAYERS);
  assert.deepEqual(p.keys, { lo: 60, hi: 127 });
  const [a, b] = p.layers;
  assert.equal(a.level, 1);
  assert.equal(a.octave, 2);
  assert.equal(a.lo, 0);
  assert.equal(a.hi, 59);
  assert.deepEqual(a.patch.layers, []);
  assert.equal(a.patch.name, '안쪽');
  assert.equal(b.level, 0.4);
  assert.deepEqual(normalizeLayer({}).patch, normalizePatch({}));
  assert.deepEqual(normalizePatch(JSON.parse(JSON.stringify(p))), p);
});

test('새 값들의 표시: 드로바·비트·건반·피치 엔벨로프·로터리', () => {
  assert.equal(formatValue('organ.bars.0', 8), '8');
  assert.equal(formatValue('fx.bits', 16), '끔');
  assert.equal(formatValue('fx.bits', 12), '12 bit');
  assert.equal(formatValue('keys.lo', 60), 'C4');
  assert.equal(formatValue('keys.hi', 59), 'B3');
  assert.equal(formatValue('pitch.amt', 12), '+12 st');
  assert.equal(formatValue('fx.rotaryFast', true), '켬');
  assert.equal(PARAMS['source'].values.join(), 'synth,pluck,organ,piano,sample');
});

test('기본 음색 42개: id 가 겹치지 않고, 범위 안이고, 겹친 음색은 실제 음색을 가리킨다', () => {
  assert.equal(FACTORY.length, 42);
  assert.equal(new Set(FACTORY.map((f) => f.id)).size, FACTORY.length);
  for (const { patch } of FACTORY) {
    for (const [path, spec] of Object.entries(PARAMS)) {
      const v = path.split('.').reduce((o, k) => o[k], patch);
      if (spec.kind === 'num') assert.ok(v >= spec.min && v <= spec.max, `${patch.name} ${path}=${v}`);
    }
  }
  const hybrids = FACTORY.filter((f) => f.patch.layers.length);
  assert.deepEqual(hybrids.map((f) => f.id), ['piano-pad', 'rhodes-strings', 'organ-pad', 'split-bass-piano']);
  const split = factoryById('split-bass-piano').patch;
  assert.equal(split.keys.lo, 60);
  assert.equal(split.layers[0].hi, 59);
  assert.equal(split.layers[0].patch.name, '무그풍 베이스');
  assert.ok(FACTORY.filter((f) => f.patch.category === 'organ').every((f) => f.patch.source === 'organ'));
  const text = describePatch(factoryById('piano-pad').patch).map((x) => x.text).join('');
  assert.match(text, /피아노예요/);
  assert.match(text, /겹친 음색: 워십 패드\(45%\)/);
  assert.match(describePatch(factoryById('b3-full').patch).map((x) => x.text).join(''), /로터리 스피커가 빠르게/);
});

test('드로바: 한 칸에 3 dB, 0 은 소리 없음, 16′ 기준 배음 자리', () => {
  assert.equal(drawbarGain(0), 0);
  assert.equal(drawbarGain(8), 1);
  assert.ok(Math.abs(20 * Math.log10(drawbarGain(7)) + 3) < 1e-9);
  assert.deepEqual(DRAWBAR_HARMONICS, [1, 3, 2, 4, 6, 8, 10, 12, 16]);
  const spec = drawbarSpectrum([8, 8, 8, 0, 0, 0, 0, 0, 0], 1);
  assert.deepEqual([spec[1], spec[2], spec[3], spec[4]], [1, 1, 1, 0]);
  assert.ok(ROTOR.horn.fast > ROTOR.drum.fast && ROTOR.horn.up < ROTOR.drum.up);
});

test('피아노 샘플: 30음 × 3층 = 90개, 세기로 층을 고르고 가장 가까운 음을 쓴다', () => {
  const lib = LIBRARIES.grand;
  const zones = zoneList(lib);
  assert.equal(zones.length, 90);
  assert.equal(zones[0].file, 'A0v4.mp3');
  assert.ok(zones.some((z) => z.file === 'Ds4v9.mp3' && z.root === 63));
  assert.equal(layerFor(lib, 0.2), 0);
  assert.equal(layerFor(lib, 0.6), 1);
  assert.equal(layerFor(lib, 0.9), 2);
  const z = pickZone(zones, lib, 61, 0.9); // C#4 → C4(60) 또는 D#4(63) 중 가까운 C4
  assert.equal(z.root, 60);
  assert.equal(z.layer, 2);
  assert.equal(pickZone(zones, lib, 108, 0.1).root, 108);
  const ch = new Float32Array(1000);
  ch[441] = 0.5;
  assert.equal(onsetIndex([ch], 44100), 441 - 44);
});

test('창고: 같은 음색을 여러 번 불러도 한 번만 받고, 받은 뒤에는 get 으로 바로', async () => {
  let fetched = 0;
  const lib = new Library({
    fetchFile: async () => { fetched++; return new ArrayBuffer(8); },
    decode: async () => ({ numberOfChannels: 1, sampleRate: 44100, getChannelData: () => Float32Array.from([0, 0, 0.5]) }),
  });
  assert.equal(lib.get('grand'), null);
  const [a, b] = await Promise.all([lib.load('grand'), lib.load('grand')]);
  assert.equal(a, b);
  assert.equal(fetched, 90);
  assert.equal(lib.get('grand').length, 90);
  assert.equal(lib.status('grand').state, 'ready');
});

test('전환 효과음: 다음 마디 첫 박 고르기 (앞서 시작해야 하면 그 뒤 마디)', () => {
  const clk = { t0: 10, beatSec: 0.5, beatsPerBar: 4 };
  assert.equal(nextDownbeat({ ...clk, now: 10.3 }), 12);
  assert.equal(nextDownbeat({ ...clk, now: 11.97 }, 0, 0), 12);
  assert.equal(nextDownbeat({ ...clk, now: 11.97 }), 14); // 0.05초 여유가 없으면 그다음 마디
  assert.equal(nextDownbeat({ ...clk, now: 10.3 }, 4), 16); // 라이저 4초: 12초엔 못 맞춰 16초
  assert.equal(nextDownbeat({ ...clk, now: 5 }), 10); // 아직 시작 전
  assert.deepEqual(TRANSITIONS.map((t) => t.id), ['riser', 'reverse', 'impact', 'down']);
});
