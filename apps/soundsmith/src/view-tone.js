// 톤 맞추기: 지금 음색을 화음으로 미리 연주해 밝기 균형(대역 6개)을 재고, 톤 곡선·노브·말 버튼으로 다듬고,
// 레퍼런스(음원 파일의 한 구간이나 다른 음색)에 얼마나 따라갈지 정한다. A/B 는 같은 크기로 맞춰 들려준다.
// 음 높이(기준음·음률)는 위 한 줄로 접어 두고, '자세히'를 누르면 튜닝 화면 전체가 펼쳐진다.
import { h, panel, controlGroup, knob, chipButton, nextId } from './ui.js';
import { drawToneSpectrum, drawToneEq } from './draw.js';
import {
  TONE_BANDS, TONE_IDS, TONE_WORDS, ROOMS, FLAT_TONE, LOWCUT_OFF, MATCH_CAP,
  analyzeTone, withTone, matchMoves, addMoves, wordMoves, rangeText, isFlat,
} from './tone.js';
import { normalizePatch, getPath, BASE_PATCH } from './patch.js';
import { renderNote, Instrument } from './engine.js';
import { FACTORY } from './presets.js';
import { NOTE_NAMES, TEMPERAMENTS } from './tuning.js';
import { TuningView } from './view-tuning.js';
import * as store from './store.js';

/** 재고 들려줄 화음: 패드·건반은 C 장화음, 베이스는 낮게, 한 음씩 악기는 한 음. */
export function chordFor(patch) {
  if (patch.mono) return [patch.category === 'bass' ? 36 : 60];
  if (patch.category === 'bass') return [36, 43];
  return [48, 55, 60, 64, 67];
}

const chordName = (patch) => (patch.mono ? '한 음' : patch.category === 'bass' ? '낮은 C·G 화음' : 'C 장화음');

/** 음색을 화음으로 미리 연주해(잔향까지) 톤을 잰다. 톤 EQ 는 빼고 재서, 노브를 돌릴 때는 다시 재지 않는다. */
export async function measurePatch(patch, sample = null) {
  if (patch.source === 'sample' && !sample) return null;
  const flat = { ...patch, tone: { ...FLAT_TONE } };
  const seconds = Math.min(6.5, Math.max(3, patch.ampEnv.a + 2.5));
  const buf = await renderNote(flat, { midi: chordFor(patch), seconds, hold: seconds - 0.3, dry: false, sample, velocity: 0.7 });
  return analyzeTone([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate);
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`;
const hz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`);

export function ToneView(root, app) {
  const saved = store.load('tone', {}) || {};
  const okProfile = (r) => r && Array.isArray(r.bands) && r.bands.length === 6 && Array.isArray(r.third) && r.third.length === 27 && r.bands.every(Number.isFinite);
  let ref = okProfile(saved.ref) ? saved.ref : null;
  let follow = Number.isFinite(saved.follow) ? Math.min(1, Math.max(0, saved.follow)) : 0.4;
  let refAudio = null; // { buffer, name, peaks } — 이번 세션에만 (파일은 저장하지 않음)
  let seg = { start: 0, len: 60 };
  let refMode = ref?.kind === 'patch' ? 'patch' : 'file';
  let measure = null; // { key, data, name }
  let measuring = null;
  let dirtyKey = null;
  let focus = null;
  let matched = true;
  let log = [];
  let logPreset;
  const persist = () => store.save('tone', { ref, follow });

  const visible = () => !root.closest('[hidden]');
  const keyOf = (p) => JSON.stringify({ ...p, tone: null, name: '', volume: 0 }) + (p.source === 'sample' ? app.sample?.name ?? '' : '');
  const nowBands = () => (measure ? withTone(measure.data, app.patch.tone).bands : null);

  // ---- 음 높이 (한 줄로 접힘) ----
  const pitchRead = h('span', { class: 'pitch-read' });
  const pitchMore = h('div', { class: 'pitch-more', id: nextId('pitch'), hidden: true });
  const moreBtn = h('button', { type: 'button', class: 'quiet small', 'aria-expanded': 'false', 'aria-controls': pitchMore.id });
  const setTr = (d) => app.setTuning({ ...app.tuning, transpose: app.tuning.transpose + d });
  const pitchStrip = h('div', { class: 'pitch-strip' },
    h('span', { class: 'label' }, '음 높이'), pitchRead,
    h('span', { class: 'pitch-tr' },
      h('button', { type: 'button', class: 'icon-btn small', 'aria-label': '반음 내리기', onclick: () => setTr(-1) }, '−'),
      h('span', { class: 'label' }, '조옮김'),
      h('button', { type: 'button', class: 'icon-btn small', 'aria-label': '반음 올리기', onclick: () => setTr(1) }, '+')),
    moreBtn);
  const tuning = TuningView(pitchMore, app);
  function setPitchOpen(open) {
    pitchMore.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
    moreBtn.textContent = open ? '음 높이 접기 ▴' : '음 높이 자세히 ▸';
    if (open) tuning.shown();
  }
  moreBtn.addEventListener('click', () => setPitchOpen(pitchMore.hidden));
  setPitchOpen(false);
  function syncPitch() {
    const t = app.tuning;
    const parts = [`A4 ${t.a4.toFixed(1)} Hz`, TEMPERAMENTS[t.temperament].label + (t.temperament !== 'equal' ? ` ${NOTE_NAMES[t.root]} 기준` : '')];
    if (t.transpose) parts.push(`조옮김 ${t.transpose > 0 ? '+' : '−'}${Math.abs(t.transpose)} (C→${NOTE_NAMES[((t.transpose % 12) + 12) % 12]})`);
    if (t.fine) parts.push(`${t.fine > 0 ? '+' : '−'}${Math.abs(t.fine)} cent`);
    pitchRead.textContent = parts.join(' · ');
  }

  // ---- 밝기 균형 + 톤 곡선 + 노브 ----
  const legendNow = h('span', { class: 'lg lg-now' });
  const legendRef = h('span', { class: 'lg lg-ref' });
  const legendAfter = h('span', { class: 'lg lg-after' }, '따라간 뒤(예상)');
  const centroidRead = h('p', { class: 'tone-read', 'aria-live': 'polite' });
  const spectrum = h('canvas', { class: 'tone-spectrum', role: 'img', 'aria-label': '대역마다 전체 소리에서 차지하는 비율 (1/3 옥타브)' });
  const eqCanvas = h('canvas', { class: 'tone-eq', tabindex: '-1', 'aria-label': '톤 곡선. 대역의 점을 위아래로 끌어 올리거나 내려요. 노브로도 바꿀 수 있어요' });
  const bind = {
    get: () => app.patch,
    set: (path, v, phase) => {
      app.setParam(path, v, phase);
      if (phase === 'change') remember(`${path === 'fx.reverb' ? '공간' : path === 'fx.chorus' ? '넓이' : TONE_BANDS.find((b) => `tone.${b.id}` === path)?.label ?? '로우컷'} 바꿈`, path);
    },
    defaultOf: (path) => (path === 'tone.lowcut' ? LOWCUT_OFF : path.startsWith('tone.') ? 0 : getPath(app.findPreset(app.presetId)?.patch ?? BASE_PATCH, path)),
  };
  const ctl = controlGroup(bind);
  const bandKnobs = h('div', { class: 'knobs tone-knobs' }, ...TONE_BANDS.map((b) => {
    const el = ctl.add(`tone.${b.id}`, { label: b.label });
    el.dataset.band = b.id;
    el.title = `${rangeText(b)} · ${b.hint}`;
    el.addEventListener('focusin', () => setFocus(b.id));
    return el;
  }));
  const finishKnobs = h('div', { class: 'knobs tone-knobs' },
    ctl.add('tone.lowcut', { label: '로우컷', tone: 'signal' }),
    ctl.add('fx.reverb', { label: '공간', tone: 'signal' }),
    ctl.add('fx.chorus', { label: '넓이', tone: 'signal' }));
  const flatBtn = h('button', { type: 'button', class: 'quiet', onclick: () => {
    app.setPatch(normalizePatch({ ...app.patch, tone: { ...FLAT_TONE } }), { phase: 'change', keepMacros: true });
    remember('톤 평평하게');
  } }, '톤 평평하게');
  const undoBtn = h('button', { type: 'button', class: 'quiet', onclick: () => app.undo() }, '되돌리기');
  const measureState = h('span', { class: 'measure-state', 'aria-live': 'polite' });

  let eqGeo = null;
  let specGeo = null;
  let eqDrag = null;
  eqCanvas.addEventListener('pointerdown', (e) => {
    if (!eqGeo || e.button > 0) return;
    e.preventDefault();
    eqCanvas.setPointerCapture(e.pointerId);
    const r = eqCanvas.getBoundingClientRect();
    eqDrag = { id: eqGeo.bandAt(e.clientX - r.left), moved: false };
    setFocus(eqDrag.id);
    eqMove(e);
  });
  const eqMove = (e) => {
    if (!eqDrag) return;
    const r = eqCanvas.getBoundingClientRect();
    const v = Math.round(Math.max(-12, Math.min(12, eqGeo.dbAt(e.clientY - r.top))) * 2) / 2;
    if (v === app.patch.tone[eqDrag.id]) return;
    eqDrag.moved = true;
    app.setParam(`tone.${eqDrag.id}`, v, 'input');
  };
  eqCanvas.addEventListener('pointermove', eqMove);
  const eqEnd = () => {
    if (!eqDrag) return;
    const { id, moved } = eqDrag;
    eqDrag = null;
    if (moved) bind.set(`tone.${id}`, app.patch.tone[id], 'change');
  };
  eqCanvas.addEventListener('pointerup', eqEnd);
  eqCanvas.addEventListener('pointercancel', eqEnd);
  spectrum.addEventListener('click', (e) => {
    if (!specGeo) return;
    const id = specGeo.bandAt(e.clientX - spectrum.getBoundingClientRect().left);
    setFocus(id);
    bandKnobs.querySelector(`[data-band="${id}"] .knob-dial`)?.focus({ preventScroll: true });
  });

  function setFocus(id) {
    if (focus === id) return;
    focus = id;
    draw();
  }

  // ---- 말로 맞추기 ----
  const why = h('div', { class: 'summary tone-why', 'aria-live': 'polite' }, h('span', { class: 'summary-label' }, '왜'), '말을 고르면 어느 대역을 왜 바꾸는지 여기서 알려 줘요.');
  const wordBtn = (w) => h('button', { type: 'button', class: 'word-btn', 'aria-pressed': 'false', dataset: { word: w.id }, onclick: () => applyWord(w) }, w.label);
  const words = h('div', { class: 'word-grid' }, ...TONE_WORDS.filter((w) => !w.group).map(wordBtn));
  const bandWords = h('div', { class: 'word-grid' }, ...TONE_WORDS.filter((w) => w.group === 'band').map(wordBtn));
  function applyWord(w) {
    const r = wordMoves(w, { now: nowBands(), ref: ref?.bands ?? null });
    const p = structuredClone(app.patch);
    p.tone = addMoves(p.tone, r.moves);
    if (w.lowcut) p.tone.lowcut = Math.max(p.tone.lowcut, w.lowcut);
    for (const [k, d] of Object.entries(w.fx ?? {})) p.fx[k] += d;
    app.setPatch(normalizePatch(p), { phase: 'change', keepMacros: true });
    const moved = Object.keys(r.moves).find((id) => r.moves[id]);
    if (moved) setFocus(moved);
    for (const b of root.querySelectorAll('.word-btn')) b.setAttribute('aria-pressed', String(b.dataset.word === w.id));
    why.replaceChildren(h('strong', { class: 'why-title' }, `${w.label} → ${r.summary}`), h('br'),
      ...r.reason.map((x) => (x.strong ? h('strong', {}, x.text) : x.text)));
    remember(`${w.label} · ${r.summary}`);
  }

  // ---- 비교하고 고르기 ----
  const abState = h('p', { class: 'ab-state', 'aria-live': 'polite' });
  const matchedBtn = h('button', { type: 'button', class: 'toggle small', 'aria-pressed': 'true' }, '같은 크기로 비교');
  matchedBtn.addEventListener('click', () => {
    matched = !matched;
    matchedBtn.setAttribute('aria-pressed', String(matched));
  });
  const holdOf = (p) => Math.min(4, Math.max(2.2, p.ampEnv.a + 1.8));
  function chord(patch, at, { cut = false } = {}) {
    const ctx = app.studio.ctx;
    const inst = new Instrument(app.studio.env(), patch, app.engineSample);
    const hold = holdOf(patch);
    for (const m of chordFor(patch)) {
      inst.noteOn(m, 0.7, at);
      if (!cut) inst.noteOff(m, at + hold);
    }
    if (cut) inst.allOff(at + hold, true);
    setTimeout(() => inst.dispose(), (at - ctx.currentTime + hold + (cut ? 0.2 : patch.ampEnv.r * 1.25) + 0.6) * 1000);
    return hold;
  }
  const versionA = () => ({ ...app.patch, tone: { ...FLAT_TONE } });
  const versionB = () => {
    const g = matched && measure ? withTone(measure.data, app.patch.tone).gain : 1;
    return { ...app.patch, volume: app.patch.volume / g };
  };
  async function play(which) {
    if (app.patch.source === 'sample' && !app.sample) {
      app.notice('샘플 음색이에요. 실험실의 샘플 상자에서 소리를 먼저 고르세요.', 'bad');
      return;
    }
    const ctx = await app.ensureAudio();
    const t0 = ctx.currentTime + 0.05;
    const lb = `B · 지금 톤${matched ? ' (같은 크기)' : ''}`;
    clearTimeout(play.timer);
    if (which === 'ab') {
      const hold = chord(versionA(), t0, { cut: true });
      chord(versionB(), t0 + hold + 0.5, { cut: true });
      abState.textContent = '① A · 톤 없이';
      play.timer = setTimeout(() => {
        abState.textContent = `② ${lb}`;
        play.timer = setTimeout(() => { abState.textContent = ''; }, (hold + 0.4) * 1000);
      }, (hold + 0.5) * 1000);
    } else {
      const hold = chord(which === 'a' ? versionA() : versionB(), t0);
      abState.textContent = which === 'a' ? 'A · 톤 없이' : lb;
      play.timer = setTimeout(() => { abState.textContent = ''; }, (hold + 0.5) * 1000);
    }
  }
  const saveBtn = h('button', { type: 'button', onclick: () => app.savePreset() }, '내 음색에 저장');

  // ---- 방 맞추기 ----
  const rooms = ROOMS.map((r) => chipButton(r.label, () => {
    app.setPatch(normalizePatch({ ...app.patch, fx: { ...app.patch.fx, reverb: r.reverb, size: r.size } }), { phase: 'change', keepMacros: true });
    remember(`${r.label} · 공간 ${Math.round(r.reverb * 100)}%`);
  }, { dataset: { room: r.id }, title: `잔향 ${Math.round(r.reverb * 100)}% · 길이 ${r.size}초` }));

  // ---- 톤 기록 (이번 세션) ----
  const logList = h('ol', { class: 'tone-log' });
  function remember(label, mergeKey = null) {
    const last = log.at(-1);
    if (mergeKey && last?.mergeKey === mergeKey) log[log.length - 1] = { label, patch: app.patch, mergeKey };
    else log.push({ label, patch: app.patch, mergeKey });
    if (log.length > 9) log.splice(1, 1); // 첫 줄(원래 소리)은 남긴다
    renderLog();
  }
  function startLog() {
    log = [{ label: `원래 ${app.patch.name}`, patch: app.patch }];
    logPreset = app.presetId;
    renderLog();
  }
  function renderLog() {
    logList.replaceChildren(...log.map((e, i) => h('li', {},
      h('button', {
        type: 'button', class: 'log-btn', 'aria-current': String(e.patch === app.patch),
        onclick: () => app.setPatch(e.patch, { phase: 'change', keepMacros: true }),
      }, h('span', { class: 'log-no' }, String(i + 1)), e.label))));
  }

  // ---- 레퍼런스에 맞추기 ----
  const srcBtns = [['file', '음원 파일'], ['patch', '다른 음색']].map(([id, label]) => {
    const b = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'false', dataset: { src: id } }, label);
    b.addEventListener('click', () => { refMode = id; syncRef(); });
    return b;
  });
  const fileInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac', class: 'visually-hidden', id: nextId('ref') });
  const fileName = h('span', { class: 'ref-name' });
  const overview = h('canvas', { class: 'ref-overview', 'aria-label': '음원 전체 파형. 누른 곳으로 잴 구간이 옮겨져요' });
  const lenChips = [[30, '30초'], [60, '1분'], [0, '전체']].map(([s, label]) => chipButton(label, () => {
    seg.len = s || refAudio.buffer.duration;
    seg.start = Math.max(0, Math.min(seg.start, refAudio.buffer.duration - seg.len));
    analyzeRefAudio();
  }, { dataset: { len: s } }));
  const segRead = h('span', { class: 'seg-read' });
  const refPlay = h('button', { type: 'button', onclick: () => playRef() }, '▶ 레퍼런스 듣기');
  const refStop = h('button', { type: 'button', class: 'quiet', onclick: () => stopRef() }, '■ 멈춤');
  const fileBox = h('div', { class: 'ref-file' },
    h('div', { class: 'btn-row' }, h('label', { class: 'file-btn', for: fileInput.id }, '음원 열기', fileInput), fileName),
    h('div', { class: 'ref-audio', hidden: true }, overview,
      h('div', { class: 'ref-seg' }, h('span', { class: 'label' }, '잴 구간'), ...lenChips, segRead),
      h('div', { class: 'btn-row' }, refPlay, refStop)),
    h('p', { class: 'panel-hint' }, '음원은 이 브라우저 안에서만 재고 저장하지 않아요. 잰 숫자(밝기 균형)만 남아요.'));
  const presetSel = h('select', { id: nextId('refp'), 'aria-label': '레퍼런스로 쓸 음색' });
  const presetBox = h('div', { class: 'ref-patch', hidden: true },
    h('div', { class: 'btn-row' }, presetSel,
      h('button', { type: 'button', onclick: () => usePresetRef() }, '이 음색을 레퍼런스로')),
    h('p', { class: 'panel-hint' }, '예: 새로 만든 패드를 늘 쓰던 패드와 같은 결로.'));
  const refRead = h('p', { class: 'ref-read' });
  const followKnob = knob({
    label: '얼마나 따라갈까', min: 0, max: 1, step: 0.05, value: follow, size: 'lg',
    format: (v) => `${Math.round(v * 100)}%`, low: '조금', high: '똑같이',
    onInput: (v) => { follow = v; syncMatch(); },
    onChange: (v) => { follow = v; persist(); syncMatch(); },
    defaultValue: () => (ref?.kind === 'patch' ? 0.8 : 0.4),
  });
  const advice = h('p', { class: 'follow-advice' });
  const matchTable = h('table', { class: 'freq-table match-table' });
  const applyBtn = h('button', { type: 'button', class: 'primary', onclick: () => applyMatch() }, '제안대로 맞추기');
  const clearBtn = h('button', { type: 'button', class: 'quiet', onclick: () => { ref = null; persist(); stopRef(); syncRef(); draw(); } }, '레퍼런스 지우기');
  const matchBox = h('div', { class: 'ref-match', hidden: true },
    h('div', { class: 'follow' }, followKnob.el, advice),
    h('div', { class: 'match-side' },
      h('div', { class: 'table-wrap' }, matchTable),
      h('div', { class: 'btn-row' }, applyBtn, clearBtn),
      h('p', { class: 'panel-hint' }, `한 번에 한 대역을 ${MATCH_CAP} dB 넘게 바꾸지 않아요. 더 필요하면 한 번 더 누르세요.`)));
  const refEmpty = h('p', { class: 'ref-empty' }, '아직 레퍼런스가 없어요. 우리 곡의 라이브 녹음처럼 닮고 싶은 음원을 열거나, 다른 음색을 고르세요.');

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    fileName.textContent = `${f.name} 여는 중…`;
    try {
      const ac = new OfflineAudioContext(2, 1, 44100);
      const buffer = await ac.decodeAudioData(await f.arrayBuffer());
      const ch = buffer.getChannelData(0);
      const n = 600;
      const step = Math.max(1, Math.floor(ch.length / n));
      const peaks = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let j = i * step, end = Math.min(ch.length, (i + 1) * step); j < end; j += 4) m = Math.max(m, Math.abs(ch[j]));
        peaks[i] = m;
      }
      refAudio = { buffer, name: f.name.replace(/\.[^.]+$/, '').slice(0, 40), peaks };
      const d = buffer.duration;
      seg = d > 150 ? { start: 60, len: 60 } : { start: 0, len: Math.min(60, d) };
      analyzeRefAudio();
    } catch {
      fileName.textContent = '';
      app.notice('이 파일은 열 수 없어요. mp3·wav·m4a 같은 오디오 파일인지 확인하세요.', 'bad');
    }
  });
  overview.addEventListener('click', (e) => {
    if (!refAudio) return;
    const r = overview.getBoundingClientRect();
    const d = refAudio.buffer.duration;
    seg.start = Math.max(0, Math.min(d - seg.len, ((e.clientX - r.left) / r.width) * d - seg.len / 2));
    analyzeRefAudio();
  });
  function analyzeRefAudio() {
    const b = refAudio.buffer;
    const sr = b.sampleRate;
    const chans = Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, c) => b.getChannelData(c));
    segRead.textContent = '재는 중…';
    setTimeout(() => {
      const start = Math.round(seg.start * sr);
      const end = Math.min(b.length, start + Math.round(seg.len * sr));
      const data = analyzeTone(chans, sr, { start, end });
      const whole = seg.len >= b.duration - 0.5;
      if (ref?.kind !== 'file') {
        follow = 0.4;
        followKnob.set(follow);
      }
      ref = { kind: 'file', name: refAudio.name, detail: `${whole ? '전체' : `${mmss(seg.start)}–${mmss(seg.start + seg.len)}`} · 전체 믹스`, ...data };
      persist();
      fileName.textContent = refAudio.name;
      syncRef();
      draw();
    }, 30);
  }
  let refSrc = null;
  async function playRef() {
    if (!refAudio) return;
    stopRef();
    const ctx = await app.ensureAudio();
    const g = ctx.createGain();
    g.gain.value = matched && measure && ref?.rms ? Math.min(1.2, Math.max(0.03, measure.data.rms / ref.rms)) : 0.6;
    const src = ctx.createBufferSource();
    src.buffer = refAudio.buffer;
    src.connect(g).connect(app.studio.bus);
    src.start(ctx.currentTime + 0.03, seg.start, seg.len);
    src.onended = () => { if (refSrc === src) refSrc = null; g.disconnect(); };
    refSrc = src;
  }
  function stopRef() {
    try { refSrc?.stop(); } catch { /* 이미 멈춤 */ }
    refSrc = null;
  }
  async function usePresetRef() {
    const entry = app.findPreset(presetSel.value);
    if (!entry) return;
    presetSel.disabled = true;
    try {
      const data = await measurePatch(entry.patch, app.engineSample);
      if (!data) throw new Error('sample');
      const was = ref?.kind;
      ref = { kind: 'patch', name: entry.patch.name, detail: `음색 · ${chordName(entry.patch)}`, ...withTone(data, entry.patch.tone), rms: data.rms };
      if (was !== 'patch') {
        follow = 0.8;
        followKnob.set(follow);
      }
      persist();
      syncRef();
      draw();
    } catch {
      app.notice('그 음색은 지금 잴 수 없어요 (샘플 음색이면 샘플을 먼저 고르세요).', 'bad');
    } finally {
      presetSel.disabled = false;
    }
  }
  function applyMatch() {
    const now = nowBands();
    if (!ref || !now) return;
    const moves = Object.fromEntries(matchMoves(ref.bands, now, follow).map((m) => [m.id, m.move]));
    app.setPatch(normalizePatch({ ...app.patch, tone: addMoves(app.patch.tone, moves) }), { phase: 'change', keepMacros: true });
    remember(`${ref.name} ${Math.round(follow * 100)}% 따라가기`);
  }

  root.append(h('div', { class: 'tone' },
    h('div', { class: 'tone-head' },
      h('div', {}, h('h2', {}, '톤 맞추기'),
        h('p', { class: 'panel-hint' }, '지금 음색을 화음으로 연주해 대역마다 얼마나 들어 있는지 재요. 들리는 대로 말을 고르거나, 닮고 싶은 소리에 맞추세요.')),
      h('div', { class: 'btn-row' }, undoBtn, flatBtn)),
    pitchStrip, pitchMore,
    h('div', { class: 'tone-grid' },
      panel('지금 소리의 밝기 균형', { cls: 'tone-main', hint: '대역마다 전체 소리에서 차지하는 비율이에요. 대역을 누르면 그 노브로 가요.' },
        h('div', { class: 'tone-legend' }, legendNow, legendRef, legendAfter, measureState),
        spectrum, centroidRead,
        h('div', { class: 'eq-head' }, h('span', { class: 'label' }, '톤 곡선'), h('span', { class: 'panel-hint' }, '점을 위아래로 끌어요 · 두 번 누른 노브는 0 dB')),
        eqCanvas, bandKnobs,
        h('div', { class: 'finish-row' }, h('span', { class: 'label' }, '마무리'), finishKnobs)),
      h('div', { class: 'tone-side' },
        panel('어떻게 들리나요?', { hint: '들리는 대로 고르면 대역을 움직여요. 여러 번 눌러도 돼요.' },
          words, h('span', { class: 'label' }, '밴드 안에서'), bandWords, why),
        panel('비교하고 고르기', { hint: '같은 화음을 톤 없이(A)와 지금 톤(B)으로 들려줘요.' },
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', onclick: () => play('a') }, '▶ A 톤 없이'),
            h('button', { type: 'button', onclick: () => play('b') }, '▶ B 지금 톤'),
            h('button', { type: 'button', class: 'primary', onclick: () => play('ab') }, 'A → B 번갈아')),
          h('div', { class: 'btn-row' }, matchedBtn, saveBtn), abState),
        panel('방 맞추기', { hint: '연주할 곳에 맞춰 잔향을 한 번에.' }, h('div', { class: 'chip-row' }, ...rooms)),
        panel('톤 기록', { hint: '눌러서 그때 소리로 돌아가요.' }, logList))),
    panel('레퍼런스에 맞추기', { cls: 'tone-ref', hint: '닮고 싶은 소리를 고르면 밝기 균형을 비교해요. 얼마나 따라갈지만 정하면 돼요.' },
      h('div', { class: 'seg', role: 'group', 'aria-label': '레퍼런스 종류' }, ...srcBtns),
      fileBox, presetBox, refRead, refEmpty, matchBox)));

  function syncRef() {
    srcBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.src === refMode)));
    fileBox.hidden = refMode !== 'file';
    presetBox.hidden = refMode !== 'patch';
    const options = [...app.userPresets.map((u) => ({ id: u.id, name: `${u.patch.name} (내 음색)` })), ...FACTORY.map((f) => ({ id: f.id, name: f.patch.name }))];
    const keep = presetSel.value;
    presetSel.replaceChildren(...options.map((o) => h('option', { value: o.id }, o.name)));
    presetSel.value = options.some((o) => o.id === keep) ? keep : (options.find((o) => o.id !== app.presetId)?.id ?? '');
    const audioBox = fileBox.querySelector('.ref-audio');
    audioBox.hidden = !refAudio;
    if (refAudio) {
      const d = refAudio.buffer.duration;
      segRead.textContent = `${mmss(seg.start)}–${mmss(Math.min(d, seg.start + seg.len))} / ${mmss(d)}`;
      lenChips.forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.len) === seg.len || (c.dataset.len === '0' && seg.len >= d - 0.5))));
      requestAnimationFrame(drawOverview);
    }
    refEmpty.hidden = Boolean(ref);
    matchBox.hidden = !ref;
    refRead.hidden = !ref;
    if (ref) {
      refRead.replaceChildren(h('span', { class: 'label' }, '레퍼런스'), ' ', h('strong', {}, ref.name), ` · ${ref.detail} · 밝기 중심 ${hz(ref.centroid)}`,
        ref.kind === 'file' && !refAudio ? ' · 들으려면 음원을 다시 열어요' : '');
    }
    legendRef.hidden = !ref;
    legendRef.textContent = ref ? `레퍼런스 · ${ref.name}` : '';
    advice.textContent = ref?.kind === 'patch'
      ? '같은 종류의 음색끼리라 많이 따라가도 괜찮아요. 70–100% 를 권해요.'
      : '레퍼런스는 보컬·드럼까지 섞인 전체 소리예요. 패드는 그보다 어두워야 보컬 자리가 남아서 30–50% 를 권해요.';
    syncMatch();
  }

  function syncMatch() {
    const now = nowBands();
    legendAfter.hidden = !(ref && now);
    if (!ref) return;
    if (!now) {
      matchTable.replaceChildren(h('tbody', {}, h('tr', {}, h('td', {}, measuring ? '지금 음색을 재는 중…' : '지금 음색을 재면 차이가 보여요.'))));
      applyBtn.disabled = true;
      return;
    }
    const moves = matchMoves(ref.bands, now, follow);
    applyBtn.disabled = moves.every((m) => !m.move);
    matchTable.replaceChildren(
      h('thead', {}, h('tr', {}, h('th', {}, '대역'), h('th', {}, '범위'), h('th', {}, '차이'), h('th', {}, `제안 (${Math.round(follow * 100)}%)`))),
      h('tbody', {}, ...moves.map((m, i) => h('tr', { dataset: { band: m.id }, class: m.id === focus ? 'is-focus' : '' },
        h('td', { class: 'band-name' }, TONE_BANDS[i].label),
        h('td', {}, rangeText(TONE_BANDS[i])),
        h('td', { class: Math.abs(m.diff) < 0.5 ? '' : m.diff > 0 ? 'up' : 'down' }, signed(m.diff)),
        h('td', { class: 'move' }, m.move ? `${signed(m.move)} dB${m.capped ? ' 최대' : ''}` : '그대로')))));
    draw();
  }

  function drawOverview() {
    if (!refAudio || overview.closest('[hidden]')) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = overview.clientWidth;
    const hh = overview.clientHeight;
    overview.width = Math.round(w * dpr);
    overview.height = Math.round(hh * dpr);
    const g = overview.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim();
    const d = refAudio.buffer.duration;
    g.fillStyle = css('signal-wash');
    g.fillRect((seg.start / d) * w, 0, (Math.min(seg.len, d) / d) * w, hh);
    g.fillStyle = css('muted');
    const pk = refAudio.peaks;
    for (let i = 0; i < pk.length; i++) {
      const x = (i / pk.length) * w;
      const y = pk[i] * (hh / 2 - 2);
      g.fillRect(x, hh / 2 - y, Math.max(1, w / pk.length - 0.5), Math.max(1, y * 2));
    }
    g.strokeStyle = css('signal');
    g.lineWidth = 2;
    g.strokeRect((seg.start / d) * w + 1, 1, (Math.min(seg.len, d) / d) * w - 2, hh - 2);
  }

  // ---- 그리기 ----
  let drawQueued = false;
  function draw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      if (!visible()) return;
      const tone = app.patch.tone;
      const after = measure ? withTone(measure.data, tone) : null;
      let target = null;
      if (ref && after) {
        const moves = Object.fromEntries(matchMoves(ref.bands, after.bands, follow).map((m) => [m.id, m.move]));
        if (Object.values(moves).some(Boolean)) target = withTone(measure.data, addMoves(tone, moves)).abs;
      }
      // 지금 소리는 톤 없을 때의 전체 대비로 그려 노브를 돌린 만큼 움직이고, 레퍼런스는 전체 크기 변화만큼 같이 옮겨
      // 두 선 사이의 거리가 표의 '차이'와 같게 한다.
      const shift = after?.shift ?? 0;
      specGeo = drawToneSpectrum(spectrum, { now: after?.abs ?? null, ref: ref ? ref.third.map((d) => d + shift) : null, after: target, focus });
      eqGeo = drawToneEq(eqCanvas, tone, { focus });
      legendNow.textContent = `지금 · ${app.patch.name}`;
      if (after) {
        const parts = [`밝기 중심 ${hz(after.centroid)}`];
        if (!isFlat(tone)) parts.push(`톤 없이 ${hz(measure.data.centroid)}`);
        if (ref) parts.push(`레퍼런스 ${hz(ref.centroid)}`);
        centroidRead.textContent = parts.join(' · ');
      } else centroidRead.textContent = app.patch.source === 'sample' && !app.sample ? '샘플 음색은 샘플을 고르면 잴 수 있어요.' : '';
      for (const el of bandKnobs.children) el.classList.toggle('is-focus', el.dataset.band === focus);
      for (const tr of matchTable.querySelectorAll('tr[data-band]')) tr.classList.toggle('is-focus', tr.dataset.band === focus);
      rooms.forEach((c) => {
        const r = ROOMS.find((x) => x.id === c.dataset.room);
        c.setAttribute('aria-pressed', String(Math.abs(app.patch.fx.reverb - r.reverb) < 0.02 && Math.abs(app.patch.fx.size - r.size) < 0.13));
      });
      undoBtn.disabled = !app.history.length;
      flatBtn.disabled = isFlat(tone);
    });
  }

  // ---- 재기 ----
  let measureTimer = null;
  function scheduleMeasure(delay = 350) {
    const key = keyOf(app.patch);
    if (measure?.key === key || measuring === key) return;
    dirtyKey = key;
    if (!visible()) return;
    clearTimeout(measureTimer);
    measureTimer = setTimeout(runMeasure, delay);
  }
  async function runMeasure() {
    const patch = app.patch;
    const key = keyOf(patch);
    if (measure?.key === key) return;
    measuring = key;
    measureState.textContent = '재는 중…';
    try {
      const data = await measurePatch(patch, app.engineSample);
      if (keyOf(app.patch) !== key) return; // 재는 사이에 바뀌었으면 다음 번에
      measure = data ? { key, data, name: patch.name } : null;
      measureState.textContent = data ? `${chordName(patch)}으로 쟀어요` : '';
      dirtyKey = null;
    } catch {
      measureState.textContent = '이 브라우저에서는 소리를 미리 연주해 잴 수 없어요.';
    } finally {
      if (measuring === key) measuring = null;
      syncMatch();
      draw();
      if (dirtyKey && keyOf(app.patch) !== measure?.key) scheduleMeasure();
    }
  }

  function sync() {
    ctl.sync();
    // 다른 음색을 고르면 기록을 새로 시작한다 (지금 소리를 저장해 이름표만 바뀐 경우는 이어 간다)
    if (logPreset !== app.presetId) {
      if (log.some((e) => e.patch === app.patch)) logPreset = app.presetId;
      else startLog();
    }
    renderLog();
    syncMatch();
    draw();
  }

  app.on('patch', ({ phase }) => {
    if (phase === 'input') {
      ctl.sync();
      draw();
      return;
    }
    sync();
    scheduleMeasure();
  });
  app.on('sample', () => scheduleMeasure(100));
  app.on('presets', syncRef);
  app.on('tuning', syncPitch);
  app.on('resize', () => { draw(); drawOverview(); });
  app.on('show:tone', () => {
    sync();
    syncRef();
    if (dirtyKey || !measure) scheduleMeasure(60);
  });
  startLog();
  syncPitch();
  syncRef();
  return { openPitch: () => setPitchOpen(true), info: () => ({ measured: Boolean(measure), bands: nowBands(), ref, follow }) };
}
