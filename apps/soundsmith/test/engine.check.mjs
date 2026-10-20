// 브라우저에서 엔진 확인: 기본 음색마다 한 음을 미리 연주(OfflineAudioContext)해서
// 소리가 나는지, 숫자가 깨지지 않는지, 튜닝대로 음높이가 맞는지 본다.
// 실행: npm start 로 서버를 띄운 뒤 node test/engine.check.mjs
import { chromium, launchOptions } from './browser.mjs';

const url = process.env.APP_URL || 'http://127.0.0.1:8010/';
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage();
await page.goto(`${url}test/blank.html`);
const result = await page.evaluate(async () => {
  const { renderNote } = await import('/src/engine.js');
  const { FACTORY } = await import('/src/presets.js');
  const { detectPitch, demoSample, findLoop } = await import('/src/sample.js');
  const out = [];
  for (const { patch } of FACTORY) {
    const buf = await renderNote(patch, { midi: patch.category === 'bass' ? 45 : 57, seconds: 2.5, hold: 1.5 });
    const x = buf.getChannelData(0);
    let peak = 0;
    let bad = 0;
    for (const v of x) { if (!Number.isFinite(v)) bad++; peak = Math.max(peak, Math.abs(v)); }
    const pitch = detectPitch(x, buf.sampleRate, { start: Math.round(0.2 * buf.sampleRate), end: Math.round(1.4 * buf.sampleRate) });
    out.push({ name: patch.name, peak: +peak.toFixed(3), bad, hz: pitch ? +pitch.hz.toFixed(1) : null });
  }
  // 튜닝: A4=432 로 사인 한 음
  const { normalizePatch } = await import('/src/patch.js');
  const sine = normalizePatch({ osc: [{ wave: 'sine', level: 0.8 }], fx: { reverb: 0 } });
  const t432 = await renderNote(sine, { midi: 69, seconds: 1, hold: 0.9, tuning: { a4: 432 } });
  const p432 = detectPitch(t432.getChannelData(0), 44100);
  const just = await renderNote(sine, { midi: 64, seconds: 1, hold: 0.9, tuning: { temperament: 'just', root: 0 } });
  const pJust = detectPitch(just.getChannelData(0), 44100);
  // 샘플 악기: 데모 소리(A2)를 루프로 걸고 A3 를 연주
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const data = demoSample(44100);
  const loop = findLoop(data, 44100, { hz: 110 });
  const b = ctx.createBuffer(1, data.length, 44100);
  b.copyToChannel(data, 0);
  const sampleBuf = await renderNote(normalizePatch({ source: 'sample', ampEnv: { a: 0.01, s: 1, r: 0.2 }, fx: { reverb: 0 } }), {
    midi: 57, seconds: 4, hold: 3.8,
    sample: { buffer: b, rootHz: 110, start: 0, end: data.length / 44100, loop: { start: loop.loopStart / 44100, end: loop.loopEnd / 44100 } },
  });
  const sx = sampleBuf.getChannelData(0);
  const late = detectPitch(sx, 44100, { start: Math.round(2.5 * 44100), end: Math.round(3.6 * 44100) });
  let latePeak = 0;
  for (let i = Math.round(3 * 44100); i < Math.round(3.6 * 44100); i++) latePeak = Math.max(latePeak, Math.abs(sx[i]));
  // 새 엔진 기능: 스테레오 폭 0 이면 좌우가 같고, 직접 그린 파형도 음높이가 맞고, 24dB·쉬머·로파이가 숫자를 깨지 않는다
  const stat = (buf) => {
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    let side = 0;
    let mid = 0;
    let bad = 0;
    for (let i = 0; i < L.length; i++) { side += (L[i] - R[i]) ** 2; mid += (L[i] + R[i]) ** 2; if (!Number.isFinite(L[i] + R[i])) bad++; }
    return { side: side / (mid || 1), bad };
  };
  const wideBase = { osc: [{ wave: 'sawtooth', unison: 5, spread: 20 }] };
  const narrow = stat(await renderNote(normalizePatch({ ...wideBase, fx: { width: 0 } }), { midi: 57, seconds: 1.5, hold: 1, dry: false }));
  const wide = stat(await renderNote(normalizePatch({ ...wideBase, fx: { width: 2 } }), { midi: 57, seconds: 1.5, hold: 1, dry: false }));
  const custom = normalizePatch({ osc: [{ wave: 'custom' }], custom: Array.from({ length: 128 }, (_, i) => (i < 12 ? 1 / (i + 1) : 0)), fx: { reverb: 0 } });
  const pCustom = detectPitch((await renderNote(custom, { midi: 60, seconds: 1, hold: 0.9 })).getChannelData(0), 44100);
  const heavy = stat(await renderNote(normalizePatch({ ...wideBase, filter: { slope: 24, q: 8, cutoff: 900 }, fx: { shimmer: 1, lofi: 1, phaser: 1, comp: 1, reverb: 0.6 }, drift: 1, click: 1, eq: { low: 12, high: 12, match: Array(10).fill(15) } }), { notes: [48, 55, 64], seconds: 2, hold: 1.5, dry: false }));
  // 음원 따라 만들기: 기본 음색 소리를 듣고 그 음색을 빼고 만들어도 닮게
  const { analyzeAudio } = await import('/src/analyze.js');
  const { matchSound } = await import('/src/matcher.js');
  const matches = [];
  for (const name of ['첼로 앙상블', '어쿠스틱 기타', '무그 베이스']) {
    const preset = FACTORY.find((f) => f.patch.name === name).patch;
    const buf = await renderNote(preset, { midi: preset.category === 'bass' ? 45 : 57, seconds: 3, hold: 2.2, dry: false });
    const ref = analyzeAudio([buf.getChannelData(0), buf.getChannelData(1)], 44100);
    const res = await matchSound(ref, FACTORY.filter((f) => f.patch.name !== name), { name: 'x' });
    matches.push({ name, kind: ref.kind, score: res.score });
  }
  return { out, a432: p432?.hz, justE: pJust?.hz, sampleLateHz: late?.hz, latePeak, narrow, wide, customHz: pCustom?.hz, heavy, matches };
});
console.table(result.out);
// C 순정률 + A4=440 고정이면 C4=264, E4=330 Hz (C 와 5/4)
console.log({ a432: result.a432, justE4: result.justE, sampleLoopA3: result.sampleLateHz, latePeak: result.latePeak });
if (Math.abs(result.justE - 330) > 1) { console.error('순정률 E4 가 330 Hz 아님'); process.exitCode = 1; }
if (Math.abs(result.sampleLateHz - 220) > 1 || result.latePeak < 0.05) { console.error('샘플 루프가 A3 로 이어지지 않음'); process.exitCode = 1; }
const fails = result.out.filter((r) => r.bad || r.peak < 0.02 || r.peak > 1.2);
if (fails.length) { console.error('문제 있는 음색', fails); process.exitCode = 1; }
if (Math.abs(result.a432 - 432) > 1.5) { console.error('A4=432 아님'); process.exitCode = 1; }
console.log({ narrowSide: result.narrow.side, wideSide: result.wide.side, customHz: result.customHz, heavyBad: result.heavy.bad });
console.table(result.matches);
if (result.narrow.side > 0.002 || result.wide.side < 0.2) { console.error('스테레오 폭이 맞지 않음'); process.exitCode = 1; }
if (Math.abs(result.customHz - 261.63) > 1.5) { console.error('직접 그린 파형 음높이가 C4 아님'); process.exitCode = 1; }
if (result.heavy.bad) { console.error('이펙트를 모두 올리면 숫자가 깨짐'); process.exitCode = 1; }
for (const m of result.matches) if (m.kind !== 'tone' || m.score < 80) { console.error('닮은 음색이 덜 닮음', m); process.exitCode = 1; }
await browser.close();
