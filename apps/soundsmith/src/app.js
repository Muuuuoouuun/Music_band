// 음색 공방: 화면·소리·저장을 잇는 곳. 음색(patch, 톤 포함)·튜닝·샘플은 여기 한 곳에 있고,
// 화면들은 app.on('patch' | 'tuning' | 'sample' ...) 으로 바뀐 것을 듣는다.
import { Studio, Instrument } from './engine.js';
import { normalizePatch, setPath } from './patch.js';
import { FACTORY, factoryById } from './presets.js';
import { makeTuner, normalizeTuning, noteName, TEMPERAMENTS, NOTE_NAMES } from './tuning.js';
import { bakeSample } from './sample.js';
import { Library } from './library.js';
import { Keyboard } from './keyboard.js';
import { drawScope } from './draw.js';
import * as store from './store.js';
import { StageView } from './view-stage.js';
import { LabView } from './view-lab.js';
import { SamplerView } from './view-sampler.js';
import { LooperView } from './view-looper.js';
import { ToneView } from './view-tone.js';
import { PadsView } from './view-pads.js';

const TABS = ['stage', 'lab', 'tone', 'pads'];

/** 이 음색(겹친 음색 포함)이 피아노 샘플을 쓰는지 */
export const usesPiano = (p) => p.source === 'piano' || (p.layers ?? []).some((l) => l.patch.source === 'piano');

class App {
  constructor() {
    this.studio = new Studio();
    this.listeners = new Map();
    this.frames = new Set();
    const saved = store.load('patch', null);
    this.patch = saved ? normalizePatch(saved) : FACTORY[0].patch;
    this.presetId = saved ? null : FACTORY[0].id;
    this.committed = this.patch;
    this.committedPresetId = this.presetId;
    this.history = []; // [{ patch, presetId }]
    this.userPresets = (store.load('presets', []) || [])
      .filter((x) => x && typeof x.id === 'string' && x.patch)
      .map((x) => ({ id: x.id, patch: normalizePatch(x.patch) }));
    this.tuning = normalizeTuning(store.load('tuning', {}));
    this.studio.tuner = makeTuner(this.tuning);
    // 샘플 악기(그랜드 피아노)는 처음 쓸 때 받는다. 푸는 일은 소리 켜기와 상관없이 따로 한다.
    let decoder = null;
    this.studio.library = new Library({
      decode: (buf) => (decoder ??= new OfflineAudioContext(2, 1, 44100)).decodeAudioData(buf),
      onProgress: (id, prog) => this.emit('library', { id, ...prog }),
    });
    this.sample = null;
    this.bakedSample = null;
    this.engineSample = null;
    this.live = null;
    this.keyTarget = null;
    this.tab = 'stage';
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
    if (usesPiano(patch)) this.studio.library.load('grand').catch(() => {});
    if (phase === 'change' && JSON.stringify(this.committed) !== JSON.stringify(patch)) {
      this.history.push({ patch: this.committed, presetId: this.committedPresetId });
      if (this.history.length > 60) this.history.shift();
      this.committed = patch;
      store.save('patch', patch);
    }
    if (phase === 'change') this.committedPresetId = this.presetId;
    this.live?.setPatch(patch);
    this.emit('patch', { phase, keepMacros });
    this.renderHeader();
  }

  setParam(path, value, phase = 'change') {
    this.setPatch(setPath(this.patch, path, value), { phase, keepMacros: true });
  }

  /** 지금 음색(겹친 음색 포함)에 로터리 스피커가 걸려 있는지 */
  get rotaryUsed() {
    return this.patch.fx.rotary > 0.001 || this.patch.layers.some((l) => l.patch.fx.rotary > 0.001);
  }

  /** 로터리 느림·빠름 (무대 버튼·모듈레이션 휠). 겹친 음색에도 같이. */
  setRotaryFast(on) {
    const p = structuredClone(this.patch);
    p.fx.rotaryFast = on;
    for (const l of p.layers) l.patch.fx.rotaryFast = on;
    this.setPatch(p, { phase: 'change', keepMacros: true });
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.committed = prev.patch;
    this.patch = prev.patch;
    this.presetId = prev.presetId;
    this.committedPresetId = prev.presetId;
    store.save('patch', prev.patch);
    this.live?.setPatch(prev.patch);
    this.emit('patch', { phase: 'change' });
    this.renderHeader();
  }

  loadPreset(entry) {
    this.setPatch(entry.patch, { phase: 'change', presetId: entry.id });
  }

  /** 내 음색 또는 기본 음색 { id, patch, factory? } */
  findPreset(id) {
    if (!id) return null;
    return this.userPresets.find((u) => u.id === id) ?? factoryById(id);
  }

  /** 지금 음색으로 화음을 잠깐 들려준다 (실험실 '들어 보기'). */
  async audition(notes, seconds = 1.8) {
    await this.ensureAudio();
    const now = this.studio.ctx.currentTime + 0.03;
    for (const m of notes) {
      this.live.noteOn(m, 0.7, now);
      this.live.noteOff(m, now + seconds);
    }
  }

  /** 지금 음색을 무대 패드 k 에 올린다. 저장 안 된 음색이면 먼저 내 음색으로 저장한다. */
  sendToPad(k) {
    let entry = this.findPreset(this.presetId);
    if (!entry || JSON.stringify(entry.patch) !== JSON.stringify(this.patch)) {
      if (entry?.factory && this.patch.name === entry.patch.name) this.setPatch({ ...this.patch, name: `${this.patch.name} 수정` }, { phase: 'change', keepMacros: true });
      this.savePreset({ quiet: true });
      entry = this.findPreset(this.presetId);
    }
    this.stage.assignPad(k, entry.id);
    this.notice(`'${entry.patch.name}' 음색을 예배 무대의 패드 ${k + 1}에 올렸어요.`, 'good');
  }

  sendToTrack(i) {
    this.looper.sendSound(i);
    this.notice(`루퍼 트랙 ${i + 1}에 '${this.patch.name}' 음색을 넣었어요. 예배 무대의 루퍼에서 '트랙 펼치기'를 누르고 그 트랙을 골라 녹음하세요.`, 'good');
  }

  rename(name) {
    const n = name.trim().slice(0, 40);
    if (n && n !== this.patch.name) this.setPatch({ ...this.patch, name: n }, { phase: 'change', keepMacros: true });
  }

  savePreset({ quiet = false } = {}) {
    const mine = this.userPresets.find((u) => u.id === this.presetId);
    if (mine) mine.patch = this.patch;
    else {
      const id = `u${Date.now().toString(36)}`;
      this.userPresets.unshift({ id, patch: this.patch });
      this.presetId = id;
    }
    const ok = store.save('presets', this.userPresets);
    this.emit('presets');
    this.emit('patch', { phase: 'change', keepMacros: true });
    if (!quiet) this.notice(ok ? `'${this.patch.name}' 음색을 내 음색에 저장했어요. 이 브라우저에 남아요.` : `'${this.patch.name}' 음색을 목록에 넣었어요. 이 화면은 저장이 막혀 있어 새로고침하면 사라져요.`, ok ? 'good' : 'info');
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
    this.emit('hold');
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
    // 합쳐진 예전 탭 주소: 샘플러는 실험실의 '샘플' 상자, 루퍼는 예배 무대에서 펼친 트랙,
    // 튜닝은 톤 맞추기 화면의 '음 높이 자세히'
    const legacy = id;
    if (id === 'sampler' || id === 'synth') id = 'lab';
    if (id === 'looper') id = 'stage';
    if (id === 'tuning') id = 'tone';
    if (!TABS.includes(id)) id = 'stage';
    const from = this.tab;
    this.tab = id;
    document.body.dataset.tab = id;
    for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-current', String(b.dataset.tab === id));
    for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== id;
    try { history.replaceState(null, '', `#${id}`); } catch { /* 액자 안에서는 무시 */ }
    this.emit(`show:${id}`);
    this.emit('tab', { from, to: id });
    if (legacy === 'sampler') this.lab.openSample();
    if (legacy === 'looper') this.stage.openLooper();
    if (legacy === 'tuning') this.tone.openPitch();
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
if (usesPiano(app.patch)) app.studio.library.load('grand').catch(() => {});
app.on('library', ({ done, total, error }) => {
  if (error) app.notice('피아노 소리를 받지 못했어요. 인터넷 연결을 확인하고 다시 골라 보세요.', 'bad');
  else if (done === total) app.notice('그랜드 피아노 소리를 다 받았어요 (Salamander Grand Piano, CC-BY 3.0).', 'good');
  else if (done === 1) app.notice(`그랜드 피아노 소리를 받는 중이에요 (${total}개 샘플, 약 6 MB). 다 받으면 바로 소리가 나요.`);
});

app.lab = LabView(document.getElementById('view-lab'), app);
SamplerView(app.lab.sampleSlot, app);
app.stage = StageView(document.getElementById('view-stage'), app);
app.looper = LooperView(app.stage.looperSlot, app);
app.tone = ToneView(document.getElementById('view-tone'), app);
app.pads = PadsView(document.getElementById('view-pads'), app);
app.keyboard = new Keyboard(document.getElementById('dock'), {
  noteOn: (m, v) => app.noteOn(m, v),
  noteOff: (m) => app.noteOff(m),
  sustain: (on) => app.sustain(on),
  describe: (m, v) => app.describe(m, v),
  mod: (v) => {
    const fast = v > 0.5;
    if (app.rotaryUsed && fast !== app.patch.fx.rotaryFast) app.setRotaryFast(fast);
  },
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

app.showTab(location.hash.slice(1) || 'stage');
app.renderHeader();
