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
  return { out, a432: p432?.hz, justE: pJust?.hz, sampleLateHz: late?.hz, latePeak };
});
console.table(result.out);
// C 순정률 + A4=440 고정이면 C4=264, E4=330 Hz (C 와 5/4)
console.log({ a432: result.a432, justE4: result.justE, sampleLoopA3: result.sampleLateHz, latePeak: result.latePeak });
if (Math.abs(result.justE - 330) > 1) { console.error('순정률 E4 가 330 Hz 아님'); process.exitCode = 1; }
if (Math.abs(result.sampleLateHz - 220) > 1 || result.latePeak < 0.05) { console.error('샘플 루프가 A3 로 이어지지 않음'); process.exitCode = 1; }
const fails = result.out.filter((r) => r.bad || r.peak < 0.02 || r.peak > 1.2);
if (fails.length) { console.error('문제 있는 음색', fails); process.exitCode = 1; }
if (Math.abs(result.a432 - 432) > 1.5) { console.error('A4=432 아님'); process.exitCode = 1; }
await browser.close();
