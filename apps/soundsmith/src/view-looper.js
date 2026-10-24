// 루퍼 화면: 박에 맞춰 도는 4트랙. 트랙마다 음색이 따로 있고, 연주를 음표로 기억해 겹쳐 쌓는다.
import { h, panel, nextId } from './ui.js';
import { drawRoll } from './draw.js';
import { Instrument } from './engine.js';
import { LooperState, METERS, QUANTIZE, loopClock, barBeat, eventsInWindow, exampleLoop } from './looper.js';
import { FACTORY } from './presets.js';

const AHEAD = 0.12;
const TICK_MS = 25;

export function LooperView(root, app) {
  const L = new LooperState(4);
  const ex = exampleLoop();
  let clock = loopClock(ex);
  app.studio.bpm = clock.bpm;
  const byName = (n) => FACTORY.find((f) => f.patch.name === n).patch;
  ['워십 패드', '신스 베이스', 'DX 일렉피아노'].forEach((name, i) => {
    L.tracks[i].notes = ex.tracks[i].map((n) => ({ ...n }));
    L.tracks[i].sound = { patch: byName(name), sample: null, label: name };
    L.tracks[i].example = true;
  });
  L.tracks[1].volume = 0.7;
  L.tracks[2].volume = 0.65;
  const t = { playing: false, t0: 0, scheduled: 0, timer: null, lastIter: 0 };
  const rec = { track: 3, active: false, counting: false };
  let metronome = true;

  // ---- 트랜스포트 ----
  const playBtn = h('button', { type: 'button', class: 'transport-btn', 'aria-pressed': 'false' }, '▶ 재생');
  const recBtn = h('button', { type: 'button', class: 'transport-btn rec', 'aria-pressed': 'false' }, '● 녹음');
  const metroBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'true' }, '메트로놈');
  const bpmId = nextId('bpm');
  const bpm = h('input', { type: 'number', id: bpmId, min: 40, max: 200, step: 1, value: clock.bpm, class: 'bpm-input' });
  const meterSel = h('select', { 'aria-label': '박자' }, ...METERS.map((m) => h('option', { value: m.id }, m.label)));
  const barsSel = h('select', { 'aria-label': '마디 수' }, ...[1, 2, 4, 8].map((b) => h('option', { value: b }, `${b}마디`)));
  const qSel = h('select', { 'aria-label': '퀀타이즈' }, ...QUANTIZE.map((q) => h('option', { value: q.id }, `퀀타이즈 ${q.label}`)));
  meterSel.value = clock.meter;
  barsSel.value = String(clock.bars);
  qSel.value = '1/8';
  L.quantize = 0.5;
  const pos = h('output', { class: 'pos' }, '1.1');
  const posBar = h('div', { class: 'pos-bar' }, h('span', { class: 'pos-fill' }));
  const posNote = h('p', { class: 'pos-note' });

  const transport = h('div', { class: 'transport' },
    h('div', { class: 'transport-main' }, playBtn, recBtn, metroBtn),
    h('div', { class: 'transport-fields' },
      h('label', { class: 'bpm-field', for: bpmId }, h('span', { class: 'label' }, 'BPM'), bpm),
      meterSel, barsSel, qSel),
    h('div', { class: 'transport-pos' }, pos, posBar, posNote));

  // ---- 트랙 ----
  const rows = L.tracks.map((track, i) => {
    const arm = h('button', { type: 'button', class: 'arm', 'aria-pressed': 'false', 'aria-label': `${track.name}에 녹음` }, '●');
    const sound = h('span', { class: 'track-sound' });
    const mute = h('button', { type: 'button', class: 'mini', 'aria-pressed': 'false', 'aria-label': `${track.name} 소리 끄기` }, 'M');
    const solo = h('button', { type: 'button', class: 'mini', 'aria-pressed': 'false', 'aria-label': `${track.name}만 듣기` }, 'S');
    const vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round(track.volume * 100), 'aria-label': `${track.name} 볼륨` });
    const roll = h('canvas', { class: 'roll', 'aria-label': `${track.name} 음표` });
    const undo = h('button', { type: 'button', class: 'quiet small' }, '실행 취소');
    const clear = h('button', { type: 'button', class: 'quiet small' }, '지우기');
    const take = h('button', { type: 'button', class: 'quiet small', title: '지금 음색 만들기 화면의 소리로 바꿈' }, '지금 음색으로');
    arm.addEventListener('click', () => {
      if (rec.active && rec.track !== i) stopRecording();
      rec.track = i;
      render();
    });
    mute.addEventListener('click', () => { track.muted = !track.muted; if (track.muted) track.inst?.allOff(undefined, true); render(); });
    solo.addEventListener('click', () => { track.solo = !track.solo; render(); });
    vol.addEventListener('input', () => { track.volume = Number(vol.value) / 100; applySound(track); });
    undo.addEventListener('click', () => { if (L.undo(i)) { track.inst?.allOff(undefined, true); render(); } });
    clear.addEventListener('click', () => { L.clear(i); track.example = false; track.inst?.allOff(undefined, true); render(); });
    take.addEventListener('click', () => { setSound(track); render(); app.notice(`${track.name} 음색을 지금 음색 '${track.sound.label}'에 맞췄어요.`); });
    const el = h('div', { class: `track track-${track.color}` },
      h('div', { class: 'track-head' },
        arm,
        h('div', { class: 'track-title' }, h('strong', {}, track.name), sound),
        h('div', { class: 'track-btns' }, mute, solo)),
      roll,
      h('div', { class: 'track-foot' }, h('label', { class: 'vol' }, h('span', { class: 'label' }, '볼륨'), vol), take, undo, clear));
    return { el, arm, sound, mute, solo, roll, undo, clear, track };
  });

  root.append(
    panel('루퍼', {
      cls: 'span-wide looper-panel',
      hint: '녹음할 트랙(●)을 고르고 녹음을 누르면 한 마디를 세고 시작해요. 녹음을 켜 둔 채로 돌면 한 바퀴마다 겹쳐 쌓이고, 실행 취소는 마지막 바퀴만 지웁니다.',
    }, transport, h('div', { class: 'tracks' }, ...rows.map((r) => r.el))));

  // ---- 소리 ----
  function setSound(track) {
    track.sound = { patch: app.patch, sample: app.patch.source === 'sample' ? app.engineSample : null, label: app.patch.name };
    applySound(track);
  }
  function applySound(track) {
    if (!track.sound) return;
    const p = { ...track.sound.patch, volume: track.sound.patch.volume * track.volume };
    if (track.inst) {
      track.inst.setPatch(p);
      track.inst.setSample(track.sound.sample);
    } else if (app.studio.ctx) {
      track.inst = new Instrument(app.studio.env(), p, track.sound.sample);
    }
  }
  const ensureInstruments = () => L.tracks.forEach(applySound);

  // ---- 시간 ----
  const beatNow = () => (app.studio.ctx.currentTime - t.t0) / clock.beatSec;

  function tick() {
    const ctx = app.studio.ctx;
    const now = ctx.currentTime;
    const bs = clock.beatSec;
    const until = (now + AHEAD - t.t0) / bs;
    const from = t.scheduled;
    if (until <= from) return;
    for (let b = Math.ceil(from); b < until; b++) {
      if (b < 0 || metronome) app.studio.click(t.t0 + b * bs, ((b % clock.beatsPerBar) + clock.beatsPerBar) % clock.beatsPerBar === 0);
    }
    if (until > 0) {
      const f = Math.max(0, from);
      for (const track of L.tracks) {
        if (!track.inst || !track.notes.length || !L.audible(track)) continue;
        for (const ev of eventsInWindow(track.notes, clock.beats, f, until)) {
          const at = Math.max(now, t.t0 + ev.at * bs);
          track.inst.noteOn(ev.note.midi, ev.note.velocity, at);
          track.inst.noteOff(ev.note.midi, at + Math.max(0.03, ev.note.dur * bs - 0.01));
        }
      }
    }
    t.scheduled = until;
    const cur = (now - t.t0) / bs;
    if (rec.active && cur >= 0) {
      if (rec.counting) {
        rec.counting = false;
        render();
      }
      const iter = Math.floor(cur / clock.beats);
      if (iter !== t.lastIter) {
        t.lastIter = iter;
        L.nextPass();
      }
    }
  }

  async function play({ countIn = false } = {}) {
    const ctx = await app.ensureAudio();
    ensureInstruments();
    L.rewind();
    const lead = countIn ? clock.beatsPerBar * clock.beatSec : 0;
    t.t0 = ctx.currentTime + 0.1 + lead;
    t.scheduled = countIn ? -clock.beatsPerBar : 0;
    t.lastIter = 0;
    t.playing = true;
    clearInterval(t.timer);
    t.timer = setInterval(tick, TICK_MS);
    tick();
    render();
  }

  function stop() {
    if (rec.active) stopRecording();
    clearInterval(t.timer);
    t.timer = null;
    t.playing = false;
    for (const track of L.tracks) track.inst?.allOff(undefined, true);
    render();
  }

  async function startRecording() {
    const track = L.tracks[rec.track];
    await app.ensureAudio();
    if (!track.sound || !track.notes.length) setSound(track);
    ensureInstruments();
    L.nextPass();
    rec.active = true;
    if (!t.playing) {
      rec.counting = true;
      await play({ countIn: true });
    } else {
      t.lastIter = Math.floor(Math.max(0, beatNow()) / clock.beats);
    }
    const inst = track.inst;
    app.keyTarget = {
      noteOn(midi, vel) {
        inst.noteOn(midi, vel);
        let b = beatNow();
        if (b < 0 && b > -0.25) b = 0;
        if (b >= 0) L.noteOn(rec.track, midi, vel, b, clock.beats);
      },
      noteOff(midi) {
        inst.noteOff(midi);
        const note = L.noteOff(rec.track, midi, Math.max(0, beatNow()), clock.beats);
        if (note) track.example = false;
      },
      sustain(on) { inst.setSustain(on); },
    };
    render();
  }

  function stopRecording() {
    const track = L.tracks[rec.track];
    if (t.playing) L.closePending(rec.track, Math.max(0, beatNow()), clock.beats);
    rec.active = false;
    rec.counting = false;
    app.keyTarget = null;
    track.inst?.allOff();
    render();
  }

  playBtn.addEventListener('click', () => (t.playing ? stop() : play()));
  recBtn.addEventListener('click', () => (rec.active ? stopRecording() : startRecording()));
  metroBtn.addEventListener('click', () => { metronome = !metronome; render(); });
  // 빠르기를 바꿔도 지금 박 위치는 그대로 (세트리스트가 곡을 넘길 때도 이 길로)
  function retempo(v) {
    const before = t.playing ? beatNow() : 0;
    clock = loopClock({ bpm: v, meter: clock.meter, bars: clock.bars });
    if (t.playing) t.t0 = app.studio.ctx.currentTime - before * clock.beatSec;
  }
  bpm.addEventListener('change', () => {
    retempo(Math.min(200, Math.max(40, Math.round(Number(bpm.value) || clock.bpm))));
    app.setTempo(clock.bpm);
    render();
  });
  const reshape = () => {
    if (t.playing) stop();
    clock = loopClock({ bpm: clock.bpm, meter: meterSel.value, bars: Number(barsSel.value) });
    L.fitTo(clock.beats);
    render();
  };
  meterSel.addEventListener('change', reshape);
  barsSel.addEventListener('change', reshape);
  qSel.addEventListener('change', () => { L.quantize = QUANTIZE.find((q) => q.id === qSel.value).grid; });

  // ---- 그리기 ----
  function render() {
    playBtn.textContent = t.playing ? '■ 정지' : '▶ 재생';
    playBtn.setAttribute('aria-pressed', String(t.playing));
    recBtn.setAttribute('aria-pressed', String(rec.active));
    recBtn.textContent = rec.counting ? '● 세는 중…' : rec.active ? '● 녹음 멈추기' : '● 녹음';
    metroBtn.setAttribute('aria-pressed', String(metronome));
    bpm.value = String(clock.bpm);
    const armed = L.tracks[rec.track];
    posNote.textContent = rec.active
      ? `${armed.name}에 녹음 중 · 건반 소리도 이 트랙 음색으로 나요`
      : `${clock.bars}마디 · ${clock.meter} · 한 바퀴 ${clock.seconds.toFixed(1)}초 · 녹음할 트랙: ${armed.name}`;
    for (const r of rows) {
      const tr = r.track;
      r.arm.setAttribute('aria-pressed', String(L.tracks.indexOf(tr) === rec.track));
      r.mute.setAttribute('aria-pressed', String(tr.muted));
      r.solo.setAttribute('aria-pressed', String(tr.solo));
      r.sound.textContent = tr.sound ? `${tr.sound.label}${tr.example ? ' · 예시' : ''}` : '음색: 녹음할 때의 지금 음색';
      r.undo.disabled = !tr.notes.length;
      r.clear.disabled = !tr.notes.length;
      r.el.classList.toggle('is-recording', rec.active && L.tracks.indexOf(tr) === rec.track);
      r.el.classList.toggle('is-quiet', !L.audible(tr));
    }
    frame();
  }

  function frame() {
    const playing = t.playing && app.studio.ctx;
    const b = playing ? beatNow() : null;
    const inLoop = b == null ? null : b < 0 ? null : b % clock.beats;
    pos.textContent = b == null ? '1.1' : b < 0 ? `카운트 ${Math.floor(b + clock.beatsPerBar) + 1}` : barBeat(inLoop, clock.beatsPerBar);
    posBar.firstChild.style.width = `${inLoop == null ? 0 : (inLoop / clock.beats) * 100}%`;
    rows.forEach((r, i) => drawRoll(r.roll, r.track.notes, clock.beats, clock.beatsPerBar, inLoop, r.track.color, rec.active && rec.track === i));
  }

  app.onFrame(() => { if (t.playing && !root.hidden) frame(); });
  app.on('show:looper', () => requestAnimationFrame(render));
  app.on('resize', frame);
  app.on('audio', ensureInstruments);
  app.on('panic', stop);
  app.on('tempo', () => {
    if (app.studio.bpm !== clock.bpm) {
      retempo(app.studio.bpm);
      render();
    }
    L.tracks.forEach((tr) => tr.inst?.syncTempo());
  });
  render();
  return { stop, state: L };
}
