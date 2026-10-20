// 브라우저에서 화면 전체를 눌러 보는 확인: 다섯 화면을 열고, 건반을 치고, 랜덤·변주·되돌리기·섞기·배음 그리기,
// 들어 보기(시험 연주·이펙트 A/B·잔향 꼬리 재기·잔향 종류), 샘플에 이펙트 굽기,
// 음원 따라 만들기(예시 소리 → 닮은 음색·더 비슷하게·톤 입히기·샘플·늘리기), 데모 샘플 루프와 가공,
// 루퍼 재생·녹음, 튜닝 변경을 해 본다. 콘솔 오류가 하나라도 나면 실패.
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
  // 섞기: 지금 음색에서 고른 음색 쪽으로
  await page.selectOption('.morph select', { label: '신스 베이스' });
  await page.locator('.morph input[type=range]').fill('50');
  r.morphName = await page.evaluate(() => window.soundsmith.patch.name);
  // 배음 그리기: 막대를 끌면 오실레이터 1이 직접 그린 파형으로
  const bars = page.locator('.bar-canvas').first();
  await bars.evaluate((el) => el.scrollIntoView({ block: 'center' })); // 아래 붙은 건반에 가리지 않게
  const box = await bars.boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.8, { steps: 6 });
  await page.mouse.up();
  r.drawn = await page.evaluate(() => ({ wave: window.soundsmith.patch.osc[0].wave, h4: window.soundsmith.patch.custom[4] }));
  // 들어 보기: 시험 연주, 이펙트 A/B, 잔향 꼬리 재기, 잔향 종류 바꾸기
  await page.locator('.lib-item', { hasText: '쉬머 패드' }).click();
  await page.click('button:text-is("▶ 한 음")');
  await page.waitForTimeout(150);
  r.phrase = await page.evaluate(() => ({ kind: window.soundsmith.phrase?.kind, voices: window.soundsmith.live.voices.size })); // 놓는 때까지 미리 예약해 두어 '울리는 음' 수로 센다
  await page.click('text=이펙트 끄고 듣기 (A/B)');
  r.bypassOn = await page.evaluate(() => ({ heard: window.soundsmith.live.patch.fx.reverb, saved: window.soundsmith.patch.fx.reverb }));
  await page.click('text=이펙트 끄고 듣기 (A/B)');
  r.bypassOff = await page.evaluate(() => window.soundsmith.live.patch.fx.reverb);
  await page.click('button:text-is("■ 한 음")').catch(() => {});
  await page.waitForFunction(() => window.soundsmith.tail?.() && !window.soundsmith.tail().silent, null, { timeout: 15000 });
  r.tailHall = await page.evaluate(() => window.soundsmith.tail().onset);
  await page.click('.ctl-seg button:text-is("교회")');
  await page.waitForFunction((before) => window.soundsmith.tail()?.onset > before + 0.01, r.tailHall, { timeout: 15000 });
  r.tail = await page.evaluate(() => ({ type: window.soundsmith.patch.fx.reverbType, onset: window.soundsmith.tail().onset, text: document.querySelector('.tail-facts').textContent }));
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
  // 가공: 거꾸로 → 원래대로
  await page.click('button:text-is("거꾸로")');
  await page.waitForFunction(() => window.soundsmith.sample.name.endsWith('거꾸로'), null, { timeout: 5000 }).catch(() => {});
  r.reversed = await page.evaluate(() => window.soundsmith.sample.name);
  await page.click('button:text-is("원래대로")');
  r.restored = await page.evaluate(() => window.soundsmith.sample.name);
  // 녹음한 소리에 지금 음색의 이펙트 굽기 (어쿠스틱 기타 → 룸 잔향)
  const lenBefore = await page.evaluate(() => window.soundsmith.sample.data.length);
  await page.click('text=지금 음색의 이펙트 입히기');
  await page.waitForFunction(() => window.soundsmith.sample.name.endsWith('+이펙트'), null, { timeout: 15000 });
  r.fxSample = await page.evaluate((before) => ({ longer: window.soundsmith.sample.data.length > before, stereo: Boolean(window.soundsmith.sample.stereo) }), lenBefore);
  await page.click('button:text-is("원래대로")');
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
  // 음원 따라 만들기: 예시 첼로 한 음 → 잰 결과 → 닮은 음색 → 더 비슷하게
  await page.click('.tab[data-tab="match"]');
  await page.click('text=예시: 첼로 한 음');
  await page.waitForFunction(() => window.soundsmith.match.state.analysis);
  r.matchKind = await page.textContent('.kind-badge');
  await page.click('text=① 닮은 음색 만들기');
  await page.waitForFunction(() => window.soundsmith.match.state.result && !window.soundsmith.match.state.busy, null, { timeout: 30000 });
  r.made = await page.evaluate(() => ({ score: window.soundsmith.match.state.result.score, wave: window.soundsmith.patch.osc[0].wave, name: window.soundsmith.patch.name }));
  await page.click('.result >> text=▶ 만든 음색');
  await page.waitForTimeout(200);
  await page.click('text=더 비슷하게');
  await page.waitForFunction(() => !window.soundsmith.match.state.busy, null, { timeout: 60000 });
  r.refined = await page.evaluate(() => window.soundsmith.match.state.result.score);
  r.matchOverflow = await overflow();
  if (shots) await page.screenshot({ path: `${shots}/${viewport.name}-match.png`, fullPage: viewport.name === 'desktop' });
  // 예시 화음 → 톤만 입히기 → 샘플로 → 늘리기
  await page.click('text=예시: 패드 화음');
  await page.waitForFunction(() => window.soundsmith.match.state.analysis?.kind !== 'tone' && !window.soundsmith.match.state.busy, null, { timeout: 30000 });
  r.chordKind = await page.evaluate(() => window.soundsmith.match.state.analysis.kind);
  await page.click('text=② 지금 음색에 톤만 입히기');
  await page.waitForFunction(() => !window.soundsmith.match.state.busy, null, { timeout: 30000 });
  r.toned = await page.evaluate(() => ({ name: window.soundsmith.patch.name, eq: window.soundsmith.patch.eq.match.some((v) => v !== 0) }));
  await page.click('text=③ 구간을 샘플로');
  r.regionSample = await page.evaluate(() => ({ source: window.soundsmith.patch.source, len: window.soundsmith.sample.data.length }));
  await page.click('text=④ 앰비언트 패드로 늘리기');
  await page.waitForFunction(() => !window.soundsmith.match.state.busy, null, { timeout: 30000 });
  r.stretched = await page.evaluate(() => ({ seconds: window.soundsmith.sample.data.length / window.soundsmith.sample.sr, loop: window.soundsmith.sample.loopMode, cat: window.soundsmith.patch.category }));
  await page.keyboard.down('d');
  await page.waitForTimeout(150);
  r.padVoice = await page.evaluate(() => window.soundsmith.live.voiceCount);
  await page.keyboard.up('d');
  r.linkState = await page.textContent('.link-state');
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
  if (!r.morphName.includes('×')) bad.push('섞기');
  if (r.phrase.kind !== 'note' || r.phrase.voices < 1) bad.push('시험 연주');
  if (r.bypassOn.heard !== 0 || !(r.bypassOn.saved > 0) || !(r.bypassOff > 0)) bad.push(`이펙트 A/B ${JSON.stringify([r.bypassOn, r.bypassOff])}`);
  if (r.tail.type !== 'church' || !r.tail.text.includes('꼬리 길이')) bad.push('잔향 꼬리 재기');
  if (!r.fxSample.longer || !r.fxSample.stereo) bad.push('샘플에 이펙트 굽기');
  if (r.drawn.wave !== 'custom') bad.push('배음 그리기');
  if (!r.reversed.endsWith('거꾸로') || r.restored.endsWith('거꾸로')) bad.push('샘플 가공');
  if (r.matchKind !== '한 음' || r.made.wave !== 'custom' || r.made.score < 60) bad.push(`닮은 음색 ${JSON.stringify(r.made)}`);
  if (r.refined < r.made.score) bad.push('더 비슷하게');
  if (r.chordKind === 'tone' || !r.toned.eq) bad.push('톤만 입히기');
  if (r.regionSample.source !== 'sample' || r.stretched.seconds < 10 || r.stretched.loop !== 'forward' || r.padVoice < 1) bad.push('샘플·늘리기');
  for (const k of ['synthOverflow', 'samplerOverflow', 'looperOverflow', 'tuningOverflow', 'matchOverflow']) if (r[k] > 0) bad.push(`${k}=${r[k]}`);
  if (bad.length) {
    console.error(name, '실패:', bad.join(', '));
    process.exitCode = 1;
  }
}
await browser.close();
