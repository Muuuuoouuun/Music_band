// 내 컴퓨터의 local-samples/<세트>/ 폴더에 둔 멀티샘플 피아노를 불러온다. 저장소에는 샘플이 없고(.gitignore),
// 폴더가 없으면 조용히 null 을 돌려줘서 앱이 '없어요' 안내만 띄운다. 서버로 보내는 것은 없다 (같은 주소의 파일만 읽음).
import { normalizeSetManifest, pickLayers } from './sample.js';

export const LOCAL_BASE = 'local-samples/';

/**
 * @returns {Promise<null | { id, name, credit, license, sample: { zones } }>}
 * sample.zones 의 각 칸은 엔진의 샘플 한 칸과 같은 모양 { root, buffer, rootHz, start, end, loop } 이다.
 */
export async function loadLocalSet(id, ctx, { base = LOCAL_BASE, fetchFn = (...a) => fetch(...a), onProgress = () => {} } = {}) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) return null;
  let manifest;
  try {
    const res = await fetchFn(`${base}${id}/set.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    manifest = normalizeSetManifest(await res.json());
  } catch {
    return null;
  }
  if (!manifest) return null;
  const chosen = pickLayers(manifest.zones);
  const zones = [];
  let done = 0;
  const queue = chosen.slice();
  const worker = async () => {
    for (let z = queue.shift(); z; z = queue.shift()) {
      try {
        const res = await fetchFn(`${base}${id}/${z.file.split('/').map(encodeURIComponent).join('/')}`);
        if (res.ok) {
          const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
          zones.push({ root: z.root, buffer, rootHz: 440 * 2 ** ((z.root - 69) / 12), start: 0, end: buffer.duration, loop: null });
        }
      } catch { /* 한 파일이 깨져도 나머지로 연주 */ }
      onProgress(++done, chosen.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (!zones.length) return null;
  zones.sort((a, b) => a.root - b.root);
  return { id, name: manifest.name, credit: manifest.credit, license: manifest.license, sample: { zones } };
}
