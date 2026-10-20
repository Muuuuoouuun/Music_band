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
  // 잔향·딜레이 시험: 짧은 소리를 넣어 젖은 소리를 잰다
  const { renderTail, renderThroughFx } = await import('/src/engine.js');
  const { tailStats } = await import('/src/analyze.js');
  const tail = async (fx) => {
    const r = await renderTail(normalizePatch({ fx }));
    const ch = (b) => [b.getChannelData(0), b.getChannelData(1)];
    const st = tailStats(ch(r.full), ch(r.dry), 44100, { start: r.start });
    return { rt60: st.rt60, onset: st.onset, wetDb: st.wetDb, width: st.width, echoes: st.echoes.slice(0, 4).map((e) => ({ t: e.t, side: e.left - e.right })), bad: [...r.full.getChannelData(0)].filter((v) => !Number.isFinite(v)).length };
  };
  const fx = {
    quiet: await tail({ reverb: 0.2, size: 3 }),
    loud: await tail({ reverb: 0.8, size: 3 }),
    short: await tail({ reverb: 0.5, size: 1 }),
    long: await tail({ reverb: 0.5, size: 6 }),
    pre: await tail({ reverb: 0.5, size: 3, predelay: 0.12 }),
    pingpong: await tail({ reverb: 0, delay: 0.6, feedback: 0.5, delayBeats: 0.5, delayMode: 'pingpong' }),
    mono: await tail({ reverb: 0, delay: 0.6, feedback: 0.5, delayBeats: 0.5 }),
    tape: await tail({ reverb: 0, delay: 0.6, feedback: 0.85, delayBeats: 0.5, delayMode: 'tape' }),
  };
  const { REVERB_TYPES } = await import('/src/patch.js');
  for (const t of REVERB_TYPES) fx[t.id] = await tail({ reverb: 0.5, size: 2.5, reverbType: t.id });
  // 녹음한 소리에 이펙트 굽기: 데모 첼로 + 교회 잔향 → 꼬리가 붙어 길어진다
  const demo = demoSample(44100, 1.5);
  const wetBuf = await renderThroughFx(normalizePatch({ fx: { reverb: 0.7, size: 3, reverbType: 'church' } }), [demo], 44100);
  const wl = wetBuf.getChannelData(0);
  let tailE = 0;
  for (let i = demo.length + 4410; i < wl.length; i++) tailE += wl[i] * wl[i];
  const throughFx = { seconds: wetBuf.length / 44100, tailE, bad: [...wl].filter((v) => !Number.isFinite(v)).length };
  return { out, a432: p432?.hz, justE: pJust?.hz, sampleLateHz: late?.hz, latePeak, narrow, wide, customHz: pCustom?.hz, heavy, matches, fx, throughFx };
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
const f = result.fx;
console.table(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { rt60: v.rt60?.toFixed(2), onsetMs: v.onset != null ? Math.round(v.onset * 1000) : null, wetDb: v.wetDb?.toFixed(1), width: v.width.toFixed(2), echoes: v.echoes.map((e) => `${e.t.toFixed(2)}s/${e.side.toFixed(0)}dB`).join(' ') }])));
console.log('이펙트 굽기', result.throughFx);
const fail = (msg) => { console.error(msg); process.exitCode = 1; };
if (f.loud.wetDb - f.quiet.wetDb < 10) fail('잔향 양을 올려도 젖은 소리가 커지지 않음');
if (f.long.rt60 / f.short.rt60 < 4) fail('잔향 길이가 꼬리 길이(RT60)를 바꾸지 않음');
if (Math.abs(f.pre.onset - f.quiet.onset - 0.1) > 0.015) fail('프리딜레이만큼 늦게 시작하지 않음');
if (!f.pingpong.echoes.slice(0, 3).every((e, i) => (i % 2 ? e.side < -10 : e.side > 10))) fail('핑퐁이 좌우를 번갈아 가지 않음');
if (!f.mono.echoes.slice(0, 3).every((e) => Math.abs(e.side) < 3)) fail('가운데 딜레이가 한쪽으로 치우침');
if (Math.abs(f.mono.echoes[0].t - 60 / 72 / 2) > 0.012) fail('딜레이 간격이 BPM 72 의 8분음표가 아님');
if (f.tape.wetDb > 0 || f.tape.bad) fail('테이프 딜레이 되먹임이 커짐');
for (const t of ['room', 'hall', 'church', 'plate', 'spring', 'ambient']) if (f[t].bad || !(f[t].rt60 > 1.4 && f[t].rt60 < 2.6)) fail(`잔향 ${t} 꼬리가 이상함`);
if (!(f.plate.onset < f.hall.onset && f.hall.onset < f.church.onset)) fail('잔향 종류의 시작 순서가 다름');
const tf = result.throughFx;
if (tf.bad || tf.seconds < 1.5 + 3 || tf.tailE < 1e-4) fail('녹음한 소리에 이펙트 굽기가 꼬리를 만들지 않음');
await browser.close();
