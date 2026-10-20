// 예배 무대: 연주 중에 음색을 바꾸는 화면. 세트 리스트, 큰 음색 패드 8개(숫자 키 1–8),
// 손가락으로 미는 판(가로 밝기 × 세로 공간), 패드 홀드, 다음 곡, 루퍼 한 줄.
import { h, nextId } from './ui.js';
import { applyMacro, CATEGORIES } from './patch.js';
import { FACTORY } from './presets.js';
import { NOTE_NAMES } from './tuning.js';
import * as store from './store.js';

const DEFAULT_PADS = ['worship-pad', 'air-pad', 'swell-strings', 'dx-ep', 'church-organ', 'glass-bell-pad', 'synth-bass', 'acoustic-guitar'];
const EXAMPLE_SONGS = [
  { name: '우리 주 하나님', presetId: 'worship-pad', transpose: 0 },
  { name: '내 진정 사모하는', presetId: 'dx-ep', transpose: 0 },
  { name: '예수 예수', presetId: 'air-pad', transpose: 0 },
];
const isTyping = (el) => el && (el.isContentEditable || ['TEXTAREA', 'SELECT'].includes(el.tagName)
  || (el.tagName === 'INPUT' && !['range', 'button', 'checkbox', 'radio'].includes(el.type)));
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

function loadStage() {
  const s = store.load('stage', null);
  const pads = Array.isArray(s?.pads) && s.pads.length === 8 && s.pads.every((x) => typeof x === 'string') ? s.pads : DEFAULT_PADS.slice();
  const songs = Array.isArray(s?.songs)
    ? s.songs.filter((x) => x && typeof x.name === 'string').slice(0, 30).map((x, i) => ({
      id: typeof x.id === 'string' ? x.id : `s${i}`,
      name: x.name.slice(0, 40),
      presetId: typeof x.presetId === 'string' ? x.presetId : 'worship-pad',
      transpose: Number.isInteger(x.transpose) ? Math.max(-12, Math.min(12, x.transpose)) : 0,
    }))
    : EXAMPLE_SONGS.map((x, i) => ({ ...x, id: `ex${i}` }));
  return { pads, songs, current: Math.min(Math.max(0, s?.current ?? 0), Math.max(0, songs.length - 1)), example: s ? Boolean(s.example) : true };
}

export function StageView(root, app) {
  const st = loadStage();
  const persist = () => store.save('stage', { pads: st.pads, songs: st.songs, current: st.current, example: st.example });
  const entryFor = (id) => app.findPreset(id) ?? app.findPreset('worship-pad');
  let editPads = false;
  let editSet = false;

  // ---- 밝기 × 공간 판 ----
  const xy = { x: 0.5, y: 0.5 };
  let base = app.patch;
  let applying = false;
  const applyXY = (phase, presetId) => {
    applying = true;
    const p = applyMacro(applyMacro(base, 'bright', xy.x), 'space', xy.y);
    app.setPatch(p, { phase, keepMacros: true, ...(presetId !== undefined ? { presetId } : {}) });
    applying = false;
  };
  const choose = (entry) => {
    base = entry.patch;
    applyXY('change', entry.id);
  };

  // ---- 세트 리스트 ----
  const setNav = h('nav', { class: 'setlist', 'aria-label': '세트 리스트' });
  const prevBtn = h('button', { type: 'button', class: 'stage-btn' }, '◀ 이전 곡');
  const nextBtn = h('button', { type: 'button', class: 'stage-btn' }, '다음 곡 ▶');
  const editSetBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false' }, '세트 편집');
  const setNote = h('p', { class: 'set-note' });
  function selectSong(i) {
    if (!st.songs.length) return;
    st.current = Math.max(0, Math.min(st.songs.length - 1, i));
    const song = st.songs[st.current];
    if (app.tuning.transpose !== song.transpose) app.setTuning({ ...app.tuning, transpose: song.transpose });
    choose(entryFor(song.presetId));
    persist();
    render();
  }
  prevBtn.addEventListener('click', () => selectSong(st.current - 1));
  nextBtn.addEventListener('click', () => selectSong(st.current + 1));
  editSetBtn.addEventListener('click', () => { editSet = !editSet; render(); });

  // ---- 패드 ----
  const padsGrid = h('div', { class: 'pads' });
  const editPadsBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false', title: '패드마다 다른 음색을 고름' }, '패드 바꾸기');
  editPadsBtn.addEventListener('click', () => { editPads = !editPads; render(); });

  // ---- 판 ----
  const xyPad = h('div', { class: 'xy', tabindex: '0', role: 'group', 'aria-label': '밝기와 공간 판. 가로는 밝기, 세로는 공간' },
    h('span', { class: 'xy-line-x', 'aria-hidden': 'true' }), h('span', { class: 'xy-line-y', 'aria-hidden': 'true' }),
    h('span', { class: 'xy-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'xy-corner xy-low' }, '어둡게 · 가까이'), h('span', { class: 'xy-corner xy-high' }, '또렷하게 · 넓은 홀'));
  const xyRead = h('span', { class: 'xy-read' });
  const xId = nextId('xb');
  const yId = nextId('ys');
  const xRange = h('input', { type: 'range', id: xId, min: 0, max: 100 });
  const yRange = h('input', { type: 'range', id: yId, min: 0, max: 100 });
  const fromPointer = (e, phase) => {
    const r = xyPad.getBoundingClientRect();
    xy.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    xy.y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    applyXY(phase);
    renderXY();
  };
  let dragging = false;
  xyPad.addEventListener('pointerdown', (e) => { dragging = true; xyPad.setPointerCapture(e.pointerId); fromPointer(e, 'input'); });
  xyPad.addEventListener('pointermove', (e) => dragging && fromPointer(e, 'input'));
  const endXY = () => { if (dragging) { dragging = false; applyXY('change'); } };
  xyPad.addEventListener('pointerup', endXY);
  xyPad.addEventListener('pointercancel', endXY);
  xyPad.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    xy.x = Math.min(1, Math.max(0, xy.x + d[0]));
    xy.y = Math.min(1, Math.max(0, xy.y + d[1]));
    applyXY('change');
    renderXY();
  });
  xRange.addEventListener('input', () => { xy.x = Number(xRange.value) / 100; applyXY('input'); renderXY(); });
  yRange.addEventListener('input', () => { xy.y = Number(yRange.value) / 100; applyXY('input'); renderXY(); });
  xRange.addEventListener('change', () => applyXY('change'));
  yRange.addEventListener('change', () => applyXY('change'));
  const centerBtn = h('button', { type: 'button', class: 'stage-btn small' }, '가운데로');
  centerBtn.addEventListener('click', () => { xy.x = 0.5; xy.y = 0.5; applyXY('change'); renderXY(); });
  function renderXY() {
    xyPad.style.setProperty('--x', `${xy.x * 100}%`);
    xyPad.style.setProperty('--y', `${(1 - xy.y) * 100}%`);
    const pct = (v) => signed(Math.round((v - 0.5) * 100));
    xyRead.textContent = `밝기 ${pct(xy.x)} · 공간 ${pct(xy.y)}`;
    xRange.value = String(Math.round(xy.x * 100));
    yRange.value = String(Math.round(xy.y * 100));
  }

  const holdBtn = h('button', { type: 'button', class: 'stage-btn big', 'aria-pressed': 'false', title: '손을 떼도 화음이 이어짐 (서스테인)' }, '패드 홀드');
  holdBtn.addEventListener('click', () => { app.keyboard.setHold(!app.keyboard.hold); render(); });
  const nextSoundBtn = h('button', { type: 'button', class: 'stage-btn big' }, '다음 곡 음색 ▶');
  nextSoundBtn.addEventListener('click', () => selectSong(st.current + 1));

  // ---- 루퍼 한 줄 ----
  const lPlay = h('button', { type: 'button', class: 'stage-btn strip-btn', 'aria-pressed': 'false' }, '▶ 재생');
  const lRec = h('button', { type: 'button', class: 'stage-btn strip-btn rec', 'aria-pressed': 'false' }, '● 녹음');
  const lPos = h('output', { class: 'strip-pos' }, '1.1');
  const lBars = h('div', { class: 'strip-bars' });
  const lInfo = h('span', { class: 'strip-info' });
  lPlay.addEventListener('click', () => (app.looper.info().playing ? app.looper.stop() : app.looper.play()));
  lRec.addEventListener('click', () => app.looper.toggleRecord());
  // 루퍼는 따로 탭이 아니라 이 줄을 펼치면 트랙 4개 전체가 나온다 (app.js 가 looperSlot 을 채움)
  const strip = h('div', { class: 'strip', 'aria-label': '루퍼' }, lPlay, lRec, lPos, lBars, lInfo);
  const looperSlot = h('div', { class: 'looper-slot', hidden: true });
  const looperWrap = h('section', { class: 'looper-wrap', 'aria-label': '루퍼 트랙', hidden: true },
    h('div', { class: 'looper-head' },
      h('button', { type: 'button', class: 'stage-btn small', onclick: () => setLooperOpen(false) }, '한 줄로 접기 ▴')),
    looperSlot);
  const openBtn = h('button', { type: 'button', class: 'stage-btn small', onclick: () => setLooperOpen(true) }, '트랙 펼치기 ▾');
  strip.append(openBtn);
  function setLooperOpen(on) {
    strip.hidden = on;
    looperWrap.hidden = !on;
    looperSlot.hidden = !on;
    if (on) app.emit('show:looper');
    else renderStrip();
  }

  const setEditor = h('section', { class: 'panel set-editor', 'aria-label': '세트 편집' });

  root.append(
    h('div', { class: 'stage-top' }, setNav, h('div', { class: 'stage-top-btns' }, prevBtn, nextBtn, editSetBtn)),
    setNote,
    setEditor,
    h('div', { class: 'stage-main' },
      h('section', { class: 'stage-pads', 'aria-label': '음색 패드' },
        h('div', { class: 'stage-head' }, h('h2', {}, '음색 패드 · 숫자 키 1–8'), editPadsBtn),
        padsGrid,
        strip,
        looperWrap),
      h('aside', { class: 'stage-side', 'aria-label': '연주 조절' },
        h('div', { class: 'stage-head' }, h('h2', {}, '손가락으로 밀기'), xyRead),
        xyPad,
        h('div', { class: 'xy-ranges' },
          h('label', { for: xId }, '밝기'), xRange,
          h('label', { for: yId }, '공간'), yRange, centerBtn),
        h('div', { class: 'stage-side-btns' }, holdBtn, nextSoundBtn))));

  // ---- 그리기 ----
  const presetOptions = (selected) => [
    ...app.userPresets.map((u) => h('option', { value: u.id, selected: u.id === selected || null }, `내 음색 · ${u.patch.name}`)),
    ...FACTORY.map((f) => h('option', { value: f.id, selected: f.id === selected || null }, f.patch.name)),
  ];

  function renderSet() {
    setNav.replaceChildren(...st.songs.map((song, i) => {
      const entry = entryFor(song.presetId);
      const now = i === st.current;
      return h('button', { type: 'button', class: 'song', 'aria-current': String(now), onclick: () => selectSong(i) },
        h('span', { class: 'song-no' }, String(i + 1)),
        h('span', { class: 'song-text' }, h('strong', {}, song.name), h('span', {}, `${entry.patch.name}${song.transpose ? ` · 조옮김 ${signed(song.transpose)}` : ''}`)),
        now ? h('span', { class: 'song-now' }, '지금') : null);
    }));
    if (!st.songs.length) setNav.append(h('p', { class: 'set-note' }, '곡이 없어요. 세트 편집에서 곡을 추가하세요.'));
    setNote.textContent = st.example ? '예시 세트예요. 저장소에 있는 예배 음원 세 곡으로 채웠어요. 세트 편집에서 우리 팀 곡으로 바꾸세요.' : '';
    setNote.hidden = !st.example;
    prevBtn.disabled = st.current <= 0;
    nextBtn.disabled = st.current >= st.songs.length - 1;
    nextSoundBtn.disabled = nextBtn.disabled;
    editSetBtn.setAttribute('aria-pressed', String(editSet));
    setEditor.hidden = !editSet;
    if (!editSet) return;
    const nameId = nextId('song');
    const addName = h('input', { type: 'text', id: nameId, maxlength: '40', placeholder: '곡 이름', class: 'text-input' });
    const add = () => {
      const name = addName.value.trim();
      if (!name) return;
      st.songs.push({ id: `s${Date.now().toString(36)}`, name, presetId: app.presetId ?? 'worship-pad', transpose: app.tuning.transpose });
      st.example = false;
      persist();
      render();
    };
    addName.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    setEditor.replaceChildren(
      h('header', { class: 'panel-head' }, h('h3', {}, '세트 편집'), h('p', { class: 'panel-hint' }, '곡마다 음색과 조옮김을 정해 두면, 곡을 누를 때 함께 바뀌어요.')),
      h('div', { class: 'set-rows' }, ...st.songs.map((song, i) => {
        const name = h('input', { type: 'text', value: song.name, maxlength: '40', class: 'text-input', 'aria-label': `${i + 1}번 곡 이름` });
        name.addEventListener('change', () => { song.name = name.value.trim() || song.name; st.example = false; persist(); renderSet(); });
        const sel = h('select', { 'aria-label': `${song.name} 음색` }, ...presetOptions(song.presetId));
        sel.addEventListener('change', () => { song.presetId = sel.value; st.example = false; persist(); if (i === st.current) selectSong(i); else renderSet(); });
        const tr = (d) => { song.transpose = Math.max(-12, Math.min(12, song.transpose + d)); st.example = false; persist(); if (i === st.current) selectSong(i); else renderSet(); };
        return h('div', { class: 'set-row' },
          h('span', { class: 'song-no' }, String(i + 1)), name, sel,
          h('div', { class: 'stepper' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${song.name} 반음 내리기`, onclick: () => tr(-1) }, '−'),
            h('output', { class: 'step-out' }, `${signed(song.transpose)} (${NOTE_NAMES[((song.transpose % 12) + 12) % 12]})`),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${song.name} 반음 올리기`, onclick: () => tr(1) }, '+')),
          h('button', {
            type: 'button', class: 'quiet small', onclick: () => {
              st.songs.splice(i, 1);
              st.current = Math.min(st.current, Math.max(0, st.songs.length - 1));
              st.example = false;
              persist();
              render();
            },
          }, '빼기'));
      })),
      h('div', { class: 'set-add' }, h('label', { for: nameId, class: 'label' }, '곡 추가'), addName,
        h('button', { type: 'button', class: 'primary', onclick: add }, '지금 음색으로 추가')));
  }

  function renderPads() {
    padsGrid.replaceChildren(...st.pads.map((id, k) => {
      const entry = entryFor(id);
      const on = app.presetId === entry.id;
      const cat = CATEGORIES.find((c) => c.id === entry.patch.category)?.label ?? '';
      const pad = h('button', { type: 'button', class: 'pad', 'aria-pressed': String(on), onclick: () => !editPads && choose(entry) },
        h('span', { class: 'pad-no' }, String(k + 1)),
        h('strong', { class: 'pad-name' }, entry.patch.name),
        h('span', { class: 'pad-cat' }, on ? `${cat} · 지금 음색` : cat));
      if (!editPads) return pad;
      const sel = h('select', { 'aria-label': `${k + 1}번 패드 음색` }, ...presetOptions(entry.id));
      sel.addEventListener('change', () => { st.pads[k] = sel.value; persist(); renderPads(); });
      return h('div', { class: 'pad-edit' }, pad, sel);
    }));
    editPadsBtn.setAttribute('aria-pressed', String(editPads));
  }

  function renderStrip() {
    const info = app.looper.info();
    lPlay.textContent = info.playing ? '■ 정지' : '▶ 재생';
    lPlay.setAttribute('aria-pressed', String(info.playing));
    lRec.setAttribute('aria-pressed', String(info.recording));
    lRec.textContent = info.counting ? '● 세는 중…' : info.recording ? '● 녹음 멈추기' : '● 녹음';
    lPos.textContent = info.beat == null ? '1.1' : info.beat < 0 ? '카운트' : `${Math.floor(info.inLoop / info.clock.beatsPerBar) + 1}.${Math.floor(info.inLoop % info.clock.beatsPerBar) + 1}`;
    const frac = info.inLoop == null ? 0 : info.inLoop / info.clock.beats;
    if (lBars.childElementCount !== info.tracks.length) lBars.replaceChildren(...info.tracks.map(() => h('span', { class: 'strip-bar' }, h('span'))));
    info.tracks.forEach((tr, i) => {
      const bar = lBars.children[i];
      bar.className = `strip-bar strip-${tr.color}${tr.notes.length ? '' : ' empty'}${tr.muted ? ' muted' : ''}`;
      bar.firstChild.style.width = `${tr.notes.length ? frac * 100 : 0}%`;
    });
    lInfo.textContent = `${info.clock.bpm} BPM · ${info.clock.bars}마디 · 녹음할 트랙 ${info.armed + 1}`;
  }

  function render() {
    renderSet();
    renderPads();
    holdBtn.setAttribute('aria-pressed', String(app.keyboard?.hold ?? false));
    renderXY();
    renderStrip();
  }

  app.on('patch', ({ phase } = {}) => {
    if (!applying) {
      // 실험실 등 다른 곳에서 음색을 바꾸면 판은 그 소리를 가운데로 삼는다
      base = app.patch;
      xy.x = 0.5;
      xy.y = 0.5;
    }
    if (phase !== 'input' && !root.hidden) { renderPads(); renderXY(); }
  });
  app.on('presets', render);
  app.on('hold', () => holdBtn.setAttribute('aria-pressed', String(app.keyboard.hold)));
  app.on('show:stage', render);
  app.onFrame(() => { if (!root.hidden) renderStrip(); });
  window.addEventListener('keydown', (e) => {
    if (root.hidden || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || e.repeat) return;
    const k = Number(e.key);
    if (k >= 1 && k <= 8) {
      e.preventDefault();
      choose(entryFor(st.pads[k - 1]));
    }
  });
  return {
    render,
    selectSong,
    pads: st.pads,
    looperSlot,
    openLooper: () => setLooperOpen(true),
    assignPad(k, id) { st.pads[k] = id; persist(); renderPads(); },
  };
}
