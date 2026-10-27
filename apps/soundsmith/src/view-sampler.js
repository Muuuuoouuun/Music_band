// 샘플러 화면: 소리 가져오기(파일·마이크·데모·지금 음색 굽기), 시작/끝·루프 지점 끌기, 이음새 보기,
// 기준 음·미세 조정(튜닝), 루프 방식, 크로스페이드, SFZ 악기 내보내기.
// 위에는 지금 샘플 요약(들어 보기·건반 연주·샘플 패드로)과 단계 줄(가져오기 → 루프 → 이음새 → 기준 음 → 연주)이 있어
// 누르면 그 상자로 간다. 루프 표시는 끌거나, 옮길 표시를 골라 ◀ ▶ (0 지점 하나씩)로 옮긴다.
import { h, panel, nextId, knob } from './ui.js';
import { drawSample, drawSeam } from './draw.js';
import { peaks, trimSilence, detectPitch, findLoop, upwardZeroCrossings, encodeWav, sfzText, demoSample, toMono } from './sample.js';
import { noteName } from './tuning.js';
import { renderNote } from './engine.js';
import { makeZip } from './zip.js';
import { saveFile } from './store.js';
import { micButton } from './mic.js';

const LOOP_MODES = [
  { id: 'off', label: '한 번만', hint: '끝까지 한 번 울리고 멈춤 (드럼·효과음)' },
  { id: 'forward', label: '반복', hint: '루프 구간을 계속 되풀이 (패드·현·오르간)' },
  { id: 'pingpong', label: '왕복', hint: '앞으로 갔다 뒤로 돌아옴. 이음새가 튀는 소리에 유리' },
];

/** 새 소리를 받아 자동으로 무음 자르기 → 음높이 찾기 → 루프 찾기까지 한다. */
export function analyzeSample(name, data, sr, rootHint = null) {
  const { start, end } = trimSilence(data, sr);
  const detected = detectPitch(data, sr, { start, end });
  const root = rootHint ?? detected?.note ?? 60;
  const fine = rootHint != null ? 0 : detected ? Math.round(detected.cents) : 0;
  const s = { name, data, sr, start, end, root, fine, detected, loopMode: 'forward', loopStart: 0, loopEnd: 0, xfadeMs: 30, cost: null };
  autoLoop(s);
  return s;
}

export function autoLoop(s) {
  const hz = s.detected?.hz ?? null;
  const loop = findLoop(s.data, s.sr, { start: s.start, end: s.end, hz });
  if (loop) {
    s.loopStart = loop.loopStart;
    s.loopEnd = loop.loopEnd;
    s.cost = loop.cost;
  } else {
    s.loopStart = Math.round(s.start + (s.end - s.start) * 0.4);
    s.loopEnd = Math.round(s.start + (s.end - s.start) * 0.9);
    s.loopMode = 'off';
    s.cost = null;
  }
}

export function SamplerView(root, app) {
  const fileInput = h('input', { type: 'file', accept: 'audio/*', class: 'visually-hidden', id: nextId('file') });
  const recBtn = h('button', { type: 'button' }, '● 마이크로 녹음');
  const bakeNote = h('select', { 'aria-label': '구울 음' }, ...[45, 48, 52, 57, 60, 64, 69].map((m) => h('option', { value: m, selected: m === 57 || null }, noteName(m))));
  const bakeBtn = h('button', { type: 'button' }, '지금 음색을 샘플로 굽기');
  const demoBtn = h('button', { type: 'button' }, '데모 소리 (활로 켠 A2)');

  const empty = h('div', { class: 'empty-state' },
    h('strong', {}, '샘플이 아직 없어요'),
    h('p', {}, '오디오 파일을 불러오거나, 데모 소리·지금 음색 굽기로 시작하세요. 불러오면 무음 자르기, 음높이 찾기, 루프 지점 찾기를 자동으로 합니다.'),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'primary', onclick: () => demoBtn.click() }, '데모 소리로 시작하기')));

  const wave = h('canvas', { class: 'wave-canvas', 'aria-label': '샘플 파형. 시작·끝·루프 표시를 끌어 옮길 수 있어요' });
  const zoomBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false' }, '루프 부분 확대');
  const snapBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'true' }, '0 지점에 붙이기');
  const seam = h('canvas', { class: 'seam-canvas', 'aria-label': '루프 이음새' });
  const seamScore = h('strong', { class: 'seam-score' });
  const info = h('dl', { class: 'facts' });

  const rootSel = h('select', { id: nextId('root') }, ...Array.from({ length: 73 }, (_, i) => i + 24).map((m) => h('option', { value: m }, noteName(m))));
  const centStr = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)} cent`;
  const fine = knob({
    label: '미세 조정', min: -50, max: 50, step: 1, format: centStr,
    onChange: (v) => update((s) => { s.fine = v; }),
    defaultValue: () => (app.sample?.detected ? Math.round(app.sample.detected.cents) : 0),
  });
  const modeBtns = LOOP_MODES.map((m) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'false', title: m.hint, onclick: () => update((s) => { s.loopMode = m.id; }) }, m.label));
  const modeHint = h('p', { class: 'panel-hint' });
  const xfade = knob({
    label: '크로스페이드', min: 0, max: 200, step: 1, format: (v) => `${v} ms`,
    onChange: (v) => update((s) => { s.xfadeMs = v; }), defaultValue: () => 30,
  });
  const useBtn = h('button', { type: 'button', class: 'primary' }, '이 샘플로 건반 연주');
  const exportBtn = h('button', { type: 'button' }, 'SFZ 악기 내보내기 (.zip)');

  // ---- 요약 줄 ----
  const sumName = h('strong', { class: 'smp-name' });
  const sumMeta = h('span', { class: 'smp-meta' });
  const listenBtn = h('button', { type: 'button', class: 'smp-listen' }, '▶ 들어 보기');
  const padsBtn = h('button', { type: 'button', class: 'quiet small', title: '이 샘플을 샘플 패드 화면에서 조각내 비트로 써요' }, '샘플 패드에서 자르기 ›');
  const stepList = h('ol', { class: 'smp-steps', 'aria-label': '샘플 만드는 단계 (누르면 그 상자로)' });
  const summary = h('div', { class: 'smp-bar' },
    h('div', { class: 'smp-now' }, h('span', { class: 'label' }, '지금 샘플'), sumName, sumMeta),
    h('div', { class: 'btn-row smp-acts' }, listenBtn, useBtn, padsBtn),
    stepList);

  // ---- 표시 미세 이동: 옮길 표시를 고르고 ◀ ▶ ----
  const MARKS = [['start', '시작'], ['loopStart', '루프 시작'], ['loopEnd', '루프 끝'], ['end', '끝']];
  let nudgeKey = 'loopStart';
  const nudgeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '옮길 표시' });
  const nudgeRead = h('output', { class: 'nudge-read' });
  const nudgeBtn = (label, dir, big, title) => h('button', { type: 'button', class: 'icon-btn small', title, 'aria-label': title, onclick: () => nudge(dir, big) }, label);
  const nudgeRow = h('div', { class: 'nudge-row' },
    h('span', { class: 'label' }, '옮길 표시'), nudgeSeg,
    h('div', { class: 'joined nudge-btns' }, nudgeBtn('◀◀', -1, true, '크게 앞으로'), nudgeBtn('◀', -1, false, '조금 앞으로'), nudgeBtn('▶', 1, false, '조금 뒤로'), nudgeBtn('▶▶', 1, true, '크게 뒤로')),
    nudgeRead);

  const wavePanel = panel('파형과 루프', {
    cls: 'span-wide',
    hint: '흰 표시 = 시작·끝, 금색 = 루프. 끌거나, 옮길 표시를 고르고 ◀ ▶ (0 지점 하나씩).',
    actions: h('div', { class: 'panel-actions' }, zoomBtn, snapBtn),
  }, wave, nudgeRow);
  const body = h('div', { class: 'sampler-body' },
    wavePanel,
    panel('이음새', { hint: '루프 끝 → 시작으로 넘어가는 곳. 두 선이 매끄럽게 이어져야 "틱" 소리가 없어요.' },
      seam, h('p', { class: 'seam-line' }, seamScore),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', onclick: () => update((s) => autoLoop(s)) }, '루프 자동 찾기'),
        h('button', { type: 'button', onclick: () => update((s) => Object.assign(s, trimSilence(s.data, s.sr))) }, '무음 자르기'))),
    panel('기준 음', { hint: '샘플의 실제 음. 맞춰 두면 누른 건반 음 그대로 나요.' },
      info,
      h('div', { class: 'ctl' }, h('label', { for: rootSel.id }, '기준 음'), h('span'), rootSel),
      h('div', { class: 'knobs' }, fine.el),
      h('div', { class: 'btn-row' }, h('button', {
        type: 'button', onclick: () => update((s) => {
          s.detected = detectPitch(s.data, s.sr, { start: s.start, end: s.end });
          if (s.detected) { s.root = s.detected.note; s.fine = Math.round(s.detected.cents); }
        }),
      }, '음높이 다시 찾기'))),
    panel('재생 방식', {},
      h('div', { class: 'ctl ctl-seg' }, h('span', { class: 'label' }, '루프'), h('div', { class: 'seg', role: 'group', 'aria-label': '루프 방식' }, ...modeBtns)),
      modeHint,
      h('div', { class: 'knobs' }, xfade.el),
      h('div', { class: 'btn-row' }, exportBtn)));

  const [, seamPanel, tunePanel, playPanel] = body.children;
  root.append(
    h('div', { class: 'sampler-tools' },
      h('label', { class: 'file-btn primary', for: fileInput.id }, '오디오 파일 불러오기', fileInput),
      recBtn, demoBtn,
      h('span', { class: 'bar-sep', 'aria-hidden': 'true' }),
      h('div', { class: 'joined' }, bakeNote, bakeBtn)),
    empty, summary, body);

  listenBtn.addEventListener('click', async () => {
    const s = app.sample;
    if (!s) return;
    if (app.patch.source !== 'sample') app.setParam('source', 'sample', 'change');
    await app.audition([s.root], 1.6);
  });
  padsBtn.addEventListener('click', () => {
    if (!app.sample) return;
    app.pads.fromLab();
    app.showTab('pads');
  });
  function nudge(dir, big) {
    const s = app.sample;
    if (!s) return;
    const key = nudgeKey;
    const snap = snapBtn.getAttribute('aria-pressed') === 'true' && key.startsWith('loop');
    update((x) => {
      let at = x[key];
      if (snap) {
        // 0 지점(위로 지나는 곳) 하나씩 — 크게는 열 개
        for (let k = 0; k < (big ? 10 : 1); k++) {
          const win = Math.round(x.sr * 0.05);
          const z = dir > 0 ? upwardZeroCrossings(x.data, at + 1, Math.min(x.data.length, at + win)) : upwardZeroCrossings(x.data, Math.max(1, at - win), at);
          if (!z.length) break;
          at = dir > 0 ? z[0] : z.at(-1);
        }
      } else at += dir * Math.round(x.sr / 1000) * (big ? 10 : 1);
      x[key] = Math.max(0, Math.min(x.data.length, at));
      if (x.start > x.end - 100) x.start = Math.max(0, x.end - 100);
      x.cost = null;
    });
    draw(key);
  }
  wave.tabIndex = 0;
  wave.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    nudge(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey);
  });
  const goTo = (el) => el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  // ---- 소리 가져오기 ----
  const accept = (s, { use = true } = {}) => {
    app.setSample(s);
    if (use && app.patch.source !== 'sample') {
      app.setParam('source', 'sample', 'change');
      app.notice(`'${s.name}' 샘플을 건반에 걸었어요. 소리 재료가 '샘플'로 바뀌었어요.`);
    }
  };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const ctx = await app.ensureAudio();
      const buf = await ctx.decodeAudioData(await f.arrayBuffer());
      const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      accept(analyzeSample(f.name.replace(/\.[^.]+$/, ''), toMono(ch), buf.sampleRate));
    } catch {
      app.notice('이 파일을 소리로 읽지 못했어요. WAV·MP3·M4A 같은 오디오 파일인지 확인하세요.', 'bad');
    }
  });
  demoBtn.addEventListener('click', () => accept(analyzeSample('데모 첼로 A2', demoSample(44100), 44100)));
  bakeBtn.addEventListener('click', async () => {
    const midi = Number(bakeNote.value);
    bakeBtn.disabled = true;
    try {
      const patch = app.patch.source === 'sample' ? { ...app.patch, source: 'synth' } : app.patch;
      const library = app.studio.library;
      if (patch.source === 'piano' || patch.layers.some((l) => l.patch.source === 'piano')) await library.load('grand');
      const buf = await renderNote(patch, { midi, seconds: Math.min(6, 2.5 + patch.ampEnv.a), hold: Math.min(5, 2 + patch.ampEnv.a), tuning: {}, library });
      accept(analyzeSample(`${patch.name} ${noteName(midi)}`, toMono([buf.getChannelData(0), buf.getChannelData(1)]), buf.sampleRate, midi));
    } finally {
      bakeBtn.disabled = false;
    }
  });
  micButton(app, recBtn, {
    maxSec: 10,
    hint: '한 음을 길게 내 주세요. 이어폰을 끼면 스피커 소리가 섞이지 않아요.',
    onBuffer: (buf) => accept(analyzeSample('내 녹음', toMono([buf.getChannelData(0)]), buf.sampleRate)),
  });

  // ---- 값 바꾸기 ----
  function update(fn) {
    const s = app.sample;
    if (!s) return;
    fn(s);
    s.loopStart = Math.max(s.start + 1, Math.min(s.loopStart, s.end - 2));
    s.loopEnd = Math.max(s.loopStart + 1, Math.min(s.loopEnd, s.end));
    app.setSample(s);
  }
  rootSel.addEventListener('change', () => update((s) => { s.root = Number(rootSel.value); }));
  useBtn.addEventListener('click', () => {
    app.setParam('source', 'sample', 'change');
    app.notice('건반이 이 샘플을 연주해요.');
  });
  exportBtn.addEventListener('click', async () => {
    const s = app.sample;
    const baked = app.bakedSample;
    if (!s || !baked) return;
    const safe = s.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40) || 'sample';
    const sfz = sfzText({
      file: `${safe}.wav`, name: s.name, root: s.root, tune: -s.fine,
      loop: baked.loop ? { start: baked.loop.start, end: baked.loop.end } : null,
      env: app.patch.ampEnv,
    });
    const zip = makeZip([{ name: `${safe}.sfz`, data: sfz }, { name: `${safe}.wav`, data: encodeWav(baked.data, s.sr, { gain: baked.gain }) }]);
    const r = await saveFile(`${safe}.zip`, zip, 'application/zip');
    app.notice(r === 'saved' ? `${safe}.zip 파일을 저장했어요. 압축을 풀어 sfizz·Sforzando 같은 무료 SFZ 플레이어에서 여세요.` : '이 화면에서는 파일을 저장할 수 없어요.', r === 'saved' ? 'good' : 'bad');
  });
  zoomBtn.addEventListener('click', () => {
    zoomBtn.setAttribute('aria-pressed', String(zoomBtn.getAttribute('aria-pressed') !== 'true'));
    draw();
  });
  snapBtn.addEventListener('click', () => snapBtn.setAttribute('aria-pressed', String(snapBtn.getAttribute('aria-pressed') !== 'true')));

  // ---- 표시 끌기 ----
  const viewRange = (s) => {
    if (zoomBtn.getAttribute('aria-pressed') !== 'true') return { from: 0, to: s.data.length };
    const pad = Math.max(Math.round(s.sr * 0.05), Math.round((s.loopEnd - s.loopStart) * 0.15));
    return { from: Math.max(0, s.loopStart - pad), to: Math.min(s.data.length, s.loopEnd + pad) };
  };
  const markerList = (s) => [
    { key: 'start', at: s.start, label: '시작', kind: 'edge' },
    { key: 'end', at: s.end, label: '끝', kind: 'edge' },
    ...(s.loopMode !== 'off' ? [{ key: 'loopStart', at: s.loopStart, label: '루프 ▸', kind: 'loop' }, { key: 'loopEnd', at: s.loopEnd, label: '◂ 루프', kind: 'loop' }] : []),
  ];
  let drag = null;
  const sampleAt = (e, s) => {
    const r = wave.getBoundingClientRect();
    const v = viewRange(s);
    return Math.round(v.from + ((e.clientX - r.left) / r.width) * (v.to - v.from));
  };
  wave.addEventListener('pointerdown', (e) => {
    const s = app.sample;
    if (!s) return;
    const r = wave.getBoundingClientRect();
    const v = viewRange(s);
    const x = e.clientX - r.left;
    let best = null;
    for (const m of markerList(s)) {
      const mx = ((m.at - v.from) / (v.to - v.from)) * r.width;
      const d = Math.abs(mx - x);
      if (d < 18 && (!best || d < best.d)) best = { key: m.key, d };
    }
    if (!best) return;
    drag = best.key;
    wave.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  wave.addEventListener('pointermove', (e) => {
    const s = app.sample;
    if (!drag || !s) return;
    s[drag] = Math.max(0, Math.min(s.data.length, sampleAt(e, s)));
    draw(drag);
  });
  const endDrag = () => {
    const s = app.sample;
    if (!drag || !s) return;
    const key = drag;
    drag = null;
    update((x) => {
      if (key.startsWith('loop') && snapBtn.getAttribute('aria-pressed') === 'true') {
        const z = upwardZeroCrossings(x.data, x[key] - 400, x[key] + 400);
        if (z.length) x[key] = z.reduce((a, b) => (Math.abs(b - x[key]) < Math.abs(a - x[key]) ? b : a));
      }
      if (x.start > x.end - 100) x.start = Math.max(0, x.end - 100);
      x.cost = null;
    });
  };
  wave.addEventListener('pointerup', endDrag);
  wave.addEventListener('pointercancel', endDrag);

  // ---- 그리기 ----
  function draw(active) {
    const s = app.sample;
    if (!s) return;
    const v = viewRange(s);
    const pk = peaks(s.data, Math.max(100, Math.round(wave.clientWidth || 600)), v.from, v.to);
    drawSample(wave, pk, {
      view: v,
      region: { start: s.start, end: s.end },
      loop: s.loopMode !== 'off' ? { start: s.loopStart, end: s.loopEnd } : null,
      markers: markerList(s).map((m) => ({ ...m, active: m.key === active })),
    });
    const b = app.bakedSample;
    if (s.loopMode !== 'off' && b?.loop) drawSeam(seam, b.data, b.loop.start, b.loop.end, s.sr);
    else drawSeam(seam, s.data, s.loopStart, s.loopEnd, s.sr);
  }

  function sync() {
    const s = app.sample;
    empty.hidden = Boolean(s);
    body.hidden = !s;
    summary.hidden = !s;
    exportBtn.disabled = !s;
    if (!s) return;
    const sec = (n) => `${(n / s.sr).toFixed(2)} s`;
    const d = s.detected;
    // 이름·길이·루프는 위 요약 줄에 있으니 여기는 음높이 자세한 값만
    info.replaceChildren(
      h('dt', {}, '감지한 음'), h('dd', {}, d ? `${noteName(d.note)} · ${d.hz.toFixed(1)} Hz · ${d.cents >= 0 ? '+' : ''}${d.cents.toFixed(0)} cent · 확신 ${Math.round(d.clarity * 100)}%` : '음높이를 찾지 못함 (타악기·잡음)'),
      h('dt', {}, '파일'), h('dd', {}, `전체 ${sec(s.data.length)} · ${s.sr} Hz`));
    rootSel.value = String(s.root);
    fine.set(s.fine);
    xfade.set(s.xfadeMs);
    modeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(LOOP_MODES[i].id === s.loopMode)));
    modeHint.textContent = LOOP_MODES.find((m) => m.id === s.loopMode).hint;
    const cost = app.bakedSample?.seamCost;
    seamScore.textContent = s.loopMode === 'off' ? '루프 없음' : cost == null ? '' : `이음새 매끄러움 ${Math.round(Math.max(0, 1 - cost) * 100)}%`;
    seamScore.dataset.level = cost == null ? '' : cost < 0.05 ? 'good' : cost < 0.25 ? 'warn' : 'bad';
    // 요약 줄과 단계
    const playing = app.patch.source === 'sample';
    sumName.textContent = s.name;
    sumMeta.textContent = `기준 음 ${noteName(s.root)}${s.fine ? ` ${s.fine > 0 ? '+' : '−'}${Math.abs(s.fine)}c` : ''} · ${((s.end - s.start) / s.sr).toFixed(2)}초 · ${LOOP_MODES.find((m) => m.id === s.loopMode).label}`;
    useBtn.textContent = playing ? '✓ 건반이 이 샘플을 연주 중' : '이 샘플로 건반 연주';
    useBtn.setAttribute('aria-pressed', String(playing));
    const seamText = s.loopMode === 'off' ? '루프 없음' : cost == null ? '재는 중' : `매끄러움 ${Math.round(Math.max(0, 1 - cost) * 100)}%`;
    const STEPS = [
      ['가져오기', s.name, 'good', summary],
      ['시작·끝·루프', s.loopMode === 'off' ? '루프 없음' : `${((s.loopEnd - s.loopStart) / s.sr).toFixed(2)}초 루프`, 'good', wavePanel],
      ['이음새', seamText, s.loopMode === 'off' ? '' : seamScore.dataset.level, seamPanel],
      ['기준 음', s.detected ? `${noteName(s.root)} · 확신 ${Math.round(s.detected.clarity * 100)}%` : `${noteName(s.root)} (직접)`, s.detected ? 'good' : 'warn', tunePanel],
      ['연주·내보내기', playing ? '건반 연주 중' : '준비', playing ? 'good' : '', playPanel],
    ];
    stepList.replaceChildren(...STEPS.map(([title, state, level, el], i) => h('li', {},
      h('button', { type: 'button', class: 'smp-step', dataset: { level }, onclick: () => goTo(el) },
        h('span', { class: 'smp-step-no', 'aria-hidden': 'true' }, String(i + 1)), h('strong', {}, title), h('span', { class: 'smp-step-state' }, state)))));
    // 미세 이동 고르기
    const marks = MARKS.filter(([k]) => s.loopMode !== 'off' || !k.startsWith('loop'));
    if (!marks.some(([k]) => k === nudgeKey)) nudgeKey = marks[0][0];
    nudgeSeg.replaceChildren(...marks.map(([k, label]) => {
      const b = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(k === nudgeKey) }, label);
      b.addEventListener('click', () => { nudgeKey = k; sync(); wave.focus({ preventScroll: true }); });
      return b;
    }));
    nudgeRead.textContent = `${MARKS.find(([k]) => k === nudgeKey)[1]} ${(s[nudgeKey] / s.sr).toFixed(3)}초`;
    draw(nudgeKey);
  }

  app.on('sample', sync);
  app.on('patch', ({ phase } = {}) => { if (phase === 'change' && app.sample && !root.closest('[hidden]')) sync(); });
  app.on('resize', () => draw());
  app.on('show:sampler', () => requestAnimationFrame(sync));
  sync();
  return { sync };
}
