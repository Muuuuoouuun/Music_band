import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, makeZip } from '../src/zip.js';

test('CRC32 표준 값', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('파이썬 zipfile 로 열리고 한글 이름이 그대로', () => {
  const zip = makeZip([{ name: '첼로.sfz', data: '<region>\n' }, { name: '첼로.wav', data: new Uint8Array([1, 2, 3]) }]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 'a.zip');
  writeFileSync(file, zip);
  const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.namelist(), z.read("첼로.wav"))', file]).toString();
  assert.match(out, /첼로\.sfz/);
  assert.match(out, /x01\\x02\\x03/);
});
