// 샘플 악기 창고: 그랜드 피아노(Salamander Grand Piano V3 의 일부)를 처음 칠 때 받아 둔다.
// 30개 음(A0 부터 단3도 간격) × 세기 3층 = 90개 MP3. 음과 세기에 가장 가까운 샘플을 골라 늘려 쓴다.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiOf = (name) => 12 * (Number(name.at(-1)) + 1) + NAMES.indexOf(name.slice(0, -1));

export const LIBRARIES = {
  grand: {
    id: 'grand',
    name: '그랜드 피아노',
    // 이 파일(src/) 기준 위치라, 어느 페이지에서 불러도 같은 곳을 찾는다
    base: new URL('../samples/grand/', import.meta.url).href,
    notes: ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4',
      'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'],
    layers: [4, 9, 14],
    // 녹음 레벨이 낮아 다른 악기와 비슷한 크기로 맞추는 배수
    gain: 2.8,
    // 세기(0..1)가 이 값보다 작으면 그 층
    split: [0.42, 0.72],
    credit: 'Salamander Grand Piano V3 — Alexander Holm, CC-BY 3.0 (sfzinstruments 판에서 30음 × 3층을 골라 줄임)',
  },
};

/** 파일 목록 [{ file, root, layer }] */
export function zoneList(lib) {
  return lib.notes.flatMap((n) => lib.layers.map((v, layer) => ({ file: `${n.replace('#', 's')}v${v}.mp3`, root: midiOf(n), layer })));
}

export function layerFor(lib, velocity) {
  const i = lib.split.findIndex((s) => velocity < s);
  return i < 0 ? lib.split.length : i;
}

/** 이 음·세기에 쓸 샘플 (같은 층에서 기준음이 가장 가까운 것, 같으면 위쪽 = 덜 늘림). */
export function pickZone(zones, lib, midi, velocity) {
  const layer = layerFor(lib, velocity);
  let best = null;
  for (const z of zones) {
    if (z.layer !== layer) continue;
    const d = Math.abs(z.root - midi) - (z.root >= midi ? 0.1 : 0);
    if (!best || d < best.d) best = { z, d };
  }
  return best?.z ?? null;
}

/** 소리가 시작하는 곳 (MP3 앞의 빈 구간을 건너뛴다). 처음으로 threshold 를 넘는 곳의 1 ms 앞. */
export function onsetIndex(channels, sr, threshold = 0.003) {
  const n = channels[0].length;
  for (let i = 0; i < n; i++) {
    for (const ch of channels) {
      if (Math.abs(ch[i]) > threshold) return Math.max(0, i - Math.round(sr * 0.001));
    }
  }
  return 0;
}

/**
 * 받기·풀기를 맡는 창고. decode(arrayBuffer) → AudioBuffer, fetchFile(url) → ArrayBuffer 를 바꿔 끼울 수 있다.
 * get(id): 다 받았으면 [{ buffer, root, layer, start }] 아니면 null. load(id): 받기 시작 (여러 번 불러도 한 번).
 */
export class Library {
  constructor({ decode, fetchFile = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.arrayBuffer(); }), onProgress = () => {} } = {}) {
    this.decode = decode;
    this.fetchFile = fetchFile;
    this.onProgress = onProgress;
    this.ready = new Map();
    this.loading = new Map();
    this.progress = new Map();
  }

  get(id) {
    return this.ready.get(id) ?? null;
  }

  status(id) {
    if (this.ready.has(id)) return { state: 'ready', done: 1, total: 1 };
    const p = this.progress.get(id);
    return p ? { state: p.error ? 'error' : 'loading', ...p } : { state: 'idle', done: 0, total: 0 };
  }

  load(id) {
    if (this.ready.has(id)) return Promise.resolve(this.ready.get(id));
    if (this.loading.has(id)) return this.loading.get(id);
    const lib = LIBRARIES[id];
    const list = zoneList(lib);
    const prog = { done: 0, total: list.length, error: null };
    this.progress.set(id, prog);
    const out = new Array(list.length);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        const z = list[i];
        const buffer = await this.decode(await this.fetchFile(`${lib.base}${z.file}`));
        const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
        out[i] = { ...z, buffer, start: onsetIndex(chans, buffer.sampleRate) / buffer.sampleRate };
        prog.done++;
        this.onProgress(id, prog);
      }
    };
    const job = Promise.all(Array.from({ length: 6 }, worker)).then(() => {
      this.ready.set(id, out);
      this.loading.delete(id);
      this.onProgress(id, prog);
      return out;
    }, (e) => {
      prog.error = e;
      this.loading.delete(id);
      this.onProgress(id, prog);
      throw e;
    });
    this.loading.set(id, job);
    return job;
  }
}
