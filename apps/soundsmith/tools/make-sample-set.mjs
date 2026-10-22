#!/usr/bin/env node
// local-samples/<세트>/ 폴더의 오디오 파일 이름(C4.wav · F#3.flac · Ds1v8.flac · 60.wav …)을 읽어 set.json 을 만든다.
//   node tools/make-sample-set.mjs local-samples/woodland-piano --name "우드랜드 피아노" --credit "ockpii · Woodland Piano" --license "개인 사용"
import { readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseSampleName, pickLayers } from '../src/sample.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : '';
};
if (!dir) {
  console.error('사용법: node tools/make-sample-set.mjs <폴더> [--name 이름] [--credit 크레딧] [--license 라이선스]');
  process.exit(1);
}
const root = resolve(dir);
const AUDIO = /\.(wav|flac|ogg|mp3|m4a)$/i;
// 릴리즈 트리거·페달·해머 소리 등 '누른 음'이 아닌 파일은 뺀다
const SKIP = /(rel|release|pedal|harm|hammer|noise|res)/i;

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const zones = [];
const skipped = [];
for (const file of walk(root).filter((f) => AUDIO.test(f))) {
  const rel = relative(root, file).split('\\').join('/');
  const name = rel.split('/').pop();
  const parsed = SKIP.test(name) ? null : parseSampleName(name);
  if (!parsed) { skipped.push(rel); continue; }
  zones.push({ file: rel, root: parsed.midi, ...(parsed.layer != null ? { layer: parsed.layer } : {}) });
}
if (!zones.length) {
  console.error('음 이름을 읽을 수 있는 오디오 파일이 없어요. 파일 이름에 C4, F#3, Bb2 같은 음 이름이 들어 있어야 해요.');
  process.exit(1);
}
zones.sort((a, b) => a.root - b.root || (a.layer ?? 0) - (b.layer ?? 0));
const manifest = { v: 1, name: opt('name') || root.split('/').pop(), credit: opt('credit'), license: opt('license'), zones };
writeFileSync(join(root, 'set.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const used = pickLayers(zones);
console.log(`set.json 저장: 파일 ${zones.length}개 중 음 ${used.length}개를 쓴다 (${used[0].root}~${used.at(-1).root}).`);
if (skipped.length) console.log(`건너뜀 ${skipped.length}개: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ' …' : ''}`);
