// 튜닝 화면: 기준음(A4), 조옮김·미세 조정, 음률과 기준 조, 음마다 cent, 옥타브 늘이기,
// 평균율과 번갈아 듣기, 마이크 튜너, Scala 주고받기.
import { h, panel, nextId, chipButton } from './ui.js';
import { drawTuningBars, drawNeedle } from './draw.js';
import { A4_PRESETS, NOTE_NAMES, TEMPERAMENTS, makeTuner, noteName, offsets, parseScala, degreesToCustom, exportScala } from './tuning.js';
import { detectPitch } from './sample.js';
import { Instrument } from './engine.js';
import { FACTORY } from './presets.js';
import { saveFile, copyText } from './store.js';

export function TuningView(root, app) {
  const set = (patch) => app.setTuning({ ...app.tuning, ...patch });

  // ---- 기준음 ----
  const a4Id = nextId('a4');
  const a4 = h('input', { type: 'range', id: a4Id, min: 4150, max: 4660, step: 1 });
  const a4Out = h('output', { for: a4Id, class: 'big-readout' });
  a4.addEventListener('input', () => set({ a4: Number(a4.value) / 10 }));
  const a4Chips = A4_PRESETS.map((p) => chipButton(`${p.hz}`, () => set({ a4: p.hz }), { title: p.label, dataset: { hz: p.hz } }));

  const trOut = h('output', { class: 'step-out' });
  const fineId = nextId('fine');
  const fine = h('input', { type: 'range', id: fineId, min: -50, max: 50, step: 1 });
  const fineOut = h('output', { for: fineId });
  fine.addEventListener('input', () => set({ fine: Number(fine.value) }));
  const stretchId = nextId('stretch');
  const stretch = h('input', { type: 'range', id: stretchId, min: 0, max: 30, step: 1 });
  const stretchOut = h('output', { for: stretchId });
  stretch.addEventListener('input', () => set({ stretch: Number(stretch.value) / 10 }));

  // ---- 음률 ----
  const rootSel = h('select', { id: nextId('root') }, ...NOTE_NAMES.map((n, i) => h('option', { value: i }, n)));
  rootSel.addEventListener('change', () => set({ root: Number(rootSel.value) }));
  const tempCards = Object.entries(TEMPERAMENTS).map(([id, t]) => {
    const b = h('button', { type: 'button', class: 'temp-card', 'aria-pressed': 'false', dataset: { id } },
      h('strong', {}, t.label), h('span', {}, t.note));
    b.addEventListener('click', () => {
      if (id === 'custom') set({ temperament: 'custom', custom: app.tuning.custom ?? offsets(app.tuning) });
      else set({ temperament: id });
    });
    return b;
  });

  // ---- 음마다 cent ----
  const chart = h('canvas', { class: 'tuning-chart', 'aria-label': '음마다 평균율에서 벗어난 cent. 막대를 위아래로 끌어 직접 바꿀 수 있어요' });
  const cells = NOTE_NAMES.map((n, i) => {
    const input = h('input', { type: 'number', min: -100, max: 100, step: 0.1, 'aria-label': `${n} cent`, class: 'cent-input' });
    input.addEventListener('change', () => editCent(i, Number(input.value)));
    return h('label', { class: 'cent-cell' }, h('span', {}, n), input);
  });
  let chartGeo = null;
  let activePc = null;
  function editCent(pc, value) {
    if (!Number.isFinite(value)) return;
    const custom = (app.tuning.temperament === 'custom' && app.tuning.custom ? app.tuning.custom : offsets(app.tuning)).slice();
    custom[pc] = Math.round(Math.max(-100, Math.min(100, value)) * 10) / 10;
    set({ temperament: 'custom', custom });
  }
  let dragging = false;
  const chartPointer = (e) => {
    if (!chartGeo) return;
    const r = chart.getBoundingClientRect();
    const x = e.clientX - r.left;
    const pc = Math.floor((x - chartGeo.left) / chartGeo.col);
    if (pc < 0 || pc > 11) return;
    editCent(pc, Math.round(chartGeo.yToCents(e.clientY - r.top) * 2) / 2);
  };
  chart.addEventListener('pointerdown', (e) => { dragging = true; chart.setPointerCapture(e.pointerId); chartPointer(e); });
  chart.addEventListener('pointermove', (e) => dragging && chartPointer(e));
  chart.addEventListener('pointerup', () => { dragging = false; });
  chart.addEventListener('pointercancel', () => { dragging = false; });

  const table = h('table', { class: 'freq-table' });

  // ---- 비교 듣기 ----
  const abBtn = h('button', { type: 'button', class: 'primary' }, '평균율 ↔ 이 튜닝 번갈아 듣기');
  const abState = h('p', { class: 'ab-state', 'aria-live': 'polite' });
  async function chord(tuner, at) {
    const organ = FACTORY.find((f) => f.patch.name === '교회 오르간').patch;
    const env = { ...app.studio.env(), tuner };
    const inst = new Instrument(env, { ...organ, fx: { ...organ.fx, reverb: 0.25 } });
    const r = 48 + app.tuning.root;
    for (const m of [r, r + 4, r + 7, r + 12, r + 16]) {
      inst.noteOn(m, 0.65, at);
      inst.noteOff(m, at + 2.2);
    }
    setTimeout(() => inst.dispose(), (at - app.studio.ctx.currentTime + 3.5) * 1000);
  }
  abBtn.addEventListener('click', async () => {
    const ctx = await app.ensureAudio();
    const now = ctx.currentTime + 0.05;
    const equal = makeTuner({ ...app.tuning, temperament: 'equal', stretch: 0 });
    chord(equal, now);
    chord(app.studio.tuner, now + 2.6);
    const key = NOTE_NAMES[app.tuning.root];
    abState.textContent = `① 평균율 ${key} 장3화음`;
    setTimeout(() => { abState.textContent = `② ${TEMPERAMENTS[app.tuning.temperament].label} ${key} 장3화음 — 3도의 맥놀이(웅웅거림)를 비교해 보세요`; }, 2600);
    setTimeout(() => { abState.textContent = ''; }, 6000);
  });

  // ---- 마이크 튜너 ----
  const tunerBtn = h('button', { type: 'button' }, '마이크 튜너 켜기');
  const needle = h('canvas', { class: 'needle', 'aria-hidden': 'true' });
  const tunerNote = h('strong', { class: 'tuner-note' }, '—');
  const tunerDetail = h('p', { class: 'tuner-detail' }, '밴드 악기를 이 기준음과 음률에 맞출 때 써요.');
  const tuner = { stream: null, analyser: null, buf: null, last: 0, cents: null };
  tunerBtn.addEventListener('click', async () => {
    if (tuner.stream) return stopTuner();
    if (!navigator.mediaDevices?.getUserMedia) {
      app.notice('이 브라우저(또는 이 화면)에서는 마이크를 쓸 수 없어요.', 'bad');
      return;
    }
    try {
      const ctx = await app.ensureAudio();
      tuner.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const src = ctx.createMediaStreamSource(tuner.stream);
      tuner.analyser = ctx.createAnalyser();
      tuner.analyser.fftSize = 4096;
      tuner.buf = new Float32Array(4096);
      src.connect(tuner.analyser);
      tunerBtn.textContent = '튜너 끄기';
    } catch {
      tuner.stream = null;
      app.notice('마이크를 열지 못했어요. 브라우저의 마이크 권한을 확인하세요.', 'bad');
    }
  });
  function stopTuner() {
    tuner.stream?.getTracks().forEach((t) => t.stop());
    tuner.stream = null;
    tuner.analyser = null;
    tuner.cents = null;
    tunerBtn.textContent = '마이크 튜너 켜기';
    tunerNote.textContent = '—';
    drawNeedle(needle, null);
  }
  app.onFrame((time) => {
    if (!tuner.analyser || time - tuner.last < 80) return;
    tuner.last = time;
    tuner.analyser.getFloatTimeDomainData(tuner.buf);
    const sr = app.studio.ctx.sampleRate;
    const p = detectPitch(tuner.buf, sr, { minHz: 50, maxHz: 1500 });
    if (!p || p.clarity < 0.75) return;
    const t = app.tuning;
    const off = offsets(t);
    const m = Math.round(69 + 12 * Math.log2(p.hz / t.a4));
    const target = t.a4 * 2 ** ((m - 69) / 12 + (off[((m % 12) + 12) % 12] + t.fine + (t.stretch * (m - 69)) / 12) / 1200);
    const cents = 1200 * Math.log2(p.hz / target);
    tuner.cents = tuner.cents == null ? cents : tuner.cents * 0.6 + cents * 0.4;
    tunerNote.textContent = noteName(m);
    tunerDetail.textContent = `${p.hz.toFixed(1)} Hz · 목표 ${target.toFixed(1)} Hz · ${tuner.cents >= 0 ? '+' : ''}${tuner.cents.toFixed(0)} cent`;
    drawNeedle(needle, tuner.cents);
  });

  // ---- Scala ----
  const sclText = h('textarea', { rows: 6, class: 'scl', spellcheck: 'false', 'aria-label': 'Scala 내용', placeholder: '! 예: 순정률\nJust\n12\n16/15\n9/8\n6/5\n5/4\n4/3\n45/32\n3/2\n8/5\n5/3\n16/9\n15/8\n2/1' });
  const sclFile = h('input', { type: 'file', accept: '.scl,text/plain', class: 'visually-hidden', id: nextId('scl') });
  const applyScala = (text) => {
    try {
      const s = parseScala(text);
      set({ temperament: 'custom', custom: degreesToCustom(s.degrees, app.tuning.root) });
      app.notice(`'${s.name}' 음계를 ${NOTE_NAMES[app.tuning.root]} 기준으로 건반에 맞췄어요.`, 'good');
    } catch (e) {
      app.notice(e.message, 'bad');
    }
  };
  sclFile.addEventListener('change', async () => {
    const f = sclFile.files?.[0];
    sclFile.value = '';
    if (f) {
      sclText.value = await f.text();
      applyScala(sclText.value);
    }
  });

  root.append(h('div', { class: 'tuning-layout' },
    panel('기준음', { hint: '모든 소리(신스·줄·샘플·루퍼)가 이 값을 따라요.' },
      h('div', { class: 'a4' }, h('label', { for: a4Id, class: 'label' }, 'A4'), a4Out), a4,
      h('div', { class: 'chip-row' }, ...a4Chips),
      h('div', { class: 'ctl' }, h('span', { class: 'label' }, '조옮김'), trOut,
        h('div', { class: 'stepper' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '반음 내리기', onclick: () => set({ transpose: app.tuning.transpose - 1 }) }, '−'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '반음 올리기', onclick: () => set({ transpose: app.tuning.transpose + 1 }) }, '+'))),
      h('div', { class: 'ctl' }, h('label', { for: fineId }, '전체 미세 조정'), fineOut, fine),
      h('div', { class: 'ctl' }, h('label', { for: stretchId }, '옥타브 늘이기'), stretchOut, stretch),
      h('p', { class: 'panel-hint' }, '피아노 조율사처럼 높은 음은 조금 높게, 낮은 음은 조금 낮게 (옥타브당 cent).')),
    panel('음률', { cls: 'span-2', hint: '같은 C 장3화음도 음률마다 3도의 맑기가 달라요. 기준 조를 연주할 곡의 조에 맞추세요.' },
      h('div', { class: 'ctl' }, h('label', { for: rootSel.id }, '기준 조'), h('span'), rootSel),
      h('div', { class: 'temp-grid' }, ...tempCards),
      h('div', { class: 'btn-row' }, abBtn), abState),
    panel('음마다 cent', { cls: 'span-2', hint: '평균율에서 몇 cent 벗어나는지. 막대를 끌거나 숫자를 바꾸면 \'직접 조정\'이 돼요.' },
      chart, h('div', { class: 'cent-row' }, ...cells),
      h('div', { class: 'table-wrap' }, table)),
    panel('마이크 튜너', {}, needle, h('div', { class: 'tuner-read' }, tunerNote, tunerDetail), h('div', { class: 'btn-row' }, tunerBtn)),
    panel('Scala 파일', { hint: '마이크로톤 음계 표준(.scl). 12음 + 옥타브 음계를 건반에 맞춰요.' },
      sclText,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', onclick: () => applyScala(sclText.value) }, '붙여넣은 음계 적용'),
        h('label', { class: 'file-btn', for: sclFile.id }, '.scl 불러오기', sclFile),
        h('button', {
          type: 'button', class: 'quiet', onclick: async () => {
            const text = exportScala(app.tuning);
            sclText.value = text;
            const r = await saveFile('soundsmith.scl', text, 'text/plain');
            if (r !== 'saved') app.notice((await copyText(text)) ? '이 화면에서는 .scl 저장이 안 돼서 내용을 클립보드에 복사했어요.' : '아래 칸의 내용을 복사해 .scl 파일로 저장하세요.');
          },
        }, '지금 튜닝 내보내기')))));

  function drawChart() {
    const off = offsets(app.tuning);
    const range = off.some((c) => Math.abs(c) > 30) ? 60 : 30;
    chartGeo = drawTuningBars(chart, off, NOTE_NAMES, range, activePc);
  }

  function sync() {
    const t = app.tuning;
    a4.value = String(Math.round(t.a4 * 10));
    a4Out.textContent = `${t.a4.toFixed(1)} Hz`;
    a4Chips.forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.hz) === t.a4)));
    const sign = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '±0');
    trOut.textContent = t.transpose ? `${sign(t.transpose)} (C 를 누르면 ${NOTE_NAMES[((t.transpose % 12) + 12) % 12]})` : '±0';
    fine.value = String(t.fine);
    fineOut.textContent = `${sign(t.fine)} cent`;
    stretch.value = String(Math.round(t.stretch * 10));
    stretchOut.textContent = `${t.stretch.toFixed(1)} cent/oct`;
    rootSel.value = String(t.root);
    tempCards.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === t.temperament)));
    const off = offsets(t);
    cells.forEach((c, i) => {
      const input = c.querySelector('input');
      if (document.activeElement !== input) input.value = off[i].toFixed(1);
    });
    const tun = app.studio.tuner;
    const rows = Array.from({ length: 12 }, (_, i) => 60 + i);
    table.replaceChildren(
      h('thead', {}, h('tr', {}, h('th', {}, '건반'), h('th', {}, '나는 음'), h('th', {}, '주파수'), h('th', {}, '평균율과 차이'))),
      h('tbody', {}, ...rows.map((m) => {
        const c = tun.centsAt(m);
        return h('tr', {}, h('td', {}, noteName(m)), h('td', {}, noteName(m + t.transpose)), h('td', {}, `${tun.freq(m).toFixed(2)} Hz`),
          h('td', { class: Math.abs(c) < 0.05 ? '' : c > 0 ? 'up' : 'down' }, `${c >= 0 ? '+' : ''}${c.toFixed(2)} cent`));
      })));
    drawChart();
  }

  app.on('tuning', sync);
  app.on('resize', drawChart);
  app.on('show:tuning', () => requestAnimationFrame(() => { sync(); drawNeedle(needle, tuner.cents); }));
  app.on('note', ({ midi, on }) => {
    if (root.hidden) return;
    activePc = on ? (((midi + app.tuning.transpose) % 12) + 12) % 12 : null;
    drawChart();
  });
  sync();
  return { sync };
}
