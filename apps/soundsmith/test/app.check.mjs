// 브라우저에서 화면 전체를 눌러 보는 확인 (데스크톱·휴대폰 크기):
// 예배 무대(패드·숫자 키·밝기×공간 판·다음 곡·루퍼 줄), 실험실(쓰임새·카드·도우미·배음 그리기·필터 끌기·
// 패드/루퍼로 보내기), 샘플러 데모, 루퍼 녹음·실행 취소, 톤 맞추기(재기·노브·말 버튼·톤 곡선 끌기·A/B·방·
// 다른 음색을 레퍼런스로·제안대로 맞추기·톤 기록), 음 높이 자세히(튜닝), 오르간 드로바·겹치기·나누기·피아노 샘플,
// 무대의 로터리·전환 효과음·드론, 반주 만들기, 샘플 패드(데모 비트·패드·패턴·로파이). 콘솔 오류나 가로 넘침이 있으면 실패.
// 실행: npm start 로 서버를 띄운 뒤 node test/app.check.mjs  (SHOTS=폴더 를 주면 화면을 저장)
import { chromium, launchOptions } from './browser.mjs';

const url = process.env.APP_URL || 'http://127.0.0.1:8010/';
const shots = process.env.SHOTS;
const browser = await chromium.launch(launchOptions);
const errors = [];
const results = {};
// 끌기 전에 화면 가운데로 (아래 건반 띠에 가리지 않게)
const boxOf = async (page, sel) => {
  await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  return page.locator(sel).first().boundingBox();
};
// 시험용 음원: 8초짜리 스테레오 WAV (밝은 노이즈 + 화음)
function testWav(seconds = 8, sr = 22050) {
  const n = seconds * sr;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  let seed = 3;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 0.15 * (seed / 2 ** 32 - 0.5) + 0.2 * Math.sin((2 * Math.PI * 262 * i) / sr) + 0.15 * Math.sin((2 * Math.PI * 392 * i) / sr);
    const q = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
    buf.writeInt16LE(q, 44 + i * 4);
    buf.writeInt16LE(q, 46 + i * 4);
  }
  return buf;
}

const S = (page) => page.evaluate(() => {
  const a = window.soundsmith;
  return { presetId: a.presetId, name: a.patch.name, cutoff: a.patch.filter.cutoff, reverb: a.patch.fx.reverb, q: a.patch.filter.q, wave0: a.patch.osc[0].wave, transpose: a.tuning.transpose, voices: a.live?.voiceCount ?? 0, sounding: a.live?.voices.size ?? 0, hold: a.keyboard.hold };
});

for (const viewport of [{ width: 1360, height: 900, name: 'desktop' }, { width: 400, height: 860, name: 'phone' }]) {
  const page = await browser.newPage({ viewport });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${viewport.name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${viewport.name}: ${e.message}`));
  await page.goto(url);
  await page.waitForTimeout(400);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const shot = async (name) => shots && page.screenshot({ path: `${shots}/${viewport.name}-${name}.png`, fullPage: viewport.name === 'desktop' });
  const r = (results[viewport.name] = {});

  // ---- 예배 무대 ----
  r.startTab = await page.evaluate(() => window.soundsmith.tab);
  await shot('stage');
  r.stageOverflow = await overflow();
  await page.click('#power');
  await page.waitForTimeout(200);
  r.running = await page.evaluate(() => window.soundsmith.studio.running);
  await page.keyboard.down('a');
  await page.keyboard.down('d');
  await page.waitForTimeout(150);
  r.voicesHeld = (await S(page)).voices;
  await page.keyboard.up('a');
  await page.keyboard.up('d');
  await page.keyboard.press('4');
  r.digit4 = (await S(page)).presetId;
  await page.locator('.pad', { hasText: '교회 오르간' }).click();
  r.padClick = (await S(page)).presetId;
  const before = await S(page);
  const box = await boxOf(page, '.xy');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.15, { steps: 6 });
  await page.mouse.up();
  const after = await S(page);
  r.xyBrighter = after.cutoff > before.cutoff && after.reverb > before.reverb && after.presetId === 'church-organ';
  await page.click('text=다음 곡 ▶');
  r.nextSong = (await S(page)).presetId;
  await page.click('.stage-btn.big >> text=패드 홀드');
  r.hold = (await S(page)).hold;
  await page.click('.stage-btn.big >> text=패드 홀드');
  await page.click('.strip .strip-btn >> nth=0');
  await page.waitForTimeout(700);
  r.stripPlaying = await page.evaluate(() => window.soundsmith.looper.info().playing);
  await page.click('.strip .strip-btn >> nth=0');
  await page.click('text=세트 편집');
  await page.fill('.set-add .text-input', '주 은혜임을');
  await page.click('text=지금 음색으로 추가');
  r.songs = await page.locator('.song').count();
  r.setOverflow = await overflow();
  await page.click('text=세트 편집');

  // ---- 실험실 ----
  await page.click('.tab[data-tab="lab"]');
  await page.locator('.use-chip', { hasText: '기도회·묵상' }).click();
  r.prayerCards = await page.locator('.card').count();
  await page.locator('.card', { hasText: '공기 패드' }).click();
  r.cardPick = (await S(page)).presetId;
  r.summary = await page.textContent('.summary');
  await page.locator('.use-chip', { hasText: '전체' }).click();
  await shot('lab');
  r.labOverflow = await overflow();
  const c0 = (await S(page)).cutoff;
  await page.locator('.macro-knob').first().focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('PageUp');
  r.macroBrighter = (await S(page)).cutoff > c0;
  const n0 = (await S(page)).name;
  await page.click('text=랜덤 만들기');
  await page.click('text=변주');
  await page.click('.lab-shape >> text=되돌리기');
  await page.click('.lab-shape >> text=되돌리기');
  r.undoBack = (await S(page)).name === n0 && (await S(page)).presetId === 'air-pad';
  await page.click('text=C 코드로 들어 보기');
  await page.waitForTimeout(200);
  r.audition = (await S(page)).sounding;
  // 배음 그리기
  await page.locator('.flow-node').filter({ has: page.locator('.flow-title:text-is("오실레이터 1")') }).click();
  const hb = await boxOf(page, '.harm-canvas');
  await page.mouse.move(hb.x + hb.width * 0.3, hb.y + hb.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width * 0.6, hb.y + hb.height * 0.2, { steps: 5 });
  await page.mouse.up();
  r.wave0 = (await S(page)).wave0;
  await shot('lab-draw');
  // 필터 끌기
  await page.locator('.flow-node').filter({ has: page.locator('.flow-title:text-is("필터")') }).click();
  const fb = await boxOf(page, '.graph-canvas');
  const f0 = await S(page);
  await page.mouse.move(fb.x + fb.width * 0.5, fb.y + fb.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(fb.x + fb.width * 0.8, fb.y + fb.height * 0.2, { steps: 4 });
  await page.mouse.up();
  const f1 = await S(page);
  r.filterDrag = f1.cutoff !== f0.cutoff && f1.q > f0.q;
  // 노브: 위로 끌면 커지고, 두 번 누르면 고른 음색의 값으로
  const kn = page.getByRole('slider', { name: '차단 주파수' });
  await kn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const kb = await kn.boundingBox();
  const k0 = (await S(page)).cutoff;
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  const k1 = (await S(page)).cutoff;
  await kn.dblclick();
  const k2 = (await S(page)).cutoff;
  const presetCutoff = await page.evaluate(() => window.soundsmith.findPreset(window.soundsmith.presetId)?.patch.filter.cutoff ?? null);
  r.knob = { up: k1 > k0, reset: presetCutoff == null || Math.abs(k2 - presetCutoff) < 1e-6 };
  r.labDetailOverflow = await overflow();
  // 오르간 드로바 (키보드로 한 칸)
  await page.locator('.kind-chip[data-kind="organ"]').click();
  r.organCards = await page.locator('.card').count();
  await page.locator('.card', { hasText: '가스펠 오르간' }).click();
  await page.locator('.flow-node').filter({ has: page.locator('.flow-title:text-is("오르간 드로바")') }).click();
  await page.getByRole('slider', { name: '드로바 4′' }).focus();
  await page.keyboard.press('ArrowDown');
  r.bars = await page.evaluate(() => window.soundsmith.patch.organ.bars.join(''));
  r.organOverflow = await overflow();
  // 겹치기·나누기
  await page.locator('.flow-node').filter({ has: page.locator('.flow-title:text-is("겹치기·나누기")') }).click();
  await page.click('text=+ 워십 패드 깔기');
  await page.click('text=왼손 베이스로 나누기 (C4)');
  r.layers = await page.evaluate(() => `${window.soundsmith.patch.keys.lo}|${window.soundsmith.patch.layers.map((l) => `${l.patch.name}:${l.lo}-${l.hi}`).join(',')}`);
  await shot('lab-layers');
  r.layersOverflow = await overflow();
  await page.click('text=겹침·나누기 모두 풀기');
  await page.locator('.kind-chip[data-kind="all"]').click();
  // 패드·루퍼로 보내기
  await page.click('text=무대 패드에 올리기');
  r.padAssigned = await page.evaluate(() => window.soundsmith.stage.pads[0].startsWith('u'));
  await page.click('text=루퍼로 보내기');
  r.trackSound = await page.evaluate(() => window.soundsmith.looper.state.tracks[3].sound?.label === window.soundsmith.patch.name);

  // ---- 샘플러 (실험실의 '샘플' 상자) ----
  await page.locator('.lab-detail .seg-btn', { hasText: /^샘플$/ }).click();
  await page.click('text=데모 소리');
  await page.waitForTimeout(300);
  r.sample = await page.evaluate(() => ({ root: window.soundsmith.sample.rootName, source: window.soundsmith.patch.source }));
  await page.keyboard.down('h');
  await page.waitForTimeout(120);
  r.sampleVoice = (await S(page)).voices;
  await page.keyboard.up('h');
  r.samplerOverflow = await overflow();
  await shot('sampler');

  // ---- 루퍼 (예배 무대에서 펼치기) ----
  await page.click('.tab[data-tab="stage"]');
  await page.click('text=트랙 펼치기 ▾');
  await page.click('.looper-slot >> text=▶ 재생');
  await page.waitForTimeout(900);
  await page.click('.looper-slot .transport-btn.rec');
  for (const k of ['a', 'g']) {
    await page.keyboard.down(k);
    await page.waitForTimeout(250);
    await page.keyboard.up(k);
  }
  await page.click('.looper-slot .transport-btn.rec');
  r.recorded = await page.evaluate(() => window.soundsmith.looper.state.tracks[3].notes.map((n) => n.midi).join());
  await page.locator('.track').nth(3).locator('text=실행 취소').click();
  r.afterUndo = await page.evaluate(() => window.soundsmith.looper.state.tracks[3].notes.length);
  r.looperOverflow = await overflow();
  await shot('looper');
  await page.click('.looper-slot >> text=■ 정지');
  // 반주 만들기
  await page.click('.arranger summary');
  await page.fill('.chart-input', '| C | G/B | Am7 | Fadd9 | F | C/E | Dm7 | Gsus4 |');
  await page.click('text=트랙에 넣기');
  r.arr = await page.evaluate(() => { const i = window.soundsmith.looper.info(); return `${i.clock.bars}|${i.tracks[1].notes.length > 20}|${i.tracks[1].sound.label}|${i.lifts.join()}`; });
  r.arrangerOverflow = await overflow();
  await page.click('text=한 줄로 접기 ▴');
  r.tabs = await page.locator('.tab').count();
  // 로터리·전환·드론
  await page.evaluate(() => window.soundsmith.loadPreset(window.soundsmith.findPreset('gospel-organ')));
  await page.locator('.rotary-btn').click();
  r.rotary = await page.evaluate(() => window.soundsmith.patch.fx.rotaryFast);
  await page.click('.fx-btn[data-fx="impact"]');
  await page.waitForTimeout(300);
  r.fxState = await page.textContent('.fx-state');
  await page.click('.drone-btn');
  await page.waitForTimeout(150);
  r.drone = await page.evaluate(() => window.soundsmith.stage.drone()?.voices ?? 0);
  await page.click('.drone-btn');
  await shot('stage-fx');
  r.fxOverflow = await overflow();
  // 피아노 샘플 (받아서 소리 나는지)
  await page.evaluate(() => window.soundsmith.loadPreset(window.soundsmith.findPreset('grand-piano')));
  await page.waitForFunction(() => window.soundsmith.studio.library.status('grand').state === 'ready', null, { timeout: 30000 });
  await page.keyboard.down('h');
  await page.waitForTimeout(120);
  r.pianoVoices = (await S(page)).voices;
  await page.keyboard.up('h');

  // ---- 샘플 패드 ----
  await page.click('.tab[data-tab="pads"]');
  await page.waitForTimeout(200);
  r.padsSlices = await page.evaluate(() => window.soundsmith.pads.info().slices);
  await page.locator('.mpc-pad[data-pad="1"]').dispatchEvent('pointerdown');
  await page.waitForTimeout(60);
  r.padVoices = await page.evaluate(() => window.soundsmith.pads.info().voices);
  await page.click('.pads-seq .transport-btn >> nth=0');
  await page.waitForTimeout(600);
  r.seqPlaying = await page.evaluate(() => window.soundsmith.pads.info().playing);
  await page.click('.pads-seq .transport-btn >> nth=0');
  await page.click('text=SP-1200 느낌');
  r.padFx = await page.evaluate(() => JSON.stringify(window.soundsmith.pads.info().fx));
  await shot('pads');
  r.padsOverflow = await overflow();

  // ---- 톤 맞추기 ----
  await page.click('.tab[data-tab="tone"]');
  const T = () => page.evaluate(() => ({ ...window.soundsmith.patch.tone, reverb: window.soundsmith.patch.fx.reverb, ...window.soundsmith.tone.info() }));
  await page.waitForFunction(() => window.soundsmith.tone.info().measured, null, { timeout: 15000 });
  r.toneMeasured = (await T()).bands?.length === 6;
  const bass = page.getByRole('slider', { name: '저음', exact: true });
  await bass.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await bass.focus();
  await page.keyboard.press('PageDown');
  r.toneKnob = (await T()).bass < 0;
  await page.locator('.word-btn', { hasText: '더 반짝이게' }).click();
  r.toneWord = (await T()).air > 0 && /반짝/.test(await page.textContent('.tone-why'));
  const eb = await boxOf(page, '.tone-eq');
  const b0 = (await T()).body;
  await page.mouse.move(eb.x + eb.width * 0.6, eb.y + eb.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(eb.x + eb.width * 0.6, eb.y + eb.height * 0.2, { steps: 4 });
  await page.mouse.up();
  r.toneDrag = (await T()).body > b0;
  await page.click('text=A → B 번갈아');
  await page.waitForTimeout(300);
  r.toneAB = await page.evaluate(() => window.soundsmith.studio.running);
  await page.locator('.chip-btn[data-room="hall"]').click();
  r.toneRoom = (await T()).reverb === 0.55;
  await page.locator('.seg-btn[data-src="patch"]').click();
  await page.selectOption('.ref-patch select', 'air-pad');
  await page.click('text=이 음색을 레퍼런스로');
  await page.waitForFunction(() => window.soundsmith.tone.info().ref?.name === '공기 패드', null, { timeout: 15000 });
  r.toneRows = await page.locator('.match-table tbody tr').count();
  const beforeMatch = await T();
  await page.click('text=제안대로 맞추기');
  const afterMatch = await T();
  r.toneMatch = ['deep', 'bass', 'mud', 'body', 'clarity', 'air'].some((k) => afterMatch[k] !== beforeMatch[k]);
  r.toneLog = await page.locator('.tone-log li').count();
  await shot('tone');
  r.toneOverflow = await overflow();
  // 음원 파일을 레퍼런스로: 열고, 재고, 들어 보고, 멈춤
  await page.locator('.seg-btn[data-src="file"]').click();
  await page.setInputFiles('.ref-file input[type=file]', { name: '시험 음원.wav', mimeType: 'audio/wav', buffer: testWav() });
  await page.waitForFunction(() => window.soundsmith.tone.info().ref?.kind === 'file', null, { timeout: 15000 });
  r.refFile = await page.evaluate(() => {
    const { ref, follow } = window.soundsmith.tone.info();
    return { name: ref.name, follow, centroid: ref.centroid, overview: !document.querySelector('.ref-audio').hidden };
  });
  await page.click('text=▶ 레퍼런스 듣기');
  await page.click('text=■ 멈춤');
  await page.click('text=레퍼런스 지우기');

  // ---- 음 높이 자세히 (예전 튜닝 화면) ----
  await page.click('text=음 높이 자세히 ▸');
  await page.click('.chip-btn[data-hz="442"]');
  await page.click('.temp-card[data-id="werckmeister3"]');
  r.tuning = await page.evaluate(() => ({ a: window.soundsmith.studio.tuner.freq(69), t: window.soundsmith.tuning.temperament }));
  r.pitchStrip = /A4 442\.0 Hz/.test(await page.textContent('.pitch-read'));
  r.tuningOverflow = await overflow();
  await shot('tuning');
  await page.close();
}

console.log(JSON.stringify(results, null, 1));
if (errors.length) {
  console.error('콘솔 오류:', errors);
  process.exitCode = 1;
}
for (const [name, r] of Object.entries(results)) {
  const bad = [];
  const expect = (ok, label) => ok || bad.push(label);
  expect(r.startTab === 'stage', '첫 화면');
  expect(r.running, '소리 켜기');
  expect(r.voicesHeld >= 2, '두 음 동시');
  expect(r.digit4 === 'dx-ep', '숫자 키 4');
  expect(r.padClick === 'church-organ', '패드 누르기');
  expect(r.xyBrighter, '밝기×공간 판');
  expect(r.nextSong === 'dx-ep', '다음 곡');
  expect(r.hold === true, '패드 홀드');
  expect(r.stripPlaying === true, '루퍼 줄 재생');
  expect(r.songs === 4, '곡 추가');
  expect(r.prayerCards > 0 && r.prayerCards < 42, '쓰임새 거르기');
  expect(r.cardPick === 'air-pad', '카드 고르기');
  expect(/공기|패드예요/.test(r.summary) && /초/.test(r.summary), '지금 소리 설명');
  expect(r.macroBrighter, '도우미 밝기');
  expect(r.undoBack, '되돌리기');
  expect(r.audition >= 4, '들어 보기');
  expect(r.wave0 === 'custom', '배음 그리기');
  expect(r.filterDrag, '필터 끌기');
  expect(r.knob.up && r.knob.reset, `노브 ${JSON.stringify(r.knob)}`);
  expect(r.tabs === 4, '탭 4개');
  expect(r.organCards === 6, `오르간 종류 ${r.organCards}`);
  expect(r.bars === '888700000', `드로바 ${r.bars}`);
  expect(r.layers === '60|워십 패드:0-127,무그풍 베이스:0-59', `겹치기 ${r.layers}`);
  expect(r.arr === '8|true|워십 패드|3', `반주 ${r.arr}`);
  expect(r.rotary === true, '로터리 빠르게');
  expect(/임팩트/.test(r.fxState), `전환 ${r.fxState}`);
  expect(r.drone === 3, '드론');
  expect(r.pianoVoices >= 1, '피아노 샘플');
  expect(r.padsSlices >= 12, `조각 ${r.padsSlices}`);
  expect(r.padVoices >= 1, '패드 소리');
  expect(r.seqPlaying, '패턴 재생');
  expect(r.padFx === '{"bits":12,"lofi":0.25,"rate":26040}', '로파이');
  expect(r.padAssigned, '패드에 올리기');
  expect(r.trackSound, '루퍼로 보내기');
  expect(r.sample.root === 'A2' && r.sample.source === 'sample', '데모 샘플');
  expect(r.sampleVoice >= 1, '샘플 연주');
  expect(r.recorded === '60,67' && r.afterUndo === 0, `루퍼 녹음 ${r.recorded}/${r.afterUndo}`);
  expect(r.toneMeasured, '톤 재기');
  expect(r.toneKnob, '톤 노브');
  expect(r.toneWord, '말 버튼');
  expect(r.toneDrag, '톤 곡선 끌기');
  expect(r.toneAB, 'A/B 듣기');
  expect(r.toneRoom, '방 맞추기');
  expect(r.toneRows === 6, `레퍼런스 표 ${r.toneRows}`);
  expect(r.toneMatch, '제안대로 맞추기');
  expect(r.toneLog >= 4, `톤 기록 ${r.toneLog}`);
  expect(r.refFile.name === '시험 음원' && r.refFile.follow === 0.4 && r.refFile.overview && r.refFile.centroid > 200, `음원 레퍼런스 ${JSON.stringify(r.refFile)}`);
  expect(r.tuning.a === 442 && r.tuning.t === 'werckmeister3', '튜닝');
  expect(r.pitchStrip, '음 높이 한 줄');
  for (const k of Object.keys(r).filter((x) => x.endsWith('Overflow'))) expect(r[k] <= 0, `${k}=${r[k]}`);
  if (bad.length) {
    console.error(name, '실패:', bad.join(', '));
    process.exitCode = 1;
  }
}
await browser.close();
