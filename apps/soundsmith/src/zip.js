// 압축 없는(store) ZIP: SFZ 악기처럼 파일 몇 개를 한 번에 내보낼 때. 한글 파일 이름은 UTF-8 표시를 켠다.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: Uint8Array | string }] -> Uint8Array (.zip) */
export function makeZip(files) {
  const enc = new TextEncoder();
  const entries = files.map((f) => {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    return { name: enc.encode(f.name), data, crc: crc32(data) };
  });
  const localSize = entries.reduce((s, e) => s + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((s, e) => s + 46 + e.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  let o = 0;
  const offsets = [];
  for (const e of entries) {
    offsets.push(o);
    v.setUint32(o, 0x04034b50, true);
    v.setUint16(o + 4, 20, true);
    v.setUint16(o + 6, 0x0800, true);
    v.setUint16(o + 8, 0, true);
    v.setUint32(o + 10, 0, true);
    v.setUint32(o + 14, e.crc, true);
    v.setUint32(o + 18, e.data.length, true);
    v.setUint32(o + 22, e.data.length, true);
    v.setUint16(o + 26, e.name.length, true);
    v.setUint16(o + 28, 0, true);
    out.set(e.name, o + 30);
    out.set(e.data, o + 30 + e.name.length);
    o += 30 + e.name.length + e.data.length;
  }
  const centralStart = o;
  entries.forEach((e, i) => {
    v.setUint32(o, 0x02014b50, true);
    v.setUint16(o + 4, 20, true);
    v.setUint16(o + 6, 20, true);
    v.setUint16(o + 8, 0x0800, true);
    v.setUint16(o + 10, 0, true);
    v.setUint32(o + 12, 0, true);
    v.setUint32(o + 16, e.crc, true);
    v.setUint32(o + 20, e.data.length, true);
    v.setUint32(o + 24, e.data.length, true);
    v.setUint16(o + 28, e.name.length, true);
    v.setUint32(o + 42, offsets[i], true);
    out.set(e.name, o + 46);
    o += 46 + e.name.length;
  });
  v.setUint32(o, 0x06054b50, true);
  v.setUint16(o + 8, entries.length, true);
  v.setUint16(o + 10, entries.length, true);
  v.setUint32(o + 12, o - centralStart, true);
  v.setUint32(o + 16, centralStart, true);
  return out;
}
