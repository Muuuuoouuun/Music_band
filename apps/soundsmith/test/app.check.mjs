// 브라우저에서 화면 전체를 눌러 보는 확인: 네 화면을 열고, 건반을 치고, 랜덤·변주·되돌리기,
// 데모 샘플 루프, 루퍼 재생·녹음, 튜닝 변경을 해 본다. 콘솔 오류가 하나라도 나면 실패.
// 실행: npm start 로 서버를 띄운 뒤 node test/app.check.mjs  (SHOTS=폴더 를 주면 화면을 저장)
import { chromium, launchOptions } from './browser.mjs';

const url = process.env.APP_URL || 'http://127.0.0.1:8010/';
const shots = process.env.SHOTS;
const browser = await chromium.launch(launchOptions);
const errors = [];
const results = {};
for (const viewport of [{ width: 1360, height: 900, name: 'desktop' }, { width: 400, height: 860, name: 'phone' }]) {
  const page = await browser.newPage({ viewport });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${viewport.name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${viewport.name}: ${e.message}`));
  await page.goto(url);
  await page.waitForTimeout(400);
  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const r = (results[viewport.name] = {});
  if (shots) await page.screenshot({ path: `${shots}/${viewport.name}-synth.png`, fullPage: viewport.name === 'desktop' });
  r.synthOverflow = await overflow();
  await page.click('#power');
  await page.waitForTimeout(200);
  r.running = await page.evaluate(() => window.soundsmith.studio.running);
  // 건반: 컴퓨터 키보드와 화면 건반
  await page.keyboard.down('a');
  await page.keyboard.down('d');
  await page.waitForTimeout(150);
  r.voicesHeld = await page.evaluate(() => window.soundsmith.live.voiceCount);
  await page.keyboard.up('a');
  await page.keyboard.up('d');
  const key = page.locator('.key.white').nth(4);
  await key.click();
  r.readout = await page.textContent('.dock-readout');
  // 랜덤·변주·되돌리기
  const before = await page.evaluate(() => window.soundsmith.patch.name);
  await page.click('text=랜덤 만들기');
  await page.click('text=변주');
  r.afterRandom = await page.evaluate(() => window.soundsmith.patch.name);
  await page.click('text=되돌리기');
  await page.click('text=되돌리기');
  r.undoBack = (await page.evaluate(() => window.soundsmith.patch.name)) === before;
  // 도우미 슬라이더
  const cutoff0 = await page.evaluate(() => window.soundsmith.patch.filter.cutoff);
  await page.locator('.macro-range').first().fill('900');
  r.macroBrighter = (await page.evaluate(() => window.soundsmith.patch.filter.cutoff)) > cutoff0;
  // 프리셋 고르기
  await page.locator('.lib-item', { hasText: '어쿠스틱 기타' }).click();
  r.source = await page.evaluate(() => window.soundsmith.patch.source);
  await page.keyboard.down('g');
  await page.waitForTimeout(80);
  await page.keyboard.up('g');
  // 샘플러: 데모 소리
  await page.click('.tab[data-tab="sampler"]');
  await page.click('text=데모 소리');
  await page.waitForTimeout(300);
  r.sample = await page.evaluate(() => {
    const s = window.soundsmith.sample;
    return { root: s.rootName, fine: s.fine, mode: s.loopMode, seam: window.soundsmith.bakedSample.seamCost, source: window.soundsmith.patch.source };
  });
  await page.keyboard.down('h');
  await page.waitForTimeout(120);
  r.sampleVoice = await page.evaluate(() => window.soundsmith.live.voiceCount);
  await page.keyboard.up('h');
  r.samplerOverflow = await overflow();
  if (shots) await page.screenshot({ path: `${shots}/${viewport.name}-sampler.png`, fullPage: viewport.name === 'desktop' });
  // 루퍼: 재생, 녹음(카운트 후), 정지
  await page.click('.tab[data-tab="looper"]');
  await page.click('text=▶ 재생');
  await page.waitForTimeout(1200);
  r.looperVoices = await page.evaluate(() => [...document.querySelectorAll('.track')].length);
  r.pos = await page.textContent('.pos');
  r.looperOverflow = await overflow();
  if (shots) await page.screenshot({ path: `${shots}/${viewport.name}-looper.png`, fullPage: viewport.name === 'desktop' });
  // 재생 중에 4번 트랙에 바로 녹음: 두 음을 치고 멈춘 뒤, 실행 취소
  await page.click('.transport-btn.rec');
  for (const k of ['a', 'g']) {
    await page.keyboard.down(k);
    await page.waitForTimeout(250);
    await page.keyboard.up(k);
  }
  await page.click('.transport-btn.rec');
  r.recorded = await page.evaluate(() => window.soundsmith.looper.state.tracks[3].notes.map((n) => n.midi));
  await page.locator('.track').nth(3).locator('text=실행 취소').click();
  r.afterUndo = await page.evaluate(() => window.soundsmith.looper.state.tracks[3].notes.length);
  await page.click('text=■ 정지');
  // 튜닝
  await page.click('.tab[data-tab="tuning"]');
  await page.click('.chip-btn[data-hz="442"]');
  await page.click('.temp-card[data-id="werckmeister3"]');
  r.tuning = await page.evaluate(() => ({ a4: window.soundsmith.tuning.a4, t: window.soundsmith.tuning.temperament, a: window.soundsmith.studio.tuner.freq(69) }));
  await page.click('text=평균율 ↔ 이 튜닝 번갈아 듣기');
  await page.waitForTimeout(300);
  r.tuningOverflow = await overflow();
  if (shots) await page.screenshot({ path: `${shots}/${viewport.name}-tuning.png`, fullPage: viewport.name === 'desktop' });
  await page.close();
}
console.log(JSON.stringify(results, null, 1));
if (errors.length) {
  console.error('콘솔 오류:', errors);
  process.exitCode = 1;
}
for (const [name, r] of Object.entries(results)) {
  const bad = [];
  if (!r.running) bad.push('소리 켜기');
  if (r.voicesHeld < 2) bad.push('두 음 동시');
  if (!r.undoBack) bad.push('되돌리기');
  if (!r.macroBrighter) bad.push('도우미 밝기');
  if (r.source !== 'pluck') bad.push('프리셋');
  if (r.sample?.root !== 'A2' || r.sample.source !== 'sample') bad.push('데모 샘플');
  if (r.sampleVoice < 1) bad.push('샘플 연주');
  if (r.recorded?.join() !== '60,67' || r.afterUndo !== 0) bad.push(`루퍼 녹음 ${r.recorded} / ${r.afterUndo}`);
  if (r.tuning.a !== 442 || r.tuning.t !== 'werckmeister3') bad.push('튜닝');
  for (const k of ['synthOverflow', 'samplerOverflow', 'looperOverflow', 'tuningOverflow']) if (r[k] > 0) bad.push(`${k}=${r[k]}`);
  if (bad.length) {
    console.error(name, '실패:', bad.join(', '));
    process.exitCode = 1;
  }
}
await browser.close();
