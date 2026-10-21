// 건반: 화면 건반(여러 손가락 터치, 미끄러지듯 치기), 컴퓨터 키보드, Web MIDI 건반.
// 화면 건반은 위쪽을 누르면 여리게, 아래쪽을 누르면 세게 친다.
import { h } from './ui.js';
import { noteName } from './tuning.js';

// A 줄 = 흰 건반, 위 줄 = 검은 건반 (Logic·Ableton 과 같은 배치)
const PC_KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'"];
const BLACK = new Set([1, 3, 6, 8, 10]);
const isTyping = (el) => el && (el.isContentEditable || ['TEXTAREA', 'SELECT'].includes(el.tagName)
  || (el.tagName === 'INPUT' && !['range', 'button', 'checkbox', 'radio'].includes(el.type)));

export class Keyboard {
  /** handlers: { noteOn(midi, velocity), noteOff(midi), sustain(on), describe(midi) -> 글, mod(0..1) } */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.base = 48; // 화면 건반 첫 음 C3
    this.pcBase = 60; // 컴퓨터 키보드 A = C4
    this.velocity = 0.75;
    this.down = new Map(); // 누른 출처 -> midi
    this.counts = new Map(); // midi -> 누른 출처 수
    this.hold = false;
    this.build();
    this.bindPc();
    this.bindMidi();
    new ResizeObserver(() => this.layout()).observe(this.keysEl);
  }

  build() {
    this.readout = h('output', { class: 'dock-readout', 'aria-live': 'off' }, '건반을 누르거나 A·S·D… 키를 치세요');
    this.octLabel = h('span', { class: 'oct-label' });
    this.holdBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false', title: '서스테인 페달처럼 손을 떼도 소리가 이어짐' }, '홀드');
    this.holdBtn.addEventListener('click', () => this.setHold(!this.hold));
    this.midiStatus = h('span', { class: 'midi-status', 'data-state': 'off' }, 'MIDI 없음');
    const vel = h('input', { type: 'range', min: 10, max: 100, value: 75, id: 'velocity', 'aria-label': '기본 세기' });
    vel.addEventListener('input', () => { this.velocity = Number(vel.value) / 100; });
    this.keysEl = h('div', { class: 'keys', role: 'group', 'aria-label': '화면 건반' });
    this.root.append(
      h('div', { class: 'dock-bar' },
        h('div', { class: 'oct' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '한 옥타브 아래 (Z)', onclick: () => this.shift(-12) }, '−'),
          this.octLabel,
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': '한 옥타브 위 (X)', onclick: () => this.shift(12) }, '+')),
        h('label', { class: 'vel' }, h('span', { class: 'label' }, '세기'), vel),
        this.holdBtn,
        this.readout,
        this.midiStatus),
      this.keysEl);
  }

  shift(semis) {
    this.base = Math.min(84, Math.max(24, this.base + semis));
    this.pcBase = Math.min(96, Math.max(24, this.pcBase + semis));
    this.layout();
  }

  setHold(on) {
    this.hold = on;
    this.holdBtn.setAttribute('aria-pressed', String(on));
    this.handlers.sustain(on);
  }

  layout() {
    const width = this.keysEl.clientWidth || 360;
    const whites = Math.max(8, Math.min(22, Math.floor(width / 40)));
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
      if (this.counts.get(midi)) key.classList.add('on');
      this.keysEl.append(key);
      if (!black) wi++;
    }
    this.octLabel.textContent = `${noteName(keys[0])}–${noteName(keys.at(-1))}`;
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
      this.mark(midi, true);
      this.readout.textContent = this.handlers.describe?.(midi, velocity) ?? noteName(midi);
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
    } else this.counts.set(midi, n);
  }

  releaseAll() {
    for (const src of [...this.down.keys()]) this.release(src);
  }

  mark(midi, on) {
    this.keysEl.querySelector(`[data-midi="${midi}"]`)?.classList.toggle('on', on);
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
    // 모듈레이션 휠(CC1): 로터리 스피커 느림·빠름 (노드 건반처럼 휠을 올리면 빠르게)
    else if (type === 0xb0 && d1 === 1) this.handlers.mod?.(d2 / 127);
  }
}
