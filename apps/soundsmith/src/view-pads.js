// 샘플 패드 (힙합 샘플링, MPC·SP-404 방식): 자르고 → 고르고 → 찍는다.
// 위: 소리(데모 비트·음원 파일·실험실 샘플)와 자르기·BPM. 가운데: 4×4 패드와 고른 패드 편집.
// 아래: 16칸 스텝 시퀀서(스윙), 로파이, WAV 로 내보내기. 패드 1 = 컴퓨터 키 A (C4).
import { h, panel, knob, chipButton, nextId } from './ui.js';
import { color, fit } from './draw.js';
import { PadKit, PAD_COUNT, STEPS, CHOKES, RATES, PAD_BASE_MIDI, defaultPad, starterPattern, replayPattern, stepBeat, renderPattern } from './pads.js';
import { demoBeat, detectOnsets, gridStarts, slicesFrom, nearestZero, estimateTempo, timeStretch } from './chop.js';
import { toMono, peaks, encodeWav } from './sample.js';
import { saveFile } from './store.js';

const CHOP_MODES = [
  { id: 'onset', label: '소리 시작점' },
  { id: 'grid8', label: '8등분' },
  { id: 'grid16', label: '16등분' },
];
const CHOKE_COLORS = ['brass', 'signal', 'rose', 'sky'];
const AHEAD = 0.12;

export function PadsView(root, app) {
  const S = {
    data: null, sr: 44100, name: '', srcBpm: 90,
    mode: 'onset', sensitivity: 0.5,
    slices: [], pads: [], selected: 0,
    steps: starterPattern(), swing: 0.58,
    fx: { bits: 16, lofi: 0, rate: 44100 },
    playing: false, rec: false, t0: 0, scheduled: 0, timer: null,
  };
  let kit = null;
  const ensureKit = async () => {
    const ctx = await app.ensureAudio();
    if (!kit) {
      kit = new PadKit(ctx, app.studio.bus);
      kit.setFx(S.fx);
      if (S.data) kit.setSource(S.data, S.sr);
      kit.setPads(S.pads);
    }
    return kit;
  };

  // ---- 소리 고르기 ----
  const fileInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac', class: 'visually-hidden', id: nextId('padsrc') });
  const srcName = h('span', { class: 'ref-name' });
  const useSampleBtn = h('button', { type: 'button', onclick: () => {
    if (!app.sample) { app.notice('실험실 샘플 상자에 아직 소리가 없어요.', 'bad'); return; }
    setSource(app.sample.data, app.sample.sr, `실험실 샘플 · ${app.sample.name}`);
  } }, '실험실 샘플 쓰기');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    srcName.textContent = `${f.name} 여는 중…`;
    try {
      const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await f.arrayBuffer());
      const mono = toMono(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)));
      // 너무 길면 앞 30초만 (잘라 쓰는 소리는 보통 몇 마디)
      setSource(mono.subarray(0, Math.min(mono.length, buf.sampleRate * 30)), buf.sampleRate, f.name.replace(/\.[^.]+$/, '').slice(0, 40));
    } catch {
      srcName.textContent = '';
      app.notice('이 파일은 열 수 없어요. mp3·wav·m4a 같은 오디오 파일인지 확인하세요.', 'bad');
    }
  });

  function setSource(data, sr, name, bpm = null) {
    S.data = data;
    S.sr = sr;
    S.name = name;
    S.srcBpm = bpm ?? estimateTempo(data, sr).bpm ?? 90;
    chop();
    S.steps = replayPattern(S.pads, S.sr, S.srcBpm);
    kit?.setSource(data, sr);
    render();
  }

  function chop() {
    if (!S.data) return;
    const n = S.data.length;
    const starts = S.mode === 'onset'
      ? detectOnsets(S.data, S.sr, { sensitivity: S.sensitivity, max: PAD_COUNT })
      : gridStarts(n, S.mode === 'grid8' ? 8 : 16);
    S.slices = slicesFrom(starts.map((i) => nearestZero(S.data, i, 128)), n);
    // 패드 설정(음높이 등)은 그대로 두고 자리만 바꾼다
    S.pads = Array.from({ length: PAD_COUNT }, (_, i) => {
      const sl = S.slices[i % S.slices.length];
      const prev = S.pads[i];
      return prev ? { ...prev, start: sl.start, end: sl.end } : defaultPad(sl);
    });
    S.selected = Math.min(S.selected, PAD_COUNT - 1);
    kit?.setPads(S.pads);
  }

  // ---- 파형 + 자른 자리 ----
  const wave = h('canvas', { class: 'pads-wave', 'aria-label': '소리 파형과 자른 자리. 눌러서 조각(패드)을 고르고, 고른 조각의 시작 표시를 끌어 옮겨요' });
  let waveGeo = null;
  function drawWave() {
    if (wave.closest('[hidden]')) return;
    const { g, w, h: hh } = fit(wave);
    if (!S.data) {
      g.fillStyle = color('faint');
      g.font = `13px ${color('font-body')}`;
      g.fillText('위에서 소리를 고르세요', 12, hh / 2);
      return;
    }
    const n = S.data.length;
    const xOf = (i) => (i / n) * w;
    S.pads.forEach((p, i) => {
      if (i !== S.selected) return;
      g.fillStyle = color('brass-wash');
      g.fillRect(xOf(p.start), 0, Math.max(2, xOf(p.end) - xOf(p.start)), hh);
    });
    const pk = peaks(S.data, Math.max(50, Math.round(w)));
    g.fillStyle = color('muted');
    for (let b = 0; b < pk.length / 2; b++) {
      const y1 = hh / 2 - pk[b * 2 + 1] * (hh / 2 - 6);
      const y2 = hh / 2 - pk[b * 2] * (hh / 2 - 6);
      g.fillRect(b * (w / (pk.length / 2)), y1, Math.max(1, w / (pk.length / 2) - 0.3), Math.max(1, y2 - y1));
    }
    g.font = `10px ${color('font-data')}`;
    S.slices.forEach((s, i) => {
      const x = Math.round(xOf(s.start)) + 0.5;
      const sel = S.pads[S.selected]?.start === s.start;
      g.strokeStyle = color(sel ? 'brass-hi' : 'signal');
      g.lineWidth = sel ? 2 : 1;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, hh);
      g.stroke();
      g.fillStyle = color(sel ? 'brass' : 'signal');
      g.fillRect(x, 0, 16, 13);
      g.fillStyle = color('brass-ink');
      g.fillText(String(i + 1), x + 3, 10);
    });
    waveGeo = { w, n };
  }
  let markDrag = null;
  wave.addEventListener('pointerdown', (e) => {
    if (!waveGeo) return;
    const r = wave.getBoundingClientRect();
    const x = e.clientX - r.left;
    const at = Math.round((x / waveGeo.w) * waveGeo.n);
    // 시작 표시 가까이를 잡으면 끌어 옮기고, 아니면 그 자리 조각(과 같은 패드)을 고른다
    const near = S.slices.findIndex((s) => Math.abs((s.start / waveGeo.n) * waveGeo.w - x) < 8);
    if (near > 0) {
      markDrag = near;
      wave.setPointerCapture(e.pointerId);
      return;
    }
    const k = S.slices.findIndex((s) => at >= s.start && at < s.end);
    const pad = S.pads.findIndex((p) => p.start === S.slices[k]?.start);
    if (pad >= 0) selectPad(pad, true);
  });
  wave.addEventListener('pointermove', (e) => {
    if (markDrag == null) return;
    const r = wave.getBoundingClientRect();
    const k = markDrag;
    const lo = S.slices[k - 1].start + 256;
    const hi = S.slices[k].end - 256;
    const at = Math.max(lo, Math.min(hi, Math.round(((e.clientX - r.left) / waveGeo.w) * waveGeo.n)));
    const old = S.slices[k].start;
    S.slices[k - 1].end = at;
    S.slices[k].start = at;
    for (const p of S.pads) {
      if (p.start === old) p.start = at;
      if (p.end === old) p.end = at;
    }
    drawWave();
  });
  const endMark = () => {
    if (markDrag == null) return;
    const k = markDrag;
    markDrag = null;
    const z = nearestZero(S.data, S.slices[k].start, 128);
    const old = S.slices[k].start;
    S.slices[k - 1].end = z;
    S.slices[k].start = z;
    for (const p of S.pads) {
      if (p.start === old) p.start = z;
      if (p.end === old) p.end = z;
    }
    kit?.setPads(S.pads);
    render();
  };
  wave.addEventListener('pointerup', endMark);
  wave.addEventListener('pointercancel', endMark);

  // ---- 자르기·BPM ----
  const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '자르는 방법' });
  const sens = knob({
    label: '예민함', min: 0, max: 1, value: S.sensitivity, size: 'sm', format: (v) => `${Math.round(v * 100)}%`,
    onChange: (v) => { S.sensitivity = v; if (S.mode === 'onset') { chop(); render(); } }, defaultValue: () => 0.5,
  });
  const bpmIn = h('input', { type: 'number', min: 40, max: 220, step: 0.1, class: 'bpm-input', 'aria-label': '소리의 BPM (추정, 틀리면 고쳐 쓰세요)' });
  bpmIn.addEventListener('change', () => { S.srcBpm = Math.max(40, Math.min(220, Number(bpmIn.value) || S.srcBpm)); render(); });
  const fitRead = h('span', { class: 'seg-read' });
  const fitBtn = h('button', { type: 'button', onclick: () => fitTempo() }, 'BPM 맞추기 (음높이 그대로)');
  function fitTempo() {
    if (!S.data) return;
    const target = app.studio.bpm;
    const factor = S.srcBpm / target;
    if (Math.abs(factor - 1) < 0.005) { app.notice('이미 같은 BPM 이에요.'); return; }
    if (factor < 0.5 || factor > 2) { app.notice('두 배 넘게 늘이거나 줄이면 소리가 많이 상해요. 소리의 BPM 을 확인하세요 (×2, ÷2).', 'bad'); return; }
    const out = timeStretch(S.data, factor);
    const name = S.name.replace(/ · \d+(\.\d+)? BPM 으로$/, '');
    setSource(out, S.sr, `${name} · ${target} BPM 으로`, target);
    app.notice(`음높이는 그대로 두고 길이만 ${Math.round(factor * 100)}% 로 바꿨어요 (${target} BPM).`, 'good');
  }

  // ---- 패드 ----
  const padGrid = h('div', { class: 'mpc-pads', role: 'group', 'aria-label': '패드 16개. 컴퓨터 키 A W S E … 로도 쳐요' });
  // MPC 처럼 1–4 가 맨 아래 줄
  const order = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];
  const KEY_LABELS = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P'];
  const padBtns = order.map((i) => {
    const b = h('button', { type: 'button', class: 'mpc-pad', dataset: { pad: i }, 'aria-label': `패드 ${i + 1}` },
      h('span', { class: 'mpc-no' }, String(i + 1)), h('span', { class: 'mpc-key' }, KEY_LABELS[i]), h('span', { class: 'mpc-info' }));
    b.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      await ensureKit();
      hit(i, 0.9);
      selectPad(i, false);
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ensureKit().then(() => hit(i, 0.9)); selectPad(i, false); }
    });
    return b;
  });
  padGrid.append(...padBtns);
  function hit(i, velocity) {
    const v = kit?.trigger(i, kit.ctx.currentTime, velocity);
    if (v) flash(i);
    if (S.rec && S.playing) {
      S.steps[i][nearestStep()] = velocity > 0.95 ? 2 : 1;
      renderGrid();
    }
    return v;
  }
  function flash(i) {
    const b = padBtns[order.indexOf(i)];
    b.classList.add('is-hit');
    setTimeout(() => b.classList.remove('is-hit'), 120);
  }
  function selectPad(i, play) {
    S.selected = i;
    if (play) ensureKit().then(() => hit(i, 0.85));
    render();
  }

  // ---- 고른 패드 ----
  const padTitle = h('h3', {});
  const padKnobs = [
    ['pitch', '음높이', -12, 12, 1, 'lin', (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)} st`, 0],
    ['gain', '볼륨', 0, 1, 0, 'lin', (v) => `${Math.round(v * 100)}%`, 0.85],
    ['cutoff', '필터', 200, 18000, 0, 'log', (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`), 18000],
    ['attack', '어택', 0.001, 0.3, 0, 'log', (v) => `${Math.round(v * 1000)} ms`, 0.002],
    ['release', '릴리즈', 0.01, 1.5, 0, 'log', (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`), 0.06],
  ].map(([key, label, min, max, step, scale, format, def]) => ({
    key,
    k: knob({
      label, min, max, step, scale, size: 'sm', format, value: def, defaultValue: () => def,
      onInput: (v) => setPad({ [key]: v }), onChange: (v) => setPad({ [key]: v }),
    }),
  }));
  const revBtn = h('button', { type: 'button', class: 'toggle small', 'aria-pressed': 'false' }, '거꾸로');
  revBtn.addEventListener('click', () => setPad({ reverse: !S.pads[S.selected].reverse }));
  const modeBtns = [['oneshot', '한 번'], ['gate', '누르는 동안']].map(([id, label]) => {
    const b = h('button', { type: 'button', class: 'seg-btn', dataset: { mode: id } }, label);
    b.addEventListener('click', () => setPad({ mode: id }));
    return b;
  });
  const chokeBtns = CHOKES.map((c) => {
    const b = h('button', { type: 'button', class: 'seg-btn', dataset: { choke: c.id } }, c.label);
    b.addEventListener('click', () => setPad({ choke: c.id }));
    return b;
  });
  const sliceSel = h('select', { 'aria-label': '이 패드의 조각' });
  sliceSel.addEventListener('change', () => {
    const sl = S.slices[Number(sliceSel.value)];
    if (sl) setPad({ start: sl.start, end: sl.end });
  });
  function setPad(change) {
    const p = S.pads[S.selected];
    if (!p) return;
    Object.assign(p, change);
    kit?.setPads(S.pads);
    renderPadEditor();
    renderPads();
    drawWave();
  }

  // ---- 시퀀서 ----
  const playBtn = h('button', { type: 'button', class: 'transport-btn', 'aria-pressed': 'false' }, '▶ 재생');
  const recBtn = h('button', { type: 'button', class: 'transport-btn rec', 'aria-pressed': 'false' }, '● 찍어 넣기');
  const seqBpm = h('input', { type: 'number', min: 40, max: 200, step: 1, class: 'bpm-input', 'aria-label': '패턴 BPM (루퍼와 같이 씀)' });
  const swingK = knob({
    label: '스윙', min: 0.5, max: 0.75, step: 0.01, value: S.swing, size: 'sm', format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => { S.swing = v; }, onChange: (v) => { S.swing = v; }, defaultValue: () => 0.58,
  });
  const grid = h('div', { class: 'step-grid', role: 'grid', 'aria-label': '16칸 스텝 시퀀서. 칸을 누르면 켜짐 → 세게 → 꺼짐' });
  const stepCells = [];
  for (let p = 0; p < PAD_COUNT; p++) {
    const row = h('div', { class: 'step-row', role: 'row' }, h('button', { type: 'button', class: 'step-label', onclick: () => selectPad(p, true) }, String(p + 1)));
    stepCells[p] = [];
    for (let s = 0; s < STEPS; s++) {
      const c = h('button', { type: 'button', class: `step${s % 4 === 0 ? ' beat' : ''}`, role: 'gridcell', 'aria-label': `패드 ${p + 1}, ${s + 1}번째 칸` });
      c.addEventListener('click', () => {
        S.steps[p][s] = (S.steps[p][s] + 1) % 3;
        renderGrid();
      });
      stepCells[p][s] = c;
      row.append(c);
    }
    grid.append(row);
  }
  playBtn.addEventListener('click', () => (S.playing ? stopSeq() : playSeq()));
  recBtn.addEventListener('click', () => { S.rec = !S.rec; render(); });
  seqBpm.addEventListener('change', () => {
    const v = Math.min(200, Math.max(40, Math.round(Number(seqBpm.value) || app.studio.bpm)));
    const beat = S.playing ? (app.studio.ctx.currentTime - S.t0) / (60 / app.studio.bpm) : 0;
    app.setTempo(v);
    if (S.playing) S.t0 = app.studio.ctx.currentTime - beat * (60 / v);
    render();
  });
  const beatSec = () => 60 / app.studio.bpm;
  const nearestStep = () => {
    const b = ((app.studio.ctx.currentTime - S.t0) / beatSec()) % 4;
    return Math.round(b * 4) % STEPS;
  };
  function tick() {
    const ctx = app.studio.ctx;
    const bs = beatSec();
    const until = ctx.currentTime + AHEAD;
    // S.scheduled: 다음에 넣을 칸의 절대 번호
    for (;;) {
      const k = S.scheduled;
      const bar = Math.floor(k / STEPS);
      const s = k % STEPS;
      const at = S.t0 + (bar * 4 + stepBeat(s, S.swing)) * bs;
      if (at >= until) break;
      for (let p = 0; p < PAD_COUNT; p++) {
        const v = S.steps[p][s];
        if (v && at >= ctx.currentTime - 0.01) kit.trigger(p, Math.max(ctx.currentTime, at), v === 2 ? 1 : 0.7);
      }
      S.scheduled++;
    }
  }
  async function playSeq() {
    const k = await ensureKit();
    if (!S.data) { app.notice('먼저 소리를 고르세요.', 'bad'); return; }
    S.t0 = k.ctx.currentTime + 0.08;
    S.scheduled = 0;
    S.playing = true;
    clearInterval(S.timer);
    S.timer = setInterval(tick, 25);
    tick();
    render();
  }
  function stopSeq() {
    clearInterval(S.timer);
    S.timer = null;
    S.playing = false;
    kit?.allOff();
    render();
  }

  // ---- 로파이·내보내기 ----
  const bitsK = knob({
    label: '비트', min: 4, max: 16, step: 1, value: 16, size: 'sm', format: (v) => (v >= 16 ? '끔' : `${v} bit`),
    onChange: (v) => setFx({ bits: v }), onInput: (v) => setFx({ bits: v }), defaultValue: () => 16,
  });
  const lofiK = knob({
    label: '테이프·잡음', min: 0, max: 1, value: 0, size: 'sm', format: (v) => `${Math.round(v * 100)}%`,
    onChange: (v) => setFx({ lofi: v }), onInput: (v) => setFx({ lofi: v }), defaultValue: () => 0,
  });
  const rateBtns = RATES.map((r) => {
    const b = h('button', { type: 'button', class: 'seg-btn', dataset: { rate: r.id } }, r.label);
    b.addEventListener('click', () => setFx({ rate: r.id }));
    return b;
  });
  const lofiPresets = [
    ['깨끗하게', { bits: 16, lofi: 0, rate: 44100 }],
    ['SP-1200 느낌', { bits: 12, lofi: 0.25, rate: 26040 }],
    ['낡은 카세트', { bits: 14, lofi: 0.75, rate: 44100 }],
    ['아주 거칠게', { bits: 8, lofi: 0.5, rate: 12000 }],
  ].map(([label, fx]) => chipButton(label, () => setFx(fx)));
  function setFx(fx) {
    S.fx = { ...S.fx, ...fx };
    kit?.setFx(S.fx);
    renderFx();
  }
  const exportBtn = h('button', { type: 'button', class: 'primary' }, 'WAV 로 내보내기 (2바퀴)');
  exportBtn.addEventListener('click', async () => {
    if (!S.data) return;
    exportBtn.disabled = true;
    try {
      const buf = await renderPattern({ data: S.data, sr: S.sr, pads: S.pads, steps: S.steps, fx: S.fx, bpm: app.studio.bpm, swing: S.swing, loops: 2 });
      const mono = toMono([buf.getChannelData(0), buf.getChannelData(1)]);
      const r = await saveFile(`샘플 패드 ${app.studio.bpm}BPM.wav`, encodeWav(mono, buf.sampleRate), 'audio/wav');
      if (r !== 'saved') app.notice('이 화면에서는 파일을 저장할 수 없어요.', 'bad');
    } finally {
      exportBtn.disabled = false;
    }
  });

  root.append(h('div', { class: 'pads-view' },
    h('div', { class: 'tone-head' },
      h('div', {}, h('h2', {}, '샘플 패드'),
        h('p', { class: 'panel-hint' }, '소리를 잘라 16개 패드에 올리고, 16칸 패턴으로 찍어요. 패드 1–16 = 컴퓨터 키 A W S E D F T G Y H U J K O L P.')),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'primary', onclick: () => { const d = demoBeat(44100); setSource(d.data, d.sr, d.name, d.bpm); } }, '데모 비트'),
        h('label', { class: 'file-btn', for: fileInput.id }, '음원 열기', fileInput),
        useSampleBtn)),
    panel('자르기', { cls: 'pads-chop', hint: '조각마다 패드 하나. 파형의 번호 표시를 끌어 자리를 옮길 수 있어요' },
      h('div', { class: 'chop-row' }, srcName),
      wave,
      h('div', { class: 'chop-row' }, modeSeg, sens.el,
        h('span', { class: 'bpm-field' }, h('span', { class: 'label' }, '소리 BPM'), bpmIn,
          h('button', { type: 'button', class: 'icon-btn small', title: '두 배', onclick: () => { S.srcBpm = Math.min(220, S.srcBpm * 2); render(); } }, '×2'),
          h('button', { type: 'button', class: 'icon-btn small', title: '절반', onclick: () => { S.srcBpm = Math.max(40, S.srcBpm / 2); render(); } }, '÷2')),
        fitBtn, fitRead)),
    h('div', { class: 'pads-mid' },
      panel('패드', { cls: 'pads-grid-panel', hint: '누르면 소리 나요. 같은 색 = 같은 끊김 그룹' }, padGrid),
      panel('고른 패드', { cls: 'pad-editor' },
        padTitle,
        h('div', { class: 'ctl' }, h('span', { class: 'label' }, '조각'), h('span'), sliceSel),
        h('div', { class: 'knobs' }, ...padKnobs.map((x) => x.k.el)),
        h('div', { class: 'btn-row' }, revBtn, h('div', { class: 'seg', role: 'group', 'aria-label': '재생 방식' }, ...modeBtns)),
        h('div', { class: 'ctl ctl-seg' }, h('span', { class: 'label' }, '끊김 그룹 (같은 그룹끼리 서로 멈춤 — 열린·닫힌 하이햇)'),
          h('div', { class: 'seg', role: 'group', 'aria-label': '끊김 그룹' }, ...chokeBtns)))),
    panel('패턴', { cls: 'pads-seq', hint: '칸을 누르면 켜짐 → 세게 → 꺼짐. 스윙은 16분 두 개 중 뒤의 것을 늦춰 MPC 처럼 밀고 당겨요' },
      h('div', { class: 'transport' },
        h('div', { class: 'transport-main' }, playBtn, recBtn),
        h('div', { class: 'transport-fields' },
          h('label', { class: 'bpm-field' }, h('span', { class: 'label' }, 'BPM'), seqBpm), swingK.el,
          h('button', { type: 'button', class: 'quiet', title: '첫 마디의 조각들을 원래 자리에', onclick: () => { S.steps = S.pads.length ? replayPattern(S.pads, S.sr, S.srcBpm) : starterPattern(); renderGrid(); } }, '원래 순서대로'),
          h('button', { type: 'button', class: 'quiet', title: '1번 킥 · 2번 스네어 · 3번 하이햇 자리', onclick: () => { S.steps = starterPattern(S.slices.length); renderGrid(); } }, '붐뱁 뼈대'),
          h('button', { type: 'button', class: 'quiet', onclick: () => { S.steps = Array.from({ length: PAD_COUNT }, () => new Array(STEPS).fill(0)); renderGrid(); } }, '모두 지우기'))),
      h('div', { class: 'step-wrap' }, grid)),
    panel('로파이 · 내보내기', { cls: 'pads-lofi', hint: '옛 샘플러처럼 거칠게. 남의 음반을 잘라 발표하려면 저작권자의 허락(샘플 클리어런스)이 필요해요. 우리가 녹음한 소리나 데모 비트는 자유롭게 써도 돼요' },
      h('div', { class: 'chip-row' }, ...lofiPresets),
      h('div', { class: 'chop-row' }, bitsK.el, lofiK.el, h('div', { class: 'seg', role: 'group', 'aria-label': '샘플레이트' }, ...rateBtns)),
      h('div', { class: 'btn-row' }, exportBtn))));

  // ---- 그리기 ----
  function renderPads() {
    padBtns.forEach((b) => {
      const i = Number(b.dataset.pad);
      const p = S.pads[i];
      const k = p ? S.slices.findIndex((s) => s.start === p.start) : -1;
      b.setAttribute('aria-pressed', String(i === S.selected));
      b.dataset.choke = String(p?.choke ?? 0);
      b.style.setProperty('--pc', `var(--${CHOKE_COLORS[p?.choke ?? 0]})`);
      b.querySelector('.mpc-info').textContent = p ? `${k >= 0 ? `조각 ${k + 1}` : '조각'}${p.pitch ? ` · ${p.pitch > 0 ? '+' : ''}${p.pitch}` : ''}${p.reverse ? ' · 거꾸로' : ''}` : '비어 있음';
      b.disabled = !p;
    });
  }
  function renderPadEditor() {
    const p = S.pads[S.selected];
    padTitle.textContent = p ? `패드 ${S.selected + 1} · ${((p.end - p.start) / S.sr).toFixed(2)}초` : '패드';
    if (!p) return;
    for (const { key, k } of padKnobs) k.set(p[key]);
    revBtn.setAttribute('aria-pressed', String(p.reverse));
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === p.mode)));
    chokeBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.choke) === p.choke)));
    sliceSel.replaceChildren(...S.slices.map((s, i) => h('option', { value: i, selected: s.start === p.start || null }, `조각 ${i + 1} (${(s.start / S.sr).toFixed(2)}초)`)));
  }
  function renderGrid() {
    for (let p = 0; p < PAD_COUNT; p++) for (let s = 0; s < STEPS; s++) {
      const v = S.steps[p][s];
      stepCells[p][s].dataset.v = String(v);
      stepCells[p][s].setAttribute('aria-pressed', String(v > 0));
    }
  }
  function renderFx() {
    bitsK.set(S.fx.bits);
    lofiK.set(S.fx.lofi);
    rateBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === S.fx.rate)));
  }
  function render() {
    srcName.textContent = S.data ? `${S.name} · ${(S.data.length / S.sr).toFixed(1)}초 · 조각 ${S.slices.length}개` : '데모 비트를 누르거나 음원을 여세요';
    modeSeg.replaceChildren(...CHOP_MODES.map((m) => {
      const b = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(m.id === S.mode) }, m.label);
      b.addEventListener('click', () => { S.mode = m.id; chop(); render(); });
      return b;
    }));
    sens.el.hidden = S.mode !== 'onset';
    if (document.activeElement !== bpmIn) bpmIn.value = String(Math.round(S.srcBpm * 10) / 10);
    fitRead.textContent = `맞출 BPM ${app.studio.bpm} (루퍼·패턴과 같이 씀)`;
    fitBtn.disabled = !S.data;
    playBtn.textContent = S.playing ? '■ 정지' : '▶ 재생';
    playBtn.setAttribute('aria-pressed', String(S.playing));
    recBtn.setAttribute('aria-pressed', String(S.rec));
    if (document.activeElement !== seqBpm) seqBpm.value = String(app.studio.bpm);
    exportBtn.disabled = !S.data;
    renderPads();
    renderPadEditor();
    renderGrid();
    renderFx();
    requestAnimationFrame(drawWave);
  }
  let lastCol = -1;
  app.onFrame(() => {
    if (root.hidden || !S.playing) {
      if (lastCol >= 0) { grid.querySelectorAll('.step.now').forEach((c) => c.classList.remove('now')); lastCol = -1; }
      return;
    }
    const col = nearestStepFloor();
    if (col === lastCol) return;
    grid.querySelectorAll('.step.now').forEach((c) => c.classList.remove('now'));
    for (let p = 0; p < PAD_COUNT; p++) stepCells[p][col].classList.add('now');
    lastCol = col;
  });
  const nearestStepFloor = () => {
    const b = ((app.studio.ctx.currentTime - S.t0) / beatSec()) % 4;
    return Math.max(0, Math.floor(b * 4)) % STEPS;
  };

  // 이 화면이 보이는 동안 건반·컴퓨터 키는 패드를 친다
  const target = {
    noteOn(midi, vel) {
      const i = midi - PAD_BASE_MIDI;
      if (i < 0 || i >= PAD_COUNT || !kit) return;
      const v = hit(i, vel);
      if (v) kit.held.set(midi, v);
    },
    noteOff(midi) { kit?.noteOff(midi); },
    sustain() {},
  };
  app.on('tab', async ({ to }) => {
    if (to === 'pads') {
      if (!S.data) { const d = demoBeat(44100); setSource(d.data, d.sr, d.name, d.bpm); }
      render();
      if (app.studio.ctx) await ensureKit();
      if (!app.keyTarget) app.keyTarget = target;
    } else if (app.keyTarget === target) app.keyTarget = null;
  });
  app.on('audio', () => { if (!root.hidden) ensureKit(); });
  app.on('tempo', render);
  app.on('resize', drawWave);
  app.on('panic', stopSeq);
  render();
  return {
    state: S,
    play: playSeq,
    stop: stopSeq,
    hit: async (i) => { await ensureKit(); hit(i, 0.9); },
    info: () => ({ playing: S.playing, slices: S.slices.length, srcBpm: S.srcBpm, name: S.name, voices: kit?.voices.size ?? 0, fx: S.fx, selected: S.selected, pads: S.pads }),
  };
}
