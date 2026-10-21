// 예배 무대: 연주 중에 음색을 바꾸는 화면. 세트 리스트, 큰 음색 패드 8개(숫자 키 1–8),
// 손가락으로 미는 판(가로 밝기 × 세로 공간), 패드 홀드, 로터리 빠르게, 다음 곡, 루퍼 한 줄,
// 전환 효과음(다음 마디 첫 박에 맞춤)과 곡의 조로 깔리는 드론.
import { h, nextId, knob, setText, setAttr } from './ui.js';
import { fit, color } from './draw.js';
import { applyMacro, CATEGORIES } from './patch.js';
import { FACTORY, factoryById } from './presets.js';
import { NOTE_NAMES } from './tuning.js';
import { Instrument } from './engine.js';
import { TRANSITIONS, renderRiser, renderDownlifter, renderImpact, renderReverseSwell, nextDownbeat } from './fxgen.js';
import { chordFor } from './view-tone.js';
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
    const before = st.songs[st.current]?.id;
    st.current = Math.max(0, Math.min(st.songs.length - 1, i));
    const song = st.songs[st.current];
    if (app.tuning.transpose !== song.transpose) app.setTuning({ ...app.tuning, transpose: song.transpose });
    choose(entryFor(song.presetId));
    persist();
    render();
    // 다른 곡으로 넘어갔을 때만 (같은 곡을 다시 누르거나 음색만 바꾼 것은 곡이 바뀐 게 아님)
    if (st.songs[st.current].id !== before) app.emit('song');
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
  // ---- 로터리 스피커 카드: 로터리를 건 음색(오르간 등)일 때만 켜진다. 건반의 모듈레이션 휠로도 바뀐다 ----
  const rotaryBtn = h('button', { type: 'button', class: 'rotary-big rotary-card', 'aria-pressed': 'false', title: '레슬리 느림 ↔ 빠름 (건반 휠로도)' });
  rotaryBtn.addEventListener('click', () => app.setRotaryFast(!app.patch.fx.rotaryFast));
  const rotaryNote = h('p', { class: 'panel-hint' });

  // ---- 전환 효과음 ----
  const fxCache = new Map();
  let syncBar = true;
  let scheduled = []; // [{ id, label, start, hit }] (오디오 시각)
  const syncBtn = h('button', { type: 'button', class: 'sync-pill', 'aria-pressed': 'true' }, h('span', { class: 'led', 'aria-hidden': 'true' }), '다음 마디 첫 박에 맞추기');
  syncBtn.addEventListener('click', () => { syncBar = !syncBar; syncBtn.setAttribute('aria-pressed', String(syncBar)); });
  const countdown = h('div', { class: 'countdown', 'aria-live': 'polite' });
  const ICONS = {
    riser: 'M2 22 L10 20 L14 21 L20 17 L24 19 L30 13 L34 16 L40 9 L44 12 L50 5 L54 9 L58 2',
    down: 'M2 4 L8 7 L12 5 L18 11 L22 9 L28 15 L32 13 L38 18 L44 17 L50 21 L58 22',
    impact: 'M2 13 L8 13 L9 1 L11 24 L14 4 L17 20 L21 8 L25 17 L30 11 L36 15 L44 12 L58 13',
    reverse: 'M2 13 L12 13 L20 12 L28 14 L36 11 L42 15 L48 7 L52 19 L55 3 L57 23 L58 13',
  };
  const META = { riser: '2마디 · 올라감', down: '1마디 · 내려감', impact: '첫 박 · 쿵', reverse: '1마디 · 지금 음색으로' };
  const fxCards = TRANSITIONS.map((tr) => {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 60 26');
    icon.setAttribute('class', `fx-icon fx-icon-${tr.id}`);
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[tr.id]);
    icon.append(path);
    const badge = h('span', { class: 'fx-badge', hidden: true }, '다음 마디에');
    const b = h('button', { type: 'button', class: 'fx-card', title: tr.hint, dataset: { fx: tr.id } },
      h('span', { class: 'fx-card-top' }, icon, badge), h('strong', {}, tr.label), h('span', { class: 'fx-meta' }, META[tr.id]));
    b.addEventListener('click', () => fireFx(tr.id));
    return { b, badge, id: tr.id };
  });
  const timeline = h('canvas', { class: 'fx-timeline', role: 'img', 'aria-label': '앞으로 4마디: 루퍼 위치와 예약된 전환 효과음' });
  const timing = () => {
    const info = app.looper.info();
    return { info, beatSec: info.clock.beatSec, beatsPerBar: info.clock.beatsPerBar };
  };
  async function fxBuffer(id, beatSec) {
    const tr = TRANSITIONS.find((x) => x.id === id);
    const seconds = tr.beats * beatSec;
    const key = id === 'reverse' ? `${id}|${seconds.toFixed(3)}|${JSON.stringify(app.patch)}|${app.tuning.transpose}` : `${id}|${seconds.toFixed(3)}`;
    if (!fxCache.has(key)) {
      if (fxCache.size > 12) fxCache.delete(fxCache.keys().next().value);
      const job = id === 'riser' ? renderRiser(seconds)
        : id === 'down' ? renderDownlifter(seconds)
          : id === 'impact' ? renderImpact()
            : renderReverseSwell(app.patch.source === 'sample' && !app.engineSample ? factoryById('worship-pad').patch : app.patch, chordFor(app.patch), seconds,
              { tuning: app.tuning, library: app.studio.library, sample: app.engineSample, bpm: app.studio.bpm });
      fxCache.set(key, job);
    }
    return { buffer: await fxCache.get(key), seconds, tr };
  }
  function playBuffer(buffer, when, level = 0.8) {
    const ctx = app.studio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(app.studio.bus);
    src.start(Math.max(ctx.currentTime, when), Math.max(0, ctx.currentTime - when));
    src.onended = () => g.disconnect();
    return src;
  }
  async function fireFx(id) {
    const ctx = await app.ensureAudio();
    const { info, beatSec, beatsPerBar } = timing();
    const { buffer, seconds, tr } = await fxBuffer(id, beatSec);
    const now = ctx.currentTime;
    let start = now + 0.03;
    let hit = tr.endsOnBeat ? start + seconds : start;
    if (syncBar && info.playing) {
      hit = nextDownbeat({ now, t0: info.t0, beatSec, beatsPerBar }, tr.endsOnBeat ? seconds : 0);
      start = tr.endsOnBeat ? hit - seconds : hit;
    }
    playBuffer(buffer, start);
    scheduled.push({ id, label: tr.label, start, hit, end: tr.endsOnBeat ? hit : start + Math.max(seconds, beatSec) });
  }
  /** 루퍼의 '후렴 앞 라이저'와 반주 미리 듣기가 부르는 자리: 이 시각에 시작해 2마디 뒤 첫 박에서 끝난다. 돌려주는 함수로 취소 */
  async function playFxAt(id, when) {
    const { beatSec } = timing();
    const { buffer, seconds, tr } = await fxBuffer(id, beatSec);
    const src = playBuffer(buffer, when);
    const item = { id, label: `후렴 앞 ${tr.label}`, start: when, hit: when + seconds, end: when + seconds };
    scheduled.push(item);
    return () => {
      try { src.stop(); } catch { /* 이미 멈춤 */ }
      scheduled = scheduled.filter((x) => x !== item);
    };
  }
  function renderFx() {
    const ctx = app.studio.ctx;
    const now = ctx?.currentTime ?? 0;
    scheduled = scheduled.filter((x) => x.end > now - 0.5);
    const { info, beatSec, beatsPerBar } = timing();
    const next = scheduled.filter((x) => x.hit > now).sort((a, b) => a.hit - b.hit)[0];
    for (const c of fxCards) {
      const hide = !scheduled.some((x) => x.id === c.id && x.start > now);
      if (c.badge.hidden !== hide) c.badge.hidden = hide;
    }
    drawTimeline({ info, beatSec, beatsPerBar, now });
    // 남은 박 글자는 바뀔 때만 다시 만든다 (매 프레임 새로 만들면 화면 읽기 프로그램이 계속 읽음)
    const left = next && ctx ? Math.ceil((next.hit - now) / beatSec) : null;
    const key = next && ctx ? `${next.id}|${next.label}|${left}|${info.clock.bpm}` : `idle|${info.playing}|${info.clock.bpm}`;
    if (key === cdKey) return;
    cdKey = key;
    if (next && ctx) {
      const steps = [3, 2, 1].map((n) => h('span', { class: `cd-n${n === left ? ' on' : left < n ? ' past' : ''}` }, String(n)));
      countdown.replaceChildren(h('span', { class: 'cd-label' }, `${next.label}${next.id === 'riser' || next.id === 'reverse' ? '까지' : ''}`),
        ...steps.flatMap((x, i) => (i ? [h('span', { class: 'cd-dot' }, '·'), x] : [x])), h('span', { class: 'cd-unit' }, `박 · ${info.clock.bpm} BPM`));
      countdown.classList.toggle('far', left > 3);
      if (left > 3) countdown.querySelector('.cd-label').textContent = `${next.label} · ${left}박 남음`;
    } else {
      countdown.replaceChildren(h('span', { class: 'cd-label' }, info.playing ? '대기 중' : '루퍼 멈춤 · 누르면 바로'), h('span', { class: 'cd-unit' }, `${info.clock.bpm} BPM`));
      countdown.classList.remove('far');
    }
  }
  let cdKey = '';
  let lineKey = '';
  function drawTimeline({ info, beatSec, beatsPerBar, now }) {
    if (timeline.closest('[hidden]')) return;
    // 루퍼가 멈춰 있으면 그림이 바뀔 때만 다시 그린다
    const loopLabel = info.tracks.find((t) => t.notes.length && t.sound)?.sound.label ?? '';
    const key = info.playing ? `play|${now}` : `idle|${loopLabel}|${info.clock.bars}|${beatsPerBar}|${timeline.clientWidth}|${timeline.clientHeight}`;
    if (key === lineKey) return;
    lineKey = key;
    const { g, w, h: hh } = fit(timeline);
    const pad = { l: 14, r: 14 };
    const bars = 4;
    const playing = info.playing && app.studio.ctx;
    const beat = playing ? Math.max(0, (now - info.t0) / beatSec) : 0;
    const firstBar = Math.floor(beat / beatsPerBar);
    const b0 = firstBar * beatsPerBar;
    const span = bars * beatsPerBar;
    const xOf = (b) => pad.l + ((b - b0) / span) * (w - pad.l - pad.r);
    g.font = `12px ${color('font-body')}`;
    for (let k = 0; k <= bars; k++) {
      const x = Math.round(xOf(b0 + k * beatsPerBar)) + 0.5;
      g.strokeStyle = color(k === 0 ? 'line-strong' : 'line');
      g.beginPath();
      g.moveTo(x, 18);
      g.lineTo(x, hh - 8);
      g.stroke();
      if (k < bars) {
        g.fillStyle = color('muted');
        g.fillText(`${((firstBar + k) % info.clock.bars) + 1}마디`, x + 4, 13);
      }
      for (let q = 1; k < bars && q < beatsPerBar; q++) {
        const xb = Math.round(xOf(b0 + k * beatsPerBar + q)) + 0.5;
        g.strokeStyle = color('grid');
        g.beginPath();
        g.moveTo(xb, 40);
        g.lineTo(xb, hh - 8);
        g.stroke();
      }
    }
    // 루퍼 줄
    const loopName = info.tracks.find((t) => t.notes.length && t.sound)?.sound.label;
    g.fillStyle = color('signal-wash');
    g.fillRect(xOf(b0), 22, w - pad.l - pad.r, 12);
    g.fillStyle = color('signal');
    g.font = `11px ${color('font-body')}`;
    g.fillText(loopName ? `루퍼 · ${loopName}` : '루퍼', xOf(b0) + 6, 32);
    // 예약된 효과음
    const yTop = 46;
    const yBot = hh - 12;
    for (const x of scheduled) {
      if (!playing) continue;
      const sb = (x.start - info.t0) / beatSec;
      const hb = (x.hit - info.t0) / beatSec;
      const eb = (x.end - info.t0) / beatSec;
      if (eb < b0 || sb > b0 + span) continue;
      g.fillStyle = color('brass-wash');
      g.strokeStyle = color('brass');
      g.lineWidth = 2;
      g.beginPath();
      if (x.id === 'riser' || x.id === 'reverse') {
        g.moveTo(xOf(sb), yBot);
        g.lineTo(xOf(hb), yTop);
        g.lineTo(xOf(hb), yBot);
      } else if (x.id === 'down') {
        g.moveTo(xOf(sb), yTop);
        g.lineTo(xOf(eb), yBot);
        g.lineTo(xOf(sb), yBot);
      } else {
        g.moveTo(xOf(hb), yTop);
        g.lineTo(xOf(hb) + 10, yBot);
        g.lineTo(xOf(hb) - 2, yBot);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = color('brass-hi');
      g.font = `12px ${color('font-body')}`;
      g.fillText(x.label, Math.max(pad.l, xOf(sb) + 4), yTop + 14);
    }
    if (playing) {
      const x = Math.round(xOf(beat)) + 0.5;
      g.strokeStyle = color('signal');
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 18);
      g.lineTo(x, hh - 8);
      g.stroke();
      g.fillStyle = color('signal');
      g.font = `12px ${color('font-data')}`;
      const inLoop = beat % info.clock.beats;
      g.fillText(`지금 ${Math.floor(inLoop / beatsPerBar) + 1}.${Math.floor(inLoop % beatsPerBar) + 1}`, Math.min(w - 70, x + 6), hh - 12);
    } else {
      g.fillStyle = color('faint');
      g.font = `12px ${color('font-body')}`;
      g.fillText('루퍼를 재생하면 마디에 맞춰 예약된 효과음이 보여요', pad.l + 6, hh / 2 + 10);
    }
  }

  // ---- 드론: 곡의 조로 계속 깔리는 바닥 소리 ----
  let drone = null;
  let droneKey = null; // null = 곡의 조(조옮김)를 따라감
  const droneOpt = { level: 0.6, shimmer: 0.25, bright: 0.5, fifth: true, octave: true };
  const keyNow = () => droneKey ?? ((app.tuning.transpose % 12) + 12) % 12;
  const droneBtn = h('button', { type: 'button', class: 'sync-pill drone-btn', 'aria-pressed': 'false' });
  const droneNote = h('span', { class: 'panel-hint' });
  const droneKeys = h('div', { class: 'drone-keys', role: 'group', 'aria-label': '드론 조' });
  const dKnob = (label, key, fmt, def) => knob({
    label, min: 0, max: 1, value: droneOpt[key], size: 'sm', format: fmt,
    onInput: (v) => { droneOpt[key] = v; drone?.inst.setPatch(dronePatch()); },
    onChange: (v) => { droneOpt[key] = v; drone?.inst.setPatch(dronePatch()); },
    defaultValue: () => def,
  });
  const pct = (v) => `${Math.round(v * 100)}%`;
  const droneVol = dKnob('드론 볼륨', 'level', pct, 0.6);
  const droneShim = dKnob('시머', 'shimmer', pct, 0.25);
  const droneBright = dKnob('밝기', 'bright', (v) => (v < 0.35 ? '어둡게' : v > 0.65 ? '밝게' : '보통'), 0.5);
  const fifthBtn = h('button', { type: 'button', class: 'chip-btn' }, '5도 더하기');
  const octBtn = h('button', { type: 'button', class: 'chip-btn' }, '옥타브 위 더하기');
  fifthBtn.addEventListener('click', () => { droneOpt.fifth = !droneOpt.fifth; restartDrone(); renderDrone(); });
  octBtn.addEventListener('click', () => { droneOpt.octave = !droneOpt.octave; restartDrone(); renderDrone(); });
  const dronePatch = () => {
    const p = factoryById('drone-pad').patch;
    return { ...p, volume: p.volume * droneOpt.level, filter: { ...p.filter, cutoff: 500 * 2 ** (droneOpt.bright * 3) }, fx: { ...p.fx, shimmer: droneOpt.shimmer } };
  };
  function startDrone() {
    const pc = keyNow();
    // 악기가 조옮김을 따로 더하므로, 들리는 음이 pc 가 되도록 건반 번호를 거꾸로 맞춘다
    const root = 36 + ((((pc - app.tuning.transpose) % 12) + 12) % 12);
    const inst = new Instrument(app.studio.env(), dronePatch());
    const notes = [root, droneOpt.fifth ? root + 7 : null, droneOpt.octave ? root + 12 : null].filter((m) => m != null);
    for (const m of notes) inst.noteOn(m, 0.6);
    drone = { inst, pc };
  }
  function stopDrone() {
    if (!drone) return;
    const { inst } = drone;
    inst.allOff();
    setTimeout(() => inst.dispose(), 7000);
    drone = null;
  }
  const restartDrone = () => { if (drone) { stopDrone(); startDrone(); } };
  droneBtn.addEventListener('click', async () => {
    if (drone) stopDrone();
    else {
      await app.ensureAudio();
      // 소리 켜기를 기다리는 동안 두 번 눌렸으면 하나만
      if (!drone) startDrone();
    }
    renderDrone();
  });
  function renderDrone() {
    const songPc = ((app.tuning.transpose % 12) + 12) % 12;
    droneBtn.setAttribute('aria-pressed', String(Boolean(drone)));
    droneBtn.replaceChildren(h('span', { class: 'led', 'aria-hidden': 'true' }), drone ? `드론 켜짐 · ${NOTE_NAMES[drone.pc]}` : '드론 켜기');
    droneNote.textContent = droneKey == null
      ? `곡 조옮김 ${signed(app.tuning.transpose)} 를 따라가요 (C 를 누르면 ${NOTE_NAMES[songPc]})`
      : `${NOTE_NAMES[droneKey]} 로 고정 · 곡 조를 따라가려면 '곡 조'`;
    droneKeys.replaceChildren(
      h('button', { type: 'button', class: 'drone-key is-song', 'aria-pressed': String(droneKey == null), onclick: () => setDroneKey(null) }, `곡 조 ${NOTE_NAMES[songPc]}`),
      ...NOTE_NAMES.map((n, pc) => h('button', {
        type: 'button', class: `drone-key${n.length > 1 ? ' black' : ''}`, 'aria-pressed': String(keyNow() === pc && (droneKey === pc || droneKey == null)),
        onclick: () => setDroneKey(pc),
      }, n)));
    fifthBtn.setAttribute('aria-pressed', String(droneOpt.fifth));
    octBtn.setAttribute('aria-pressed', String(droneOpt.octave));
  }
  function setDroneKey(pc) {
    droneKey = pc;
    if (drone && drone.pc !== keyNow()) { stopDrone(); startDrone(); }
    renderDrone();
  }
  app.on('tuning', () => {
    if (drone && droneKey == null && drone.pc !== keyNow()) { stopDrone(); startDrone(); }
    if (!root.hidden) renderDrone();
  });
  app.on('panic', () => { stopDrone(); renderDrone(); });

  const fxStrip = h('section', { class: 'fx-panel', 'aria-label': '전환 효과음' },
    h('div', { class: 'fx-head' }, h('h2', {}, '전환 · 드론'), h('p', { class: 'panel-hint' }, '손이 바쁠 때 한 번에 — 패드 바로 아래 늘 보이는 줄')),
    h('div', { class: 'fx-sync-row' }, syncBtn, h('span', { class: 'panel-hint' }, '루퍼가 돌고 있을 때만 · 멈춰 있으면 바로 터짐'), countdown),
    h('div', { class: 'fx-cards' }, ...fxCards.map((c) => c.b)),
    timeline);
  const dronePanel = h('section', { class: 'panel drone-panel', 'aria-label': '드론' },
    h('header', { class: 'panel-head' }, h('h3', {}, '드론'), h('p', { class: 'panel-hint' }, '12키, 곡 조를 따라감')),
    h('div', { class: 'drone-top' }, droneBtn, droneNote),
    droneKeys,
    h('div', { class: 'drone-ctl' }, droneVol.el, droneShim.el, droneBright.el, h('div', { class: 'drone-toggles' }, fifthBtn, octBtn)));
  const rotaryPanel = h('section', { class: 'panel rotary-stage', 'aria-label': '오르간 로터리' }, rotaryBtn, rotaryNote);

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
  const arrOpenBtn = h('button', { type: 'button', class: 'stage-btn small', onclick: () => { setLooperOpen(true); app.looper.openArranger(); } }, '반주 만들기');
  strip.append(openBtn, arrOpenBtn);
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
        padsGrid),
      h('aside', { class: 'stage-side', 'aria-label': '연주 조절' },
        h('div', { class: 'stage-head' }, h('h2', {}, '손가락으로 밀기'), xyRead),
        xyPad,
        h('div', { class: 'xy-ranges' },
          h('label', { for: xId }, '밝기'), xRange,
          h('label', { for: yId }, '공간'), yRange, centerBtn),
        h('div', { class: 'stage-side-btns' }, holdBtn, nextSoundBtn),
        rotaryPanel)),
    // 연주 중 자주 누르는 순서: 루퍼 → 전환 효과음 → 드론
    strip,
    looperWrap,
    fxStrip,
    dronePanel);

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
    setText(lPlay, info.playing ? '■ 정지' : '▶ 재생');
    setAttr(lPlay, 'aria-pressed', String(info.playing));
    setAttr(lRec, 'aria-pressed', String(info.recording));
    setText(lRec, info.counting ? '● 세는 중…' : info.recording ? '● 녹음 멈추기' : '● 녹음');
    setText(lPos, info.beat == null ? '1.1' : info.beat < 0 ? '카운트' : `${Math.floor(info.inLoop / info.clock.beatsPerBar) + 1}.${Math.floor(info.inLoop % info.clock.beatsPerBar) + 1}`);
    const frac = info.inLoop == null ? 0 : info.inLoop / info.clock.beats;
    if (lBars.childElementCount !== info.tracks.length) lBars.replaceChildren(...info.tracks.map(() => h('span', { class: 'strip-bar' }, h('span'))));
    info.tracks.forEach((tr, i) => {
      const bar = lBars.children[i];
      const cls = `strip-bar strip-${tr.color}${tr.notes.length ? '' : ' empty'}${tr.muted ? ' muted' : ''}`;
      if (bar.className !== cls) bar.className = cls;
      const width = `${tr.notes.length ? frac * 100 : 0}%`;
      if (bar.firstChild.style.width !== width) bar.firstChild.style.width = width;
    });
    setText(lInfo, `${info.clock.bpm} BPM · ${info.clock.bars}마디 · 녹음할 트랙 ${info.armed + 1}`);
  }

  function renderRotary() {
    const used = app.rotaryUsed;
    const fast = app.patch.fx.rotaryFast;
    rotaryBtn.disabled = !used;
    rotaryBtn.setAttribute('aria-pressed', String(used && fast));
    rotaryBtn.replaceChildren(h('span', { class: 'rb-kicker' }, '오르간 로터리'), h('span', { class: 'rb-title' }, used ? (fast ? '빠름' : '느림') : '꺼짐'),
      h('span', { class: 'led', 'aria-hidden': 'true' }));
    rotaryNote.textContent = used
      ? `${fast ? '한 번 더 누르면 천천히 느려져요' : '누르면 혼부터 빨라져요'}. 건반의 모듈레이션 휠(CC1)도 같은 스위치예요.`
      : '로터리 스피커는 오르간 음색(가스펠 오르간 등)을 고르면 여기 나타나요.';
  }

  function render() {
    renderSet();
    renderPads();
    holdBtn.setAttribute('aria-pressed', String(app.keyboard?.hold ?? false));
    renderXY();
    renderStrip();
    renderRotary();
    renderDrone();
  }

  app.on('patch', ({ phase } = {}) => {
    if (!applying) {
      // 실험실 등 다른 곳에서 음색을 바꾸면 판은 그 소리를 가운데로 삼는다
      base = app.patch;
      xy.x = 0.5;
      xy.y = 0.5;
    }
    if (phase !== 'input' && !root.hidden) { renderPads(); renderXY(); renderRotary(); }
  });
  app.on('presets', render);
  app.on('hold', () => holdBtn.setAttribute('aria-pressed', String(app.keyboard.hold)));
  app.on('show:stage', render);
  app.onFrame(() => { if (!root.hidden) { renderStrip(); renderFx(); } });
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
    currentSong: () => st.songs[st.current] ?? null,
    /** 무대의 한 부분으로 가기: 'set' | 'pads' | 'fx' | 'drone' | 'looper' */
    focus(part) {
      if (part === 'set') { editSet = true; render(); }
      if (part === 'looper') setLooperOpen(true);
      const el = { set: setEditor, pads: padsGrid, fx: fxStrip, drone: dronePanel, looper: looperWrap }[part];
      requestAnimationFrame(() => el?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    },
    pickPad: (k) => choose(entryFor(st.pads[k])),
    pads: st.pads,
    looperSlot,
    openLooper: () => setLooperOpen(true),
    assignPad(k, id) { st.pads[k] = id; persist(); renderPads(); },
    playFxAt,
    fireFx,
    drone: () => (drone ? { pc: drone.pc, voices: drone.inst.voiceCount } : null),
  };
}
