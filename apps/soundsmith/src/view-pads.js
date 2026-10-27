// 샘플 패드 (시안 H3 · 힙합 샘플링, MPC·SP-404 방식): 자르고 → 패드에 올리고 → 찍는다.
// 위: 소리 재료(파일·마이크·실험실 샘플·데모 비트), 파형과 자른 자리, 자르기 방법·원래 빠르기(믿음)·맞출 BPM.
// 가운데: 4×4 패드(건반 음·짐작한 이름·끊김 그룹)와 고른 패드. 아래: 스텝 시퀀서(1·2마디, 지운 칸 되돌리기)와 로파이·내보내기.
// 패드 1 = 컴퓨터 키 A (C4).
import { h, knob, chipButton, nextId } from './ui.js';
import { color, fit } from './draw.js';
import { PadKit, PAD_COUNT, STEPS, MAX_BARS, CHOKES, RATES, PAD_BASE_MIDI, defaultPad, starterPattern, replayPattern, stepBeat, renderPattern, toBars } from './pads.js';
import { demoBeat, detectOnsets, gridStarts, slicesFrom, nearestZero, estimateTempo, timeStretch, nameSlices } from './chop.js';
import { toMono, peaks, encodeWav } from './sample.js';
import { noteName } from './tuning.js';
import { saveFile } from './store.js';
import { micButton } from './mic.js';

const CHOP_MODES = [
  { id: 'onset', label: '소리 시작점 감지' },
  { id: 'grid8', label: '8칸' },
  { id: 'grid16', label: '16칸' },
  { id: 'manual', label: '직접' },
];
const CHOKE_COLORS = ['brass', 'signal', 'rose', 'sky'];
const KEY_LABELS = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P'];
const TONAL = ['stab', 'bass'];
const LOFI_PRESETS = [
  ['SP-1200 느낌', { bits: 12, rate: 26040, noise: 0.2, wobble: 0.15 }],
  ['카세트', { bits: 14, rate: 44100, noise: 0.35, wobble: 0.6 }],
  ['아주 거칠게', { bits: 8, rate: 12000, noise: 0.45, wobble: 0.3 }],
  ['깨끗하게', { bits: 16, rate: 44100, noise: 0, wobble: 0 }],
];
const AHEAD = 0.12;
const trustOf = (c) => (c >= 0.6 ? ['높음', 'good'] : c >= 0.35 ? ['보통', 'warn'] : ['낮음 · 직접 고쳐 쓰세요', 'bad']);
const blank = () => Array.from({ length: PAD_COUNT }, () => new Array(STEPS * MAX_BARS).fill(0));

export function PadsView(root, app) {
  const S = {
    data: null, sr: 44100, name: '', desc: '', srcBpm: 90, confidence: 1, bpmTyped: false,
    mode: 'onset', sensitivity: 0.5,
    slices: [], names: [], pads: [], selected: 0,
    steps: toBars(starterPattern()), bars: 1, swing: 0.58, undo: [],
    fx: { bits: 16, rate: 44100, noise: 0, wobble: 0, lofi: 0 },
    fitBpm: null,
    bar2Edited: false, // 2마디째를 손댔는지 (안 댔으면 2마디로 늘릴 때 1마디를 베낀다)
    playing: false, rec: false, t0: 0, bpmAt: 120, scheduled: 0, timer: null, skip: new Set(),
  };
  const len = () => S.bars * STEPS;
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

  // ---- 소리 재료 ----
  const fileInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac', class: 'visually-hidden', id: nextId('padsrc') });
  const srcTitle = h('strong', { class: 'src-title' });
  const srcDesc = h('span', { class: 'src-desc' });
  const micBtn = h('button', { type: 'button' }, '마이크로 녹음');
  const useSampleBtn = h('button', { type: 'button', onclick: () => {
    if (!app.sample) { app.notice('실험실 샘플 상자에 아직 소리가 없어요.', 'bad'); return; }
    setSource(app.sample.data, app.sample.sr, app.sample.name, { desc: '실험실의 지금 샘플' });
  } }, '실험실의 지금 샘플');
  const demoBtn = h('button', { type: 'button', class: 'quiet', onclick: loadDemo }, '데모 비트');
  function loadDemo() {
    const d = demoBeat(44100);
    setSource(d.data, d.sr, '데모 비트', { bpm: d.bpm, desc: '직접 합성한 붐뱁' });
  }
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    srcTitle.textContent = `${f.name} 여는 중…`;
    try {
      const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await f.arrayBuffer());
      const mono = toMono(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)));
      // 너무 길면 앞 30초만 (잘라 쓰는 소리는 보통 몇 마디)
      setSource(mono.subarray(0, Math.min(mono.length, buf.sampleRate * 30)), buf.sampleRate, f.name.replace(/\.[^.]+$/, '').slice(0, 40), { desc: '불러온 음원' });
    } catch {
      renderSource();
      app.notice('이 파일은 열 수 없어요. mp3·wav·m4a 같은 오디오 파일인지 확인하세요.', 'bad');
    }
  });
  micButton(app, micBtn, {
    maxSec: 15,
    idleLabel: '마이크로 녹음',
    hint: '비트박스나 손뼉, 건반 소리를 녹음해 보세요. 이어폰을 끼면 스피커 소리가 섞이지 않아요.',
    onBuffer: (buf) => setSource(toMono([buf.getChannelData(0)]), buf.sampleRate, '내 녹음', { desc: '마이크로 녹음' }),
  });

  function setSource(data, sr, name, { bpm = null, desc = '' } = {}) {
    S.data = data;
    S.sr = sr;
    S.name = name;
    S.desc = desc;
    const est = bpm ? { bpm, confidence: 1 } : estimateTempo(data, sr);
    S.srcBpm = est.bpm || 90;
    S.confidence = est.bpm ? est.confidence : 0;
    S.bpmTyped = false;
    if (S.mode === 'manual') S.mode = 'onset';
    chop();
    S.steps = toBars(replayPattern(S.pads, S.sr, S.srcBpm));
    S.bar2Edited = false;
    S.undo = [];
    kit?.setSource(data, sr);
    render();
  }

  function chop() {
    if (!S.data) return;
    const n = S.data.length;
    const starts = S.mode === 'onset'
      ? detectOnsets(S.data, S.sr, { sensitivity: S.sensitivity, max: PAD_COUNT }).map((i) => nearestZero(S.data, i, 128))
      : S.mode === 'manual' ? S.slices.map((s) => s.start) : gridStarts(n, S.mode === 'grid8' ? 8 : 16).map((i) => nearestZero(S.data, i, 128));
    applyStarts(starts);
  }
  // 자른 자리 → 조각 → 패드 (패드 설정·직접 붙인 이름은 그대로 두고 자리만 바꾼다).
  // keep: 손으로 자리를 더하거나 옮기거나 지울 때는 패드가 원래 쓰던 소리(그 시작점을 품은 조각)를 그대로 쓴다.
  // 아니면(자르는 방법을 바꿀 때) 패드 i = 조각 i.
  function applyStarts(starts, { keep = false } = {}) {
    S.slices = slicesFrom(starts, S.data.length);
    S.names = nameSlices(S.data, S.sr, S.slices);
    S.pads = Array.from({ length: PAD_COUNT }, (_, i) => {
      const prev = S.pads[i];
      const own = keep && prev ? S.slices.find((x) => prev.start >= x.start && prev.start < x.end) : null;
      const sl = own ?? S.slices[i % S.slices.length];
      return prev ? { ...prev, start: sl.start, end: sl.end } : defaultPad(sl);
    });
    S.selected = Math.min(S.selected, PAD_COUNT - 1);
    kit?.setPads(S.pads);
  }
  const sliceOf = (p) => (p ? S.slices.findIndex((s) => s.start === p.start) : -1);
  const padName = (i) => {
    const p = S.pads[i];
    if (!p) return '비어 있음';
    if (p.name) return p.name;
    return S.names[sliceOf(p)]?.label ?? `조각`;
  };
  const padKind = (i) => S.names[sliceOf(S.pads[i])]?.kind ?? 'perc';

  // ---- 파형 + 자른 자리 ----
  const wave = h('canvas', { class: 'pads-wave', 'aria-label': '소리 파형과 자른 자리. 눌러서 조각(패드)을 고르고, 번호 표시를 끌어 옮기고, 두 번 눌러 지워요. 직접 모드에서는 눌러서 자를 자리를 더해요' });
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
    const sel = S.pads[S.selected];
    if (sel) {
      g.fillStyle = color('brass-wash');
      g.fillRect(xOf(sel.start), 0, Math.max(2, xOf(sel.end) - xOf(sel.start)), hh);
    }
    const pk = peaks(S.data, Math.max(50, Math.round(w / 2)));
    const cols = pk.length / 2;
    const mid = hh / 2 + 6;
    const amp = hh / 2 - 14;
    g.fillStyle = color('muted');
    for (let b = 0; b < cols; b++) {
      const y1 = mid - pk[b * 2 + 1] * amp;
      const y2 = mid - pk[b * 2] * amp;
      g.fillRect(b * (w / cols), y1, Math.max(1, w / cols - 0.6), Math.max(1, y2 - y1));
    }
    // 마디 표시 (원래 빠르기 기준)
    const barLen = S.sr * 4 * (60 / S.srcBpm);
    g.font = `10px ${color('font-data')}`;
    g.fillStyle = color('faint');
    for (let k = 0; k * barLen < n - S.sr * 0.2 && k < 64; k++) g.fillText(`${k + 1}마디`, xOf(k * barLen) + 4, hh - 4);
    S.slices.forEach((s, i) => {
      const x = Math.round(xOf(s.start)) + 0.5;
      const on = sel?.start === s.start;
      g.strokeStyle = color(on ? 'brass-hi' : 'signal');
      g.lineWidth = on ? 2 : 1;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, hh);
      g.stroke();
      const label = String(i + 1);
      const tw = Math.max(16, g.measureText(label).width + 8);
      g.fillStyle = color(on ? 'brass' : 'signal');
      g.beginPath();
      g.roundRect(x, 2, tw, 14, 3);
      g.fill();
      g.fillStyle = color('brass-ink');
      g.fillText(label, x + 4, 13);
    });
    g.lineWidth = 1;
    waveGeo = { w, n };
  }
  let markDrag = null;
  const waveAt = (e) => {
    const r = wave.getBoundingClientRect();
    const x = e.clientX - r.left;
    return { x, at: Math.round((x / waveGeo.w) * waveGeo.n) };
  };
  const nearMark = (x) => S.slices.findIndex((s, k) => k > 0 && Math.abs((s.start / waveGeo.n) * waveGeo.w - x) < 9);
  wave.addEventListener('pointerdown', (e) => {
    if (!waveGeo || !S.data) return;
    const { x, at } = waveAt(e);
    const near = nearMark(x);
    if (near > 0) {
      markDrag = { k: near, moved: false };
      wave.setPointerCapture(e.pointerId);
      return;
    }
    if (S.mode === 'manual' && S.slices.length < PAD_COUNT) {
      // 직접 자르기: 누른 자리에 새로 자른다
      const z = nearestZero(S.data, at, 128);
      if (S.slices.every((s) => Math.abs(s.start - z) > 512)) {
        applyStarts([...S.slices.map((s) => s.start), z], { keep: true });
        const k = S.slices.findIndex((s) => s.start === z);
        // 새 조각은 앞 패드와 같은 소리를 겹쳐 쓰던 패드(남는 패드) 하나에 올린다
        const pad = S.pads.findIndex((p, i) => S.pads.slice(0, i).some((q) => q.start === p.start));
        if (pad >= 0) S.pads[pad] = defaultPad(S.slices[k]);
        kit?.setPads(S.pads);
        render();
        if (pad >= 0) selectPad(pad, true);
        app.notice(`${k + 1}번 자리에서 잘랐어요 (조각 ${S.slices.length}개).`);
        return;
      }
    }
    const k = S.slices.findIndex((s) => at >= s.start && at < s.end);
    const pad = S.pads.findIndex((p) => p.start === S.slices[k]?.start);
    if (pad >= 0) selectPad(pad, true);
  });
  wave.addEventListener('pointermove', (e) => {
    if (!markDrag) return;
    const { k } = markDrag;
    const lo = S.slices[k - 1].start + 256;
    const hi = S.slices[k].end - 256;
    const at = Math.max(lo, Math.min(hi, waveAt(e).at));
    moveMark(k, at);
    markDrag.moved = true;
    drawWave();
  });
  function moveMark(k, at) {
    const old = S.slices[k].start;
    S.slices[k - 1].end = at;
    S.slices[k].start = at;
    for (const p of S.pads) {
      if (p.start === old) p.start = at;
      if (p.end === old) p.end = at;
    }
  }
  const endMark = () => {
    if (!markDrag) return;
    const { k, moved } = markDrag;
    markDrag = null;
    if (!moved) return;
    moveMark(k, nearestZero(S.data, S.slices[k].start, 128));
    // 손으로 옮긴 자리는 '직접' 으로 남겨 둔다 (민감도를 바꿔도 지워지지 않게)
    S.mode = 'manual';
    applyStarts(S.slices.map((s) => s.start), { keep: true });
    render();
  };
  wave.addEventListener('pointerup', endMark);
  wave.addEventListener('pointercancel', endMark);
  wave.addEventListener('dblclick', (e) => {
    if (!waveGeo) return;
    const k = nearMark(waveAt(e).x);
    if (k <= 0) return;
    S.mode = 'manual';
    applyStarts(S.slices.filter((_, i) => i !== k).map((s) => s.start), { keep: true });
    render();
    app.notice(`${k + 1}번 자른 자리를 지웠어요 (조각 ${S.slices.length}개).`);
  });

  // ---- 자르기·빠르기 ----
  const modeSeg = h('div', { class: 'seg chop-seg', role: 'group', 'aria-label': '자르는 방법' });
  const sens = knob({
    label: '민감도', min: 0, max: 1, value: S.sensitivity, size: 'sm', format: (v) => `${Math.round(v * 100)}%`,
    onChange: (v) => { S.sensitivity = v; if (S.mode === 'onset') { chop(); render(); } }, defaultValue: () => 0.5,
  });
  const manualHint = h('p', { class: 'panel-hint chop-hint' }, '직접: 파형을 눌러 자를 자리를 더하고, 번호를 끌어 옮기고, 두 번 눌러 지워요 (16조각까지).');
  const srcBpmIn = h('input', { type: 'number', min: 40, max: 220, step: 0.1, class: 'src-bpm', 'aria-label': '원래 빠르기 BPM (추정, 틀리면 고쳐 쓰세요)' });
  srcBpmIn.addEventListener('change', () => {
    S.srcBpm = Math.max(40, Math.min(220, Number(srcBpmIn.value) || S.srcBpm));
    S.bpmTyped = true;
    render();
  });
  const trust = h('span', { class: 'trust' });
  const fitIn = h('input', { type: 'number', min: 40, max: 200, step: 1, class: 'bpm-input', 'aria-label': '맞출 BPM' });
  fitIn.addEventListener('change', () => { S.fitBpm = Math.max(40, Math.min(200, Math.round(Number(fitIn.value) || app.studio.bpm))); render(); });
  const fitBtn = h('button', { type: 'button', class: 'primary', onclick: () => fitTempo() }, 'BPM 맞추기 (음높이 그대로)');
  function fitTempo() {
    if (!S.data) return;
    const target = S.fitBpm ?? app.studio.bpm;
    const factor = S.srcBpm / target;
    if (Math.abs(factor - 1) < 0.005) { app.notice('이미 같은 BPM 이에요.'); return; }
    if (factor < 0.5 || factor > 2) { app.notice('두 배 넘게 늘이거나 줄이면 소리가 많이 상해요. 원래 빠르기를 확인하세요 (×2, ÷2).', 'bad'); return; }
    const out = timeStretch(S.data, factor);
    const desc = S.desc.replace(/ · \d+(\.\d+)? BPM 으로 맞춤$/, '');
    setSource(out, S.sr, S.name, { bpm: target, desc: `${desc} · ${target} BPM 으로 맞춤` });
    S.fitBpm = null;
    app.setTempo(target);
    app.notice(`음높이는 그대로 두고 길이만 ${Math.round(factor * 100)}% 로 바꿨어요 (${target} BPM). 패턴도 이 빠르기로 돌아요.`, 'good');
  }

  // ---- 패드 ----
  const padGrid = h('div', { class: 'mpc-pads', role: 'group', 'aria-label': '패드 16개. 컴퓨터 키 A W S E … 로도 쳐요' });
  // MPC 처럼 1–4 가 맨 아래 줄
  const order = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];
  const padBtns = order.map((i) => {
    const choke = h('span', { class: 'mpc-choke', hidden: true });
    const name = h('strong', { class: 'mpc-name' });
    const info = h('span', { class: 'mpc-info' });
    const b = h('button', { type: 'button', class: 'mpc-pad', dataset: { pad: i }, title: `컴퓨터 키 ${KEY_LABELS[i]}` },
      h('span', { class: 'mpc-top' }, h('span', { class: 'mpc-no' }, `${i + 1} · ${noteName(PAD_BASE_MIDI + i)}`), choke), name, info);
    b.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      await ensureKit();
      hit(i, 0.9);
      selectPad(i, false);
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ensureKit().then(() => hit(i, 0.9)); selectPad(i, false); }
    });
    return { b, i, choke, name, info };
  });
  padGrid.append(...padBtns.map((x) => x.b));
  const chokeLegend = h('div', { class: 'pads-legend' },
    ...CHOKES.slice(1).map((c) => h('span', { class: `choke-chip choke-${c.id}` }, `${c.label} 그룹`)),
    h('span', { class: 'panel-hint' }, '색 글자 = 끊김 그룹 · 금색 = 지금 울림'));
  function hit(i, velocity) {
    const v = kit?.trigger(i, kit.ctx.currentTime, velocity);
    if (v) flash(i);
    if (S.rec && S.playing) {
      const k = nearestAbs();
      const s = k % len();
      S.steps[i][s] = velocity > 0.95 ? 2 : 1;
      if (s >= STEPS) S.bar2Edited = true;
      // 손으로 친 소리가 이미 났으니, 아직 예약 안 된 바로 그 칸은 이번 한 번 건너뛴다
      if (k >= S.scheduled) S.skip.add(`${i}:${k}`);
      renderGrid(true);
    }
    return v;
  }
  function flash(i) {
    const b = padBtns.find((x) => x.i === i).b;
    b.classList.add('is-hit');
    setTimeout(() => b.classList.remove('is-hit'), 140);
  }
  function selectPad(i, play) {
    const rowsChange = S.selected !== i;
    S.selected = i;
    if (play) ensureKit().then(() => hit(i, 0.85));
    renderPads();
    renderPadEditor();
    if (rowsChange) renderGrid(true);
    drawWave();
  }

  // ---- 고른 패드 ----
  const padTitle = h('h3', { class: 'pad-title' });
  const padMeta = h('span', { class: 'pad-meta' });
  const padKnobs = [
    ['pitch', '음높이', -12, 12, 1, 'lin', (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)} st`, 0, 'brass'],
    ['gain', '볼륨', 0, 1, 0, 'lin', (v) => `${Math.round(v * 100)}%`, 0.85, 'brass'],
    ['cutoff', '필터', 200, 18000, 0, 'log', (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`), 18000, 'signal'],
    ['attack', '어택', 0.001, 0.3, 0, 'log', (v) => `${Math.round(v * 1000)} ms`, 0.002, 'signal'],
    ['release', '릴리즈', 0.01, 1.5, 0, 'log', (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`), 0.06, 'signal'],
  ].map(([key, label, min, max, step, scale, format, def, tone]) => ({
    key,
    k: knob({
      label, min, max, step, scale, size: 'sm', tone, format, value: def, defaultValue: () => def,
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
    const b = h('button', { type: 'button', class: `seg-btn choke-btn choke-${c.id}`, dataset: { choke: c.id } }, c.label);
    b.addEventListener('click', () => setPad({ choke: c.id }));
    return b;
  });
  const sliceSel = h('select', { 'aria-label': '이 패드의 조각' });
  sliceSel.addEventListener('change', () => {
    const sl = S.slices[Number(sliceSel.value)];
    if (sl) { setPad({ start: sl.start, end: sl.end }); renderGrid(true); }
  });
  const nameIn = h('input', { type: 'text', class: 'text-input pad-name-in', maxlength: '16', 'aria-label': '패드 이름 (비우면 짐작한 이름)' });
  nameIn.addEventListener('change', () => { setPad({ name: nameIn.value.trim() || null }); renderGrid(true); });
  function setPad(change) {
    const p = S.pads[S.selected];
    if (!p) return;
    Object.assign(p, change);
    kit?.setPads(S.pads);
    renderPadEditor();
    renderPads();
    drawWave();
  }
  const edRow = (label, ...body) => h('div', { class: 'pad-ed-row' }, h('span', { class: 'label' }, label), h('div', { class: 'pad-ed-ctl' }, ...body));

  // ---- 시퀀서 ----
  const playBtn = h('button', { type: 'button', class: 'transport-btn seq-play', 'aria-pressed': 'false' }, '▶ 재생');
  const recBtn = h('button', { type: 'button', class: 'transport-btn rec seq-rec', 'aria-pressed': 'false' }, '● 녹음');
  const posOut = h('output', { class: 'seq-pos', 'aria-label': '지금 마디.칸' }, '1.1');
  const seqBpm = h('input', { type: 'number', min: 40, max: 200, step: 1, class: 'bpm-input', 'aria-label': '패턴 BPM (루퍼와 같이 씀)' });
  const swingK = knob({
    label: '스윙', min: 0.5, max: 0.75, step: 0.01, value: S.swing, size: 'sm', format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => { S.swing = v; app.renderHeader(); }, onChange: (v) => { S.swing = v; app.renderHeader(); }, defaultValue: () => 0.58,
  });
  const barsSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '패턴 길이' },
    ...[1, 2].map((n) => h('button', { type: 'button', class: 'seg-btn', dataset: { bars: n }, onclick: () => setBars(n) }, `${n}마디`)));
  const undoBtn = h('button', { type: 'button', class: 'seq-undo', onclick: undo }, '지운 칸 되돌리기');
  const grid = h('div', { class: 'step-grid', role: 'grid', 'aria-label': '스텝 시퀀서. 칸을 누르면 켜고 끄고, 누른 채 위아래로 끌면 세기' });
  let gridRows = [];
  let gridKey = '';
  function setBars(n) {
    if (n === S.bars) return;
    // 2마디째를 아직 손대지 않았으면 2마디로 늘릴 때 지금 1마디를 베껴 둔다
    if (n === 2 && !S.bar2Edited) S.steps = S.steps.map((row) => row.map((v, s) => (s < STEPS ? v : row[s - STEPS])));
    S.bars = n;
    render();
  }
  function remember() {
    S.undo.push(S.steps.map((row) => row.slice()));
    if (S.undo.length > 40) S.undo.shift();
  }
  function undo() {
    const prev = S.undo.pop();
    if (!prev) return;
    S.steps = prev;
    renderGrid(true);
  }
  const visibleRows = () => {
    const used = [];
    for (let p = 0; p < PAD_COUNT; p++) if (p === S.selected || S.steps[p].slice(0, len()).some((v) => v)) used.push(p);
    return used;
  };
  function setCell(p, s, v) {
    if (S.steps[p][s] && !v) remember();
    S.steps[p][s] = v;
    if (s >= STEPS) S.bar2Edited = true;
    renderGrid();
  }
  function buildGrid() {
    const rows = visibleRows();
    const n = len();
    gridRows = [];
    const head = h('div', { class: 'step-row step-head', role: 'row', style: `--n:${n}` }, h('span', { class: 'step-label' }),
      ...Array.from({ length: n }, (_, s) => h('span', { class: `step-no${s % 4 === 0 ? ' beat' : ''}`, role: 'columnheader' }, String((s % STEPS) + 1))));
    const body = rows.map((p) => {
      const tonal = TONAL.includes(padKind(p));
      const cells = Array.from({ length: n }, (_, s) => {
        const c = h('button', { type: 'button', class: `step${s % 4 === 0 ? ' beat' : ''}${s === STEPS ? ' bar2' : ''}`, role: 'gridcell', 'aria-label': `패드 ${p + 1} ${padName(p)}, ${Math.floor(s / STEPS) + 1}마디 ${(s % STEPS) + 1}번째 칸` });
        let drag = null;
        c.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          drag = { y: e.clientY, before: S.steps[p][s], moved: false };
          c.setPointerCapture(e.pointerId);
        });
        c.addEventListener('pointermove', (e) => {
          if (!drag) return;
          const dy = e.clientY - drag.y;
          if (Math.abs(dy) < 8) return;
          drag.moved = true;
          const v = dy < 0 ? 2 : 1;
          if (S.steps[p][s] !== v) { S.steps[p][s] = v; if (s >= STEPS) S.bar2Edited = true; renderGrid(); }
        });
        const up = () => {
          if (!drag) return;
          const { before, moved } = drag;
          drag = null;
          if (!moved) setCell(p, s, before ? 0 : 1);
        };
        c.addEventListener('pointerup', up);
        c.addEventListener('pointercancel', () => { drag = null; });
        c.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCell(p, s, S.steps[p][s] ? 0 : 1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCell(p, s, 2); }
          else if (e.key === 'ArrowDown' && S.steps[p][s]) { e.preventDefault(); setCell(p, s, 1); }
        });
        return c;
      });
      const label = h('button', { type: 'button', class: 'step-label', onclick: () => selectPad(p, true) }, h('span', { class: 'step-pno' }, String(p + 1)), ` ${padName(p)}`);
      gridRows.push({ p, cells, label });
      return h('div', { class: `step-row${tonal ? ' tonal' : ''}${p === S.selected ? ' is-selected' : ''}`, role: 'row', style: `--n:${n}` }, label, ...cells);
    });
    grid.replaceChildren(head, ...body);
    grid.style.setProperty('--n', n);
    lastCol = -1;
  }
  function renderGrid(rebuild = false) {
    const key = `${visibleRows().join(',')}|${len()}|${S.selected}|${S.pads.map((_, i) => padName(i)).join(',')}`;
    if (rebuild || key !== gridKey) {
      gridKey = key;
      buildGrid();
    }
    for (const { p, cells } of gridRows) cells.forEach((c, s) => {
      const v = S.steps[p][s];
      c.dataset.v = String(v);
      c.setAttribute('aria-pressed', String(v > 0));
    });
    undoBtn.disabled = !S.undo.length;
  }
  playBtn.addEventListener('click', () => (S.playing ? stopSeq() : playSeq()));
  recBtn.addEventListener('click', () => { S.rec = !S.rec; render(); });
  seqBpm.addEventListener('change', () => {
    app.setTempo(Math.min(200, Math.max(40, Math.round(Number(seqBpm.value) || app.studio.bpm))));
    render();
  });
  // 어디서 빠르기를 바꾸든(이 칸·BPM 맞추기·루퍼) 지금 박 자리는 그대로 두고 이어서 돈다
  function retime() {
    if (S.playing && app.studio.ctx && S.bpmAt !== app.studio.bpm) {
      const beat = (app.studio.ctx.currentTime - S.t0) / (60 / S.bpmAt);
      S.t0 = app.studio.ctx.currentTime - beat * (60 / app.studio.bpm);
    }
    S.bpmAt = app.studio.bpm;
  }
  const beatSec = () => 60 / app.studio.bpm;
  const stepAt = (absStep) => S.t0 + (Math.floor(absStep / STEPS) * 4 + stepBeat(absStep % STEPS, S.swing)) * beatSec();
  const playingStep = (round) => {
    const beats = (app.studio.ctx.currentTime - S.t0) / beatSec();
    const k = round ? Math.round(beats * 4) : Math.max(0, Math.floor(beats * 4));
    return ((k % len()) + len()) % len();
  };
  // 스윙으로 늦춘 칸까지 따져 지금 시각에 가장 가까운 칸 (절대 번호)
  const nearestAbs = () => {
    const now = app.studio.ctx.currentTime;
    const k = Math.max(0, Math.floor(((now - S.t0) / beatSec()) * 4));
    return [k - 1, k, k + 1].filter((x) => x >= 0).reduce((a, b) => (Math.abs(stepAt(b) - now) < Math.abs(stepAt(a) - now) ? b : a));
  };
  function tick() {
    const ctx = app.studio.ctx;
    const until = ctx.currentTime + AHEAD;
    // S.scheduled: 다음에 넣을 칸의 절대 번호 (시작부터 센 16분 칸)
    for (;;) {
      const k = S.scheduled;
      const at = stepAt(k);
      if (at >= until) break;
      const s = k % len();
      for (let p = 0; p < PAD_COUNT; p++) {
        const v = S.steps[p][s];
        if (S.skip.delete(`${p}:${k}`)) continue;
        if (v && at >= ctx.currentTime - 0.01) kit.trigger(p, Math.max(ctx.currentTime, at), v === 2 ? 1 : 0.7);
      }
      S.scheduled++;
    }
  }
  async function playSeq() {
    const k = await ensureKit();
    if (!S.data) { app.notice('먼저 소리를 고르세요.', 'bad'); return; }
    S.t0 = k.ctx.currentTime + 0.08;
    S.bpmAt = app.studio.bpm;
    S.scheduled = 0;
    S.skip.clear();
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
  const rateIdx = (id) => Math.max(0, RATES.findIndex((r) => r.id === id));
  const bitsK = knob({
    label: '비트', min: 4, max: 16, step: 1, value: 16, size: 'sm', format: (v) => (v >= 16 ? '16 bit (끔)' : `${v} bit`),
    onChange: (v) => setFx({ bits: v }), onInput: (v) => setFx({ bits: v }), defaultValue: () => 16,
  });
  const rateK = knob({
    label: '샘플레이트', min: 0, max: RATES.length - 1, step: 1, value: RATES.length - 1, size: 'sm', format: (v) => RATES[Math.round(v)].label.replace(' (SP-1200)', ''),
    onChange: (v) => setFx({ rate: RATES[Math.round(v)].id }), onInput: (v) => setFx({ rate: RATES[Math.round(v)].id }), defaultValue: () => RATES.length - 1,
  });
  const noiseK = knob({
    label: '바이닐 잡음', min: 0, max: 1, value: 0, size: 'sm', tone: 'signal', format: (v) => `${Math.round(v * 100)}%`,
    onChange: (v) => setFx({ noise: v }), onInput: (v) => setFx({ noise: v }), defaultValue: () => 0,
  });
  const wobbleK = knob({
    label: '테이프 흔들림', min: 0, max: 1, value: 0, size: 'sm', tone: 'signal', format: (v) => `${Math.round(v * 100)}%`,
    onChange: (v) => setFx({ wobble: v }), onInput: (v) => setFx({ wobble: v }), defaultValue: () => 0,
  });
  const lofiChips = LOFI_PRESETS.map(([label, fx]) => {
    const b = chipButton(label, () => setFx(fx));
    b.dataset.preset = label;
    return { b, fx };
  });
  function setFx(fx) {
    S.fx = { ...S.fx, ...fx };
    // 소리 색(고음 깎기)은 잡음·흔들림 중 큰 쪽을 따라간다
    S.fx.lofi = Math.round(Math.max(S.fx.noise, S.fx.wobble) * 100) / 100;
    kit?.setFx(S.fx);
    renderFx();
  }
  const exportBtn = h('button', { type: 'button', class: 'primary export-btn' });
  exportBtn.addEventListener('click', async () => {
    if (!S.data) return;
    exportBtn.disabled = true;
    try {
      const buf = await renderPattern({ data: S.data, sr: S.sr, pads: S.pads, steps: S.steps, fx: S.fx, bpm: app.studio.bpm, swing: S.swing, loops: 2, length: len() });
      const mono = toMono([buf.getChannelData(0), buf.getChannelData(1)]);
      const r = await saveFile(`샘플 패드 ${app.studio.bpm}BPM ${S.bars * 2}마디.wav`, encodeWav(mono, buf.sampleRate), 'audio/wav');
      if (r !== 'saved') app.notice('이 화면에서는 파일을 저장할 수 없어요.', 'bad');
    } finally {
      exportBtn.disabled = false;
    }
  });

  root.append(h('div', { class: 'pads-view' },
    h('div', { class: 'pads-head' },
      h('h2', {}, '샘플 패드'),
      h('p', { class: 'panel-hint' }, `자르고 → 패드에 올리고 → 찍어요. 건반 ${noteName(PAD_BASE_MIDI)}부터 16음, 컴퓨터 키 A W S E D F T G Y H U J K O L P 로도 쳐요.`)),
    h('section', { class: 'panel pads-src', 'aria-label': '소리 재료와 자르기' },
      h('div', { class: 'src-row' },
        h('div', { class: 'src-text' }, h('span', { class: 'label' }, '소리 재료'), h('div', {}, srcTitle, srcDesc)),
        h('div', { class: 'btn-row' }, h('label', { class: 'file-btn', for: fileInput.id }, '파일 열기', fileInput), micBtn, useSampleBtn, demoBtn)),
      wave,
      h('div', { class: 'chop-row' },
        h('div', { class: 'chop-modes' }, h('span', { class: 'label' }, '자르기'), modeSeg),
        sens.el,
        h('div', { class: 'chop-tempo' },
          h('span', { class: 'label' }, '원래 빠르기 (추정)'),
          h('div', { class: 'tempo-read' }, srcBpmIn, h('span', { class: 'tempo-unit' }, 'BPM'), trust,
            h('button', { type: 'button', class: 'icon-btn small', title: '두 배', onclick: () => { S.srcBpm = Math.min(220, S.srcBpm * 2); S.bpmTyped = true; render(); } }, '×2'),
            h('button', { type: 'button', class: 'icon-btn small', title: '절반', onclick: () => { S.srcBpm = Math.max(40, S.srcBpm / 2); S.bpmTyped = true; render(); } }, '÷2'))),
        h('div', { class: 'chop-fit' }, h('label', { class: 'bpm-field' }, h('span', { class: 'label' }, '맞출 BPM'), fitIn), fitBtn)),
      manualHint),
    h('div', { class: 'pads-mid' },
      h('section', { class: 'panel pads-grid-panel', 'aria-label': '패드 16개' },
        h('h3', { class: 'box-title' }, '패드 16개', h('span', {}, ' · 아래 줄이 1–4 (MPC 배치)')),
        padGrid, chokeLegend),
      h('section', { class: 'panel pad-editor', 'aria-label': '고른 패드' },
        h('h3', { class: 'box-title' }, '고른 패드'),
        h('div', { class: 'pad-ed-head' }, padTitle, padMeta),
        h('div', { class: 'knobs pad-knobs' }, ...padKnobs.map((x) => x.k.el)),
        edRow('재생 방식', h('div', { class: 'seg', role: 'group', 'aria-label': '재생 방식' }, ...modeBtns)),
        edRow('끊김 그룹', h('div', { class: 'seg', role: 'group', 'aria-label': '끊김 그룹' }, ...chokeBtns)),
        edRow('방향', revBtn),
        edRow('조각 · 이름', sliceSel, nameIn),
        h('p', { class: 'panel-hint' }, '끊김 그룹: 같은 글자 패드끼리는 하나가 울리면 다른 하나가 멈춰요 (닫힌 햇이 열린 햇을 끊듯이).'))),
    h('div', { class: 'pads-low' },
      h('section', { class: 'panel pads-seq', 'aria-label': '스텝 시퀀서' },
        h('h3', { class: 'box-title seq-title' }),
        h('div', { class: 'seq-transport' }, playBtn, recBtn, posOut,
          h('label', { class: 'bpm-field' }, h('span', { class: 'label' }, 'BPM'), seqBpm),
          h('div', { class: 'swing-wrap' }, swingK.el, h('span', { class: 'swing-sub' }, 'MPC 느낌')),
          barsSeg, h('span', { class: 'seq-spacer' }), undoBtn),
        h('div', { class: 'step-wrap' }, grid),
        h('div', { class: 'seq-foot' },
          h('p', { class: 'panel-hint' }, '짝수 칸이 스윙만큼 늦게 나와요 (50% = 똑바로, 66% = 셋잇단 느낌). 칸을 누르면 켜고 끄고, 누른 채 위아래로 끌면 세기. 패드를 누르면 그 줄이 생겨요.'),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'quiet small', title: '첫 마디의 조각들을 원래 자리에', onclick: () => { remember(); S.steps = toBars(S.pads.length ? replayPattern(S.pads, S.sr, S.srcBpm) : starterPattern()); S.bar2Edited = false; renderGrid(true); } }, '원래 순서대로'),
            h('button', { type: 'button', class: 'quiet small', title: '1번 킥 · 2번 스네어 · 3번 하이햇 자리', onclick: () => { remember(); S.steps = toBars(starterPattern(S.slices.length)); S.bar2Edited = false; renderGrid(true); } }, '붐뱁 뼈대'),
            h('button', { type: 'button', class: 'quiet small', onclick: () => { remember(); S.steps = blank(); S.bar2Edited = false; renderGrid(true); } }, '모두 지우기')))),
      h('section', { class: 'panel pads-lofi', 'aria-label': '로파이와 내보내기' },
        h('h3', { class: 'box-title' }, '로파이', h('span', {}, ' · 낡은 샘플러 맛')),
        h('div', { class: 'chip-row' }, ...lofiChips.map((x) => x.b)),
        h('div', { class: 'lofi-knobs' }, bitsK.el, rateK.el, noiseK.el, wobbleK.el),
        h('hr'),
        exportBtn,
        h('p', { class: 'panel-hint' }, '남의 음반을 잘라 만든 곡을 발표하려면 원작자 허락(샘플 클리어런스)이 필요해요. 우리 녹음·데모 비트·CC0 소리는 자유롭게 써요.')))));

  // ---- 그리기 ----
  function renderSource() {
    srcTitle.textContent = S.data ? S.name : '소리를 고르세요';
    const secs = S.data ? S.data.length / S.sr : 0;
    const bars = S.data ? Math.max(1, Math.round(secs / (4 * (60 / S.srcBpm)))) : 0;
    srcDesc.textContent = S.data ? ` · ${[S.desc, S.confidence >= 0.35 || S.bpmTyped ? `${bars}마디` : null, `${secs.toFixed(1)}초`].filter(Boolean).join(' · ')}` : '';
  }
  function renderPads() {
    for (const { b, i, choke, name, info } of padBtns) {
      const p = S.pads[i];
      const k = sliceOf(p);
      b.setAttribute('aria-pressed', String(i === S.selected));
      b.setAttribute('aria-label', `패드 ${i + 1} ${padName(i)}`);
      b.style.setProperty('--pc', `var(--${CHOKE_COLORS[p?.choke ?? 0]})`);
      choke.hidden = !p?.choke;
      choke.textContent = p?.choke ? CHOKES[p.choke].label : '';
      choke.className = `mpc-choke choke-${p?.choke ?? 0}`;
      name.textContent = padName(i);
      info.textContent = p ? `${k >= 0 ? `조각 ${k + 1}` : '조각'}${p.pitch ? ` · ${p.pitch > 0 ? '+' : ''}${p.pitch}` : ''}${p.reverse ? ' · 거꾸로' : ''}` : '';
      b.disabled = !p;
    }
  }
  function renderPadEditor() {
    const p = S.pads[S.selected];
    padTitle.textContent = p ? `패드 ${S.selected + 1} · ${padName(S.selected)}` : '패드';
    if (!p) { padMeta.textContent = ''; return; }
    padMeta.textContent = `조각 ${sliceOf(p) + 1} · ${((p.end - p.start) / S.sr).toFixed(2)}초 · 건반 ${noteName(PAD_BASE_MIDI + S.selected)} · 키 ${KEY_LABELS[S.selected]}`;
    for (const { key, k } of padKnobs) k.set(p[key]);
    revBtn.setAttribute('aria-pressed', String(p.reverse));
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === p.mode)));
    chokeBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.choke) === p.choke)));
    sliceSel.replaceChildren(...S.slices.map((s, i) => h('option', { value: i, selected: s.start === p.start || null }, `조각 ${i + 1} · ${S.names[i]?.label ?? ''}`)));
    if (document.activeElement !== nameIn) nameIn.value = p.name ?? '';
    nameIn.placeholder = S.names[sliceOf(p)]?.label ?? '이름';
  }
  function renderFx() {
    bitsK.set(S.fx.bits);
    rateK.set(rateIdx(S.fx.rate));
    noiseK.set(S.fx.noise);
    wobbleK.set(S.fx.wobble);
    for (const { b, fx } of lofiChips) b.setAttribute('aria-pressed', String(Object.entries(fx).every(([k, v]) => S.fx[k] === v)));
  }
  function render() {
    renderSource();
    modeSeg.replaceChildren(...CHOP_MODES.map((m) => {
      const b = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(m.id === S.mode), dataset: { mode: m.id } }, m.label);
      b.addEventListener('click', () => { S.mode = m.id; chop(); render(); });
      return b;
    }));
    sens.el.hidden = S.mode !== 'onset';
    manualHint.hidden = S.mode !== 'manual';
    if (document.activeElement !== srcBpmIn) srcBpmIn.value = String(Math.round(S.srcBpm * 10) / 10);
    const [word, level] = trustOf(S.confidence);
    trust.textContent = S.bpmTyped ? '· 직접 적음' : `· 믿음 ${word}`;
    trust.dataset.level = S.bpmTyped ? 'good' : level;
    if (document.activeElement !== fitIn) fitIn.value = String(S.fitBpm ?? app.studio.bpm);
    fitBtn.disabled = !S.data;
    playBtn.textContent = S.playing ? '■ 정지' : '▶ 재생';
    playBtn.setAttribute('aria-pressed', String(S.playing));
    recBtn.setAttribute('aria-pressed', String(S.rec));
    recBtn.textContent = S.rec ? '● 녹음 중' : '● 녹음';
    if (document.activeElement !== seqBpm) seqBpm.value = String(app.studio.bpm);
    barsSeg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.bars) === S.bars)));
    root.querySelector('.seq-title').replaceChildren('스텝 시퀀서', h('span', {}, ` · ${len()}칸`));
    exportBtn.textContent = `WAV로 내보내기 · ${S.bars * 2}마디`;
    exportBtn.disabled = !S.data;
    if (!S.playing) posOut.textContent = '1.1';
    renderPads();
    renderPadEditor();
    renderGrid(true);
    renderFx();
    if (app.pads) app.renderHeader();
    requestAnimationFrame(drawWave);
  }
  let lastCol = -1;
  app.onFrame(() => {
    if (root.hidden || !S.playing) {
      if (lastCol >= 0) { grid.querySelectorAll('.is-now').forEach((c) => c.classList.remove('is-now')); lastCol = -1; }
      return;
    }
    const col = playingStep(false);
    if (col === lastCol) return;
    grid.querySelectorAll('.is-now').forEach((c) => c.classList.remove('is-now'));
    for (const { cells } of gridRows) cells[col]?.classList.add('is-now');
    grid.querySelector('.step-head')?.children[col + 1]?.classList.add('is-now');
    posOut.textContent = `${Math.floor(col / STEPS) + 1}.${(col % STEPS) + 1}`;
    lastCol = col;
  });

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
      if (!S.data) loadDemo();
      render();
      if (app.studio.ctx) await ensureKit();
      // 누르고 있던 건반은 지금 받는 쪽에서 먼저 떼어 준다 (안 그러면 음색 쪽 음이 남음)
      if (!app.keyTarget) { app.keyboard.releaseAll(); app.keyTarget = target; }
    } else if (app.keyTarget === target) { app.keyboard.releaseAll(); app.keyTarget = null; }
  });
  app.on('audio', () => { if (!root.hidden) ensureKit(); });
  app.on('tempo', () => { retime(); if (!root.hidden) render(); });
  app.on('resize', drawWave);
  app.on('panic', stopSeq);
  render();
  return {
    state: S,
    play: playSeq,
    stop: stopSeq,
    hit: async (i) => { await ensureKit(); hit(i, 0.9); },
    /** 실험실 샘플러의 지금 샘플을 잘라 쓰기 (실험실에서 '샘플 패드에서 자르기') */
    fromLab: () => useSampleBtn.click(),
    setBars,
    undo,
    info: () => ({
      playing: S.playing, slices: S.slices.length, srcBpm: S.srcBpm, confidence: S.confidence, name: S.name, swing: S.swing, bars: S.bars, mode: S.mode,
      voices: kit?.voices.size ?? 0, fx: S.fx, selected: S.selected, pads: S.pads, names: S.pads.map((_, i) => padName(i)), undo: S.undo.length,
    }),
  };
}
