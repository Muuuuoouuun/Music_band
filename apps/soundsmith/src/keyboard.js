// 건반: 화면 건반(여러 손가락 터치, 미끄러지듯 치기), 컴퓨터 키보드, Web MIDI 건반.
// 화면 건반은 위쪽을 누르면 여리게, 아래쪽을 누르면 세게 친다. 누른 세기만큼 건반이 깊이 들어가고 빛난다.
// 위 줄: 88건반 지도(보이는 자리, 끌어서 옮김)·세기·서스테인 페달·지금 친 코드·MIDI·크기·이름·접기.
// 왼쪽: 모듈레이션 휠(로터리 느림·빠름).
import { h, setText, setAttr } from './ui.js';
import { noteName } from './tuning.js';
import { fit, color } from './draw.js';
import { nameChord } from './arrange.js';
import * as store from './store.js';

// A 줄 = 흰 건반, 위 줄 = 검은 건반 (Logic·Ableton 과 같은 배치)
const PC_KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'"];
const BLACK = new Set([1, 3, 6, 8, 10]);
const LOWEST = 21; // A0
const HIGHEST = 108; // C8
const SIZES = [['s', '작게'], ['m', '보통'], ['l', '크게']];
const isTyping = (el) => el && (el.isContentEditable || ['TEXTAREA', 'SELECT'].includes(el.tagName)
  || (el.tagName === 'INPUT' && !['range', 'button', 'checkbox', 'radio'].includes(el.type)));

export class Keyboard {
  /** handlers: { noteOn(midi, velocity), noteOff(midi), sustain(on), describe(midi) -> 글, mod(0..1), transpose() -> 반음 } */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.base = 48; // 화면 건반 첫 음 C3
    this.pcBase = 60; // 컴퓨터 키보드 A = C4
    this.velocity = 0.75;
    this.down = new Map(); // 누른 출처 -> midi
    this.counts = new Map(); // midi -> 누른 출처 수
    this.hold = false;
    this.mod = 0;
    this.visible = [48, 84];
    const ui = store.load('ui', {}) ?? {};
    this.prefs = { size: ['s', 'm', 'l'].includes(ui.kbdSize) ? ui.kbdSize : 'm', labels: ui.kbdLabels !== false, collapsed: ui.kbdCollapsed === true };
    this.build();
    this.bindPc();
    this.bindMidi();
    new ResizeObserver(() => this.layout()).observe(this.keysEl);
  }

  build() {
    this.readout = h('output', { class: 'dock-readout', 'aria-live': 'off' }, '건반을 누르거나 A·S·D… 키를 치세요');
    this.chordEl = h('output', { class: 'kbd-chord', 'aria-live': 'polite', 'aria-label': '지금 친 코드' }, '—');
    this.octLabel = h('span', { class: 'oct-label' });
    this.holdBtn = h('button', { type: 'button', class: 'pedal', 'aria-pressed': 'false', title: '서스테인 페달처럼 손을 떼도 소리가 이어짐 (MIDI 페달 CC64 도 같은 스위치)' },
      h('span', { class: 'led', 'aria-hidden': 'true' }), h('span', { class: 'long' }, '서스테인'), h('span', { class: 'short' }, '페달'));
    this.holdBtn.addEventListener('click', () => this.setHold(!this.hold));
    this.midiStatus = h('span', { class: 'midi-status', 'data-state': 'off' }, 'MIDI 없음');
    const vel = h('input', { type: 'range', min: 10, max: 100, value: 75, id: 'velocity', 'aria-label': '기본 세기' });
    vel.addEventListener('input', () => { this.velocity = Number(vel.value) / 100; });
    this.velMeter = h('span', { class: 'vel-meter', 'aria-hidden': 'true' }, h('span'));
    // 88건반 지도: 보이는 자리를 금색 창으로. 누르거나 끌면 그 자리로, 화살표 키로 한 옥타브씩
    this.map = h('canvas', { class: 'kbd-map', role: 'slider', tabindex: '0', 'aria-label': '건반 자리 (88건반 중 보이는 범위)', 'aria-valuemin': String(LOWEST), 'aria-valuemax': String(HIGHEST) });
    this.bindMap();
    this.sizeSeg = h('div', { class: 'seg kbd-size', role: 'group', 'aria-label': '건반 크기' },
      ...SIZES.map(([id, label]) => h('button', { type: 'button', class: 'seg-btn', dataset: { size: id }, title: `건반 ${label}`, onclick: () => this.setPref({ size: id }) }, id.toUpperCase())));
    this.labelBtn = h('button', { type: 'button', class: 'toggle small kbd-labels', title: '건반에 컴퓨터 키(A W S…)와 C 이름 보이기', onclick: () => this.setPref({ labels: !this.prefs.labels }) }, '이름');
    this.foldBtn = h('button', { type: 'button', class: 'small kbd-fold', 'aria-controls': 'kbd-body', onclick: () => this.setPref({ collapsed: !this.prefs.collapsed }) });
    this.wheel = this.buildWheel();
    this.keysEl = h('div', { class: 'keys', role: 'group', 'aria-label': '화면 건반' });
    this.body = h('div', { class: 'kbd-body', id: 'kbd-body' }, this.wheel, h('div', { class: 'kbd-bed' }, this.keysEl));
    this.root.append(
      h('div', { class: 'dock-bar' },
        h('div', { class: 'oct' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '한 옥타브 아래 (Z)', onclick: () => this.shift(-12) }, '−'),
          h('div', { class: 'kbd-map-wrap' }, this.map, this.octLabel),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '한 옥타브 위 (X)', onclick: () => this.shift(12) }, '+')),
        h('label', { class: 'vel' }, h('span', { class: 'label' }, '세기'), vel, this.velMeter),
        this.holdBtn,
        h('div', { class: 'kbd-now' }, this.chordEl, this.readout),
        this.midiStatus,
        h('div', { class: 'kbd-opts' }, this.sizeSeg, this.labelBtn),
        this.foldBtn),
      this.body);
    this.applyPrefs();
  }

  setPref(change) {
    Object.assign(this.prefs, change);
    const ui = store.load('ui', {}) ?? {};
    store.save('ui', { ...ui, kbdSize: this.prefs.size, kbdLabels: this.prefs.labels, kbdCollapsed: this.prefs.collapsed });
    this.applyPrefs();
    if (change.collapsed === true) this.releaseAll();
  }

  applyPrefs() {
    const { size, labels, collapsed } = this.prefs;
    this.root.dataset.size = size;
    this.root.dataset.collapsed = String(collapsed);
    this.keysEl.dataset.labels = labels ? 'on' : 'off';
    this.body.hidden = collapsed;
    for (const b of this.sizeSeg.children) b.setAttribute('aria-pressed', String(b.dataset.size === size));
    this.labelBtn.setAttribute('aria-pressed', String(labels));
    this.foldBtn.setAttribute('aria-expanded', String(!collapsed));
    this.foldBtn.replaceChildren(h('span', { class: 'long' }, collapsed ? '건반 펴기 ' : '건반 접기 '), collapsed ? '▴' : '▾');
    this.foldBtn.setAttribute('aria-label', collapsed ? '건반 펴기' : '건반 접기');
    requestAnimationFrame(() => { this.layout(); window.dispatchEvent(new Event('resize')); });
  }

  /** 모듈레이션 휠: 위로 끌면 커짐 (가운데를 넘으면 로터리가 빨라짐). 화살표·PageUp/Down 으로도 */
  buildWheel() {
    const ribs = h('span', { class: 'wheel-ribs', 'aria-hidden': 'true' });
    const fill = h('span', { class: 'wheel-fill', 'aria-hidden': 'true' });
    const el = h('div', { class: 'wheel', role: 'slider', tabindex: '0', 'aria-label': '모듈레이션 휠 (로터리 느림·빠름)', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', title: '모듈레이션 휠: 위로 올리면 로터리가 빨라져요' }, fill, ribs);
    const set = (v) => {
      this.mod = Math.min(1, Math.max(0, v));
      el.style.setProperty('--mod', this.mod);
      el.setAttribute('aria-valuenow', String(Math.round(this.mod * 100)));
      this.handlers.mod?.(this.mod);
    };
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drag = { y: e.clientY, v: this.mod, hgt: el.getBoundingClientRect().height };
    });
    el.addEventListener('pointermove', (e) => { if (drag) set(drag.v + (drag.y - e.clientY) / drag.hgt); });
    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('pointercancel', () => { drag = null; });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 0.1, ArrowRight: 0.1, ArrowDown: -0.1, ArrowLeft: -0.1, PageUp: 0.5, PageDown: -0.5 }[e.key];
      if (d == null) return;
      e.preventDefault();
      set(this.mod + d);
    });
    el.addEventListener('dblclick', () => set(0));
    this.setWheel = (v) => {
      this.mod = v;
      el.style.setProperty('--mod', v);
      el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    };
    return h('div', { class: 'wheels' }, el, h('span', { class: 'wheel-label' }, '모드'));
  }

  bindMap() {
    const jump = (e) => {
      const r = this.map.getBoundingClientRect();
      const at = LOWEST + ((e.clientX - r.left) / r.width) * (HIGHEST - LOWEST + 1);
      const span = this.visible[1] - this.visible[0];
      // 보이는 범위의 가운데가 누른 자리에 오도록, C 에서 시작하게 맞춘다
      const base = Math.round((at - span / 2) / 12) * 12;
      this.setBase(base);
    };
    let dragging = false;
    this.map.addEventListener('pointerdown', (e) => { dragging = true; this.map.setPointerCapture(e.pointerId); jump(e); });
    this.map.addEventListener('pointermove', (e) => { if (dragging) jump(e); });
    this.map.addEventListener('pointerup', () => { dragging = false; });
    this.map.addEventListener('pointercancel', () => { dragging = false; });
    this.map.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -12, ArrowDown: -12, ArrowRight: 12, ArrowUp: 12 }[e.key];
      if (d == null) return;
      e.preventDefault();
      this.shift(d);
    });
  }

  setBase(base) {
    const b = Math.min(84, Math.max(24, base));
    if (b === this.base) return;
    this.pcBase = Math.min(96, Math.max(24, this.pcBase + (b - this.base)));
    this.base = b;
    this.releaseAll();
    this.layout();
  }

  drawMap() {
    if (!this.map.isConnected || !this.map.clientWidth) return;
    const { g, w, h: hh } = fit(this.map);
    const whites = [];
    for (let m = LOWEST; m <= HIGHEST; m++) if (!BLACK.has(m % 12)) whites.push(m);
    const ww = w / whites.length;
    const xOfWhite = (m) => whites.indexOf(m) * ww;
    g.fillStyle = '#d9d0bb';
    g.fillRect(0, 0, w, hh);
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    for (let i = 1; i < whites.length; i++) g.fillRect(Math.round(i * ww), 0, 1, hh);
    g.fillStyle = '#1b1912';
    for (let m = LOWEST; m <= HIGHEST; m++) if (BLACK.has(m % 12)) g.fillRect(xOfWhite(m - 1) + ww * 0.62, 0, ww * 0.76, hh * 0.6);
    // 보이는 범위
    const [lo, hi] = this.visible;
    const x0 = xOfWhite(BLACK.has(lo % 12) ? lo - 1 : lo);
    const x1 = xOfWhite(BLACK.has(hi % 12) ? hi - 1 : hi) + ww;
    g.fillStyle = 'rgba(217, 165, 79, 0.28)';
    g.fillRect(x0, 0, x1 - x0, hh);
    g.strokeStyle = color('brass-hi');
    g.lineWidth = 2;
    g.strokeRect(x0 + 1, 1, x1 - x0 - 2, hh - 2);
    // 지금 누른 음
    g.fillStyle = color('signal');
    for (const m of this.counts.keys()) {
      const x = BLACK.has(m % 12) ? xOfWhite(m - 1) + ww : xOfWhite(m) + ww / 2;
      g.beginPath();
      g.arc(x, hh - 4, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    this.map.setAttribute('aria-valuenow', String(lo));
    this.map.setAttribute('aria-valuetext', `${noteName(lo)}–${noteName(hi)}`);
  }

  shift(semis) {
    this.base = Math.min(84, Math.max(24, this.base + semis));
    this.pcBase = Math.min(96, Math.max(24, this.pcBase + semis));
    this.layout();
  }

  /** 지금 누르고 있는 음으로 코드 이름 (서스테인으로 이어지는 음은 빼고, 손가락으로 누른 음만) */
  renderChord() {
    const held = [...this.counts.keys()];
    const c = nameChord(held);
    const shift = this.handlers.transpose?.() ?? 0;
    let text = '—';
    if (c) {
      // 조옮김 중이면 실제로 들리는 코드도 (그 조에 맞는 샵·플랫으로)
      const sounding = shift ? nameChord(held.map((m) => m + shift), ((shift % 12) + 12) % 12) : null;
      text = sounding ? `${c.name} → ${sounding.name}` : c.name;
    } else if (held.length === 1) text = noteName(held[0]);
    else if (held.length > 1) text = held.sort((a, b) => a - b).map(noteName).join(' ');
    setText(this.chordEl, text);
    setAttr(this.chordEl, 'data-state', c ? 'chord' : held.length ? 'notes' : 'idle');
    this.drawMap();
  }

  setHold(on) {
    this.hold = on;
    this.holdBtn.setAttribute('aria-pressed', String(on));
    this.handlers.sustain(on);
  }

  layout() {
    const width = this.keysEl.clientWidth || 360;
    const per = { s: 34, m: 40, l: 48 }[this.prefs?.size ?? 'm'];
    const whites = Math.max(8, Math.min(29, Math.floor(width / per)));
    const keys = [];
    let m = this.base;
    let white = 0;
    while (white < whites) {
      keys.push(m);
      if (!BLACK.has(m % 12)) white++;
      m++;
    }
    if (BLACK.has(keys.at(-1) % 12)) keys.pop();
    this.keysEl.replaceChildren();
    this.keysEl.style.setProperty('--whites', whites);
    let wi = 0;
    for (const midi of keys) {
      const black = BLACK.has(midi % 12);
      const pcIndex = midi - this.pcBase;
      const pc = pcIndex >= 0 && pcIndex < PC_KEYS.length ? PC_KEYS[pcIndex].toUpperCase() : '';
      const key = h('button', {
        type: 'button', class: black ? 'key black' : 'key white', tabindex: '-1',
        dataset: { midi }, 'aria-label': noteName(midi),
        style: black ? `--x:${wi}` : null,
      }, h('span', { class: 'key-pc' }, pc), midi % 12 === 0 ? h('span', { class: 'key-c' }, noteName(midi)) : null);
      if (midi === 60) key.classList.add('middle-c');
      if (this.counts.get(midi)) key.classList.add('on');
      this.keysEl.append(key);
      if (!black) wi++;
    }
    this.octLabel.textContent = `${noteName(keys[0])}–${noteName(keys.at(-1))}`;
    this.visible = [keys[0], keys.at(-1)];
    this.drawMap();
    this.keysEl.onpointerdown = (e) => this.pointer(e, 'down');
    this.keysEl.onpointermove = (e) => this.pointer(e, 'move');
    this.keysEl.onpointerup = this.keysEl.onpointercancel = (e) => this.pointer(e, 'up');
    this.keysEl.onlostpointercapture = (e) => this.pointer(e, 'up');
  }

  keyAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('.key');
    return el && this.keysEl.contains(el) ? el : null;
  }

  pointer(e, phase) {
    const src = `p${e.pointerId}`;
    if (phase === 'down') {
      e.preventDefault();
      this.keysEl.setPointerCapture?.(e.pointerId);
    }
    if (phase === 'up') {
      this.release(src);
      return;
    }
    if (phase === 'move' && !this.down.has(src)) return;
    const key = this.keyAt(e.clientX, e.clientY);
    const midi = key ? Number(key.dataset.midi) : null;
    if (midi === this.down.get(src)) return;
    this.release(src);
    if (midi == null) return;
    const r = key.getBoundingClientRect();
    const v = 0.3 + 0.7 * Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    this.press(src, midi, Math.min(1, v * (0.55 + this.velocity * 0.6)));
  }

  press(src, midi, velocity) {
    this.down.set(src, midi);
    const n = (this.counts.get(midi) ?? 0) + 1;
    this.counts.set(midi, n);
    if (n === 1) {
      this.handlers.noteOn(midi, velocity);
      this.mark(midi, true, velocity);
      this.readout.textContent = this.handlers.describe?.(midi, velocity) ?? noteName(midi);
      this.velMeter.firstChild.style.height = `${Math.round(velocity * 100)}%`;
      this.renderChord();
    }
  }

  release(src) {
    const midi = this.down.get(src);
    if (midi == null) return;
    this.down.delete(src);
    const n = (this.counts.get(midi) ?? 1) - 1;
    if (n <= 0) {
      this.counts.delete(midi);
      this.handlers.noteOff(midi);
      this.mark(midi, false);
      this.renderChord();
    } else this.counts.set(midi, n);
  }

  releaseAll() {
    for (const src of [...this.down.keys()]) this.release(src);
  }

  mark(midi, on, velocity = 0.75) {
    const key = this.keysEl.querySelector(`[data-midi="${midi}"]`);
    if (!key) return;
    if (on) key.style.setProperty('--v', velocity.toFixed(2));
    key.classList.toggle('on', on);
  }

  bindPc() {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'x') {
        if (!e.repeat) this.shift(k === 'z' ? -12 : 12);
        return;
      }
      const i = PC_KEYS.indexOf(k);
      if (i < 0) return;
      e.preventDefault();
      if (e.repeat) return;
      this.press(`k${k}`, this.pcBase + i, this.velocity);
    });
    window.addEventListener('keyup', (e) => this.release(`k${e.key.toLowerCase()}`));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());
  }

  async bindMidi() {
    if (!navigator.requestMIDIAccess) {
      this.midiStatus.textContent = 'MIDI 미지원 브라우저';
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess();
      const attach = () => {
        const inputs = [...access.inputs.values()];
        this.midiStatus.dataset.state = inputs.length ? 'on' : 'off';
        this.midiStatus.textContent = inputs.length ? `MIDI · ${inputs[0].name}` : 'MIDI 건반 없음';
        for (const input of inputs) input.onmidimessage = (msg) => this.midi(msg.data);
      };
      access.onstatechange = attach;
      attach();
    } catch {
      this.midiStatus.textContent = 'MIDI 사용 안 됨';
    }
  }

  midi([status, d1, d2]) {
    const type = status & 0xf0;
    if (type === 0x90 && d2 > 0) this.press(`m${d1}`, d1, d2 / 127);
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) this.release(`m${d1}`);
    else if (type === 0xb0 && d1 === 64) this.setHold(d2 >= 64);
    // 모듈레이션 휠(CC1): 로터리 스피커 느림·빠름 (노드 건반처럼 휠을 올리면 빠르게). 화면의 휠도 따라 움직인다
    else if (type === 0xb0 && d1 === 1) {
      this.setWheel?.(d2 / 127);
      this.handlers.mod?.(d2 / 127);
    }
  }
}
