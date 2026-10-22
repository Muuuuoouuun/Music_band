// 브라우저에서 엔진 확인: 기본 음색마다 한 음을 미리 연주(OfflineAudioContext)해서
// 소리가 나는지, 숫자가 깨지지 않는지, 튜닝대로 음높이가 맞는지, 톤 EQ 가 계산대로 걸리는지 본다.
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
    if (patch.source === 'sample') continue; // 로컬 샘플 피아노는 샘플이 있어야 소리가 난다 (local-samples/)
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
  // 톤 EQ: 엔진의 필터 응답이 화면이 그리는 계산과 같고, 공기를 올리면 잰 공기 대역이 커진다
  const { toneResponse, analyzeTone } = await import('/src/tone.js');
  const { Instrument } = await import('/src/engine.js');
  const tone = { deep: 3, bass: -4, mud: 2.5, body: -1.5, clarity: 5, air: 6, lowcut: 120 };
  const octx = new OfflineAudioContext(1, 128, 44100);
  const env = { ctx: octx, out: octx.destination, tuner: null, bpm: () => 72, irFor: () => octx.createBuffer(2, 64, 44100) };
  const inst = new Instrument(env, normalizePatch({ tone }));
  const freqs = new Float32Array([30, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 14000]);
  const total = new Float32Array(freqs.length);
  const mag = new Float32Array(freqs.length);
  const ph = new Float32Array(freqs.length);
  // setPatch 는 값을 부드럽게 옮기므로, 끝 값을 그대로 넣고 잰다
  const { toneFilters } = await import('/src/tone.js');
  toneFilters(tone).forEach((tf, i) => { inst.eq[i].frequency.value = tf.f; inst.eq[i].gain.value = tf.gain; });
  for (const f of inst.eq) {
    f.getFrequencyResponse(freqs, mag, ph);
    mag.forEach((m, i) => { total[i] += 20 * Math.log10(m); });
  }
  const calc = toneResponse(tone, [...freqs], 44100);
  const eqErr = Math.max(...calc.map((c, i) => Math.abs(c - total[i])));
  const pad = FACTORY.find((f) => f.id === 'worship-pad').patch;
  const measure = async (p) => {
    const b = await renderNote(p, { midi: [48, 55, 60, 64, 67], seconds: 4, hold: 3.7 });
    return analyzeTone([b.getChannelData(0), b.getChannelData(1)], 44100);
  };
  const flatAir = (await measure(pad)).bands[5];
  const upAir = (await measure({ ...pad, tone: { ...pad.tone, air: 12 } })).bands[5];
  return { out, a432: p432?.hz, justE: pJust?.hz, sampleLateHz: late?.hz, latePeak, eqErr, flatAir, upAir };
});
console.table(result.out);
// C 순정률 + A4=440 고정이면 C4=264, E4=330 Hz (C 와 5/4)
console.log({ a432: result.a432, justE4: result.justE, sampleLoopA3: result.sampleLateHz, latePeak: result.latePeak, eqErr: result.eqErr, flatAir: result.flatAir, upAir: result.upAir });
if (!(result.eqErr < 0.05)) { console.error('톤 EQ 응답이 계산과 다름', result.eqErr); process.exitCode = 1; }
if (!(result.upAir > result.flatAir + 4)) { console.error('공기 +12 dB 가 잰 값에 안 보임'); process.exitCode = 1; }
if (Math.abs(result.justE - 330) > 1) { console.error('순정률 E4 가 330 Hz 아님'); process.exitCode = 1; }
if (Math.abs(result.sampleLateHz - 220) > 1 || result.latePeak < 0.05) { console.error('샘플 루프가 A3 로 이어지지 않음'); process.exitCode = 1; }
const fails = result.out.filter((r) => r.bad || r.peak < 0.02 || r.peak > 1.2);
if (fails.length) { console.error('문제 있는 음색', fails); process.exitCode = 1; }
if (Math.abs(result.a432 - 432) > 1.5) { console.error('A4=432 아님'); process.exitCode = 1; }
await browser.close();
