// 음색 공방: 화면·소리·저장을 잇는 곳. 음색(patch)·튜닝·샘플은 여기 한 곳에 있고,
// 화면들은 app.on('patch' | 'tuning' | 'sample' ...) 으로 바뀐 것을 듣는다.
import { Studio, Instrument } from './engine.js';
import { normalizePatch, setPath } from './patch.js';
import { FACTORY } from './presets.js';
import { makeTuner, normalizeTuning, noteName, TEMPERAMENTS, NOTE_NAMES } from './tuning.js';
import { bakeSample } from './sample.js';
import { Keyboard } from './keyboard.js';
import { drawScope } from './draw.js';
import * as store from './store.js';
import { SynthView } from './view-synth.js';
import { SamplerView } from './view-sampler.js';
import { LooperView } from './view-looper.js';
import { TuningView } from './view-tuning.js';

const TABS = ['synth', 'sampler', 'looper', 'tuning'];

class App {
  constructor() {
    this.studio = new Studio();
    this.listeners = new Map();
    this.frames = new Set();
    const saved = store.load('patch', null);
    this.patch = saved ? normalizePatch(saved) : FACTORY[0].patch;
    this.presetId = saved ? null : FACTORY[0].id;
    this.committed = this.patch;
    this.history = [];
    this.userPresets = (store.load('presets', []) || [])
      .filter((x) => x && typeof x.id === 'string' && x.patch)
      .map((x) => ({ id: x.id, patch: normalizePatch(x.patch) }));
    this.tuning = normalizeTuning(store.load('tuning', {}));
    this.studio.tuner = makeTuner(this.tuning);
    this.sample = null;
    this.bakedSample = null;
    this.engineSample = null;
    this.live = null;
    this.keyTarget = null;
    this.tab = 'synth';
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }

  emit(type, detail) {
    for (const fn of this.listeners.get(type) ?? []) fn(detail);
  }

  onFrame(fn) {
    this.frames.add(fn);
  }

  notice(text, kind = 'info') {
    const el = document.getElementById('notice');
    el.textContent = text;
    el.dataset.kind = kind;
    el.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { el.hidden = true; }, kind === 'bad' ? 7000 : 4500);
  }

  async ensureAudio() {
    const ctx = await this.studio.start();
    if (!this.live) {
      this.engineSample = this.makeEngineSample();
      this.live = new Instrument(this.studio.env(), this.patch, this.engineSample);
      this.emit('audio');
    }
    this.renderHeader();
    return ctx;
  }

  // ---- 음색 ----
  setPatch(patch, { phase = 'change', presetId, keepMacros = false } = {}) {
    if (presetId !== undefined) this.presetId = presetId;
    this.patch = patch;
    if (phase === 'change' && JSON.stringify(this.committed) !== JSON.stringify(patch)) {
      this.history.push(this.committed);
      if (this.history.length > 60) this.history.shift();
      this.committed = patch;
      store.save('patch', patch);
    }
    this.live?.setPatch(patch);
    this.emit('patch', { phase, keepMacros });
    this.renderHeader();
  }

  setParam(path, value, phase = 'change') {
    this.setPatch(setPath(this.patch, path, value), { phase, keepMacros: true });
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.committed = prev;
    this.patch = prev;
    store.save('patch', prev);
    this.live?.setPatch(prev);
    this.emit('patch', { phase: 'change' });
    this.renderHeader();
  }

  loadPreset(entry) {
    this.setPatch(entry.patch, { phase: 'change', presetId: entry.id });
  }

  rename(name) {
    const n = name.trim().slice(0, 40);
    if (n && n !== this.patch.name) this.setPatch({ ...this.patch, name: n }, { phase: 'change', keepMacros: true });
  }

  savePreset() {
    const mine = this.userPresets.find((u) => u.id === this.presetId);
    if (mine) mine.patch = this.patch;
    else {
      const id = `u${Date.now().toString(36)}`;
      this.userPresets.unshift({ id, patch: this.patch });
      this.presetId = id;
    }
    const ok = store.save('presets', this.userPresets);
    this.emit('presets');
    this.notice(ok ? `'${this.patch.name}' 음색을 내 음색에 저장했어요. 이 브라우저에 남아요.` : `'${this.patch.name}' 음색을 목록에 넣었어요. 이 화면은 저장이 막혀 있어 새로고침하면 사라져요.`, ok ? 'good' : 'info');
  }

  deletePreset(id) {
    this.userPresets = this.userPresets.filter((u) => u.id !== id);
    if (this.presetId === id) this.presetId = null;
    store.save('presets', this.userPresets);
    this.emit('presets');
  }

  // ---- 튜닝·빠르기 ----
  setTuning(t) {
    this.tuning = normalizeTuning(t);
    this.studio.tuner = makeTuner(this.tuning);
    store.save('tuning', this.tuning);
    this.emit('tuning');
    this.renderHeader();
  }

  setTempo(bpm) {
    this.studio.bpm = bpm;
    this.live?.syncTempo();
    this.emit('tempo');
  }

  // ---- 샘플 ----
  setSample(s) {
    this.sample = s;
    queueMicrotask(() => this.renderHeader());
    if (s) s.rootName = noteName(s.root);
    this.bakedSample = s ? bakeSample(s) : null;
    this.engineSample = this.makeEngineSample();
    this.live?.setSample(this.engineSample);
    this.emit('sample');
  }

  makeEngineSample() {
    const s = this.sample;
    const b = this.bakedSample;
    if (!s || !b || !this.studio.ctx) return null;
    const buf = this.studio.ctx.createBuffer(1, b.data.length, s.sr);
    const d = new Float32Array(b.data.length);
    for (let i = 0; i < d.length; i++) d[i] = b.data[i] * b.gain;
    buf.copyToChannel(d, 0);
    return {
      buffer: buf,
      rootHz: 440 * 2 ** ((s.root + s.fine / 100 - 69) / 12),
      start: 0,
      end: b.data.length / s.sr,
      loop: b.loop ? { start: b.loop.start / s.sr, end: b.loop.end / s.sr } : null,
    };
  }

  // ---- 연주 ----
  async noteOn(midi, velocity) {
    if (!this.live) {
      await this.ensureAudio();
      // 소리를 켜는 사이에 이미 손을 뗐다면 울리지 않는다 (멈추지 않는 음 방지)
      if (!this.keyboard?.counts.get(midi)) return;
    }
    (this.keyTarget ?? this.live).noteOn(midi, velocity);
    this.emit('note', { midi, on: true });
  }

  noteOff(midi) {
    if (!this.live) return;
    (this.keyTarget ?? this.live).noteOff(midi);
    this.emit('note', { midi, on: false });
  }

  sustain(on) {
    this.live?.setSustain(on);
    this.keyTarget?.sustain(on);
  }

  describe(midi, velocity) {
    const t = this.studio.tuner;
    const c = t.centsAt(midi);
    const sounding = this.tuning.transpose ? ` → ${noteName(midi + this.tuning.transpose)}` : '';
    return `${noteName(midi)}${sounding} · ${t.freq(midi).toFixed(2)} Hz · ${c >= 0 ? '+' : ''}${c.toFixed(1)} cent · 세기 ${Math.round(velocity * 100)}`;
  }

  panic() {
    const now = this.studio.ctx?.currentTime ?? 0;
    this.keyboard?.releaseAll();
    if (this.keyboard?.hold) this.keyboard.setHold(false);
    this.live?.allOff(now, true);
    this.emit('panic');
  }

  // ---- 화면 ----
  showTab(id) {
    if (!TABS.includes(id)) id = 'synth';
    this.tab = id;
    for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-current', String(b.dataset.tab === id));
    for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== id;
    try { history.replaceState(null, '', `#${id}`); } catch { /* 액자 안에서는 무시 */ }
    this.emit(`show:${id}`);
  }

  renderHeader() {
    document.getElementById('now-patch').textContent = this.patch.source === 'sample' && this.sample ? `${this.patch.name} · 샘플 ${this.sample.name}` : this.patch.name;
    const t = this.tuning;
    const parts = [`A4 ${t.a4}`, TEMPERAMENTS[t.temperament].label];
    if (t.temperament !== 'equal') parts.push(`${NOTE_NAMES[t.root]} 기준`);
    if (t.transpose) parts.push(`조옮김 ${t.transpose > 0 ? '+' : ''}${t.transpose}`);
    document.getElementById('now-tuning').textContent = parts.join(' · ');
    const on = this.studio.running;
    const power = document.getElementById('power');
    power.setAttribute('aria-pressed', String(on));
    document.getElementById('power-label').textContent = on ? '소리 켜짐' : '소리 켜기';
  }
}

const app = new App();
window.soundsmith = app; // 브라우저 검사용

SynthView(document.getElementById('view-synth'), app);
SamplerView(document.getElementById('view-sampler'), app);
app.looper = LooperView(document.getElementById('view-looper'), app);
TuningView(document.getElementById('view-tuning'), app);
app.keyboard = new Keyboard(document.getElementById('dock'), {
  noteOn: (m, v) => app.noteOn(m, v),
  noteOff: (m) => app.noteOff(m),
  sustain: (on) => app.sustain(on),
  describe: (m, v) => app.describe(m, v),
});

for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => app.showTab(b.dataset.tab));
document.getElementById('power').addEventListener('click', async () => {
  if (app.studio.running) {
    app.panic();
    await app.studio.ctx.suspend();
    app.renderHeader();
  } else await app.ensureAudio();
});
document.getElementById('panic').addEventListener('click', () => app.panic());
document.getElementById('master').addEventListener('input', (e) => app.studio.setMaster(Number(e.target.value) / 100));
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => app.emit('resize'), 120);
});

const scope = document.getElementById('scope');
const scopeBuf = new Float32Array(2048);
function frame(time) {
  drawScope(scope, app.studio.running ? app.studio.analyser : null, scopeBuf);
  for (const fn of app.frames) fn(time);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

app.showTab(location.hash.slice(1) || 'synth');
app.renderHeader();
