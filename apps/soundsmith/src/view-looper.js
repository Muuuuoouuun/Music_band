// 루퍼 화면: 박에 맞춰 도는 4트랙. 트랙마다 음색이 따로 있고, 연주를 음표로 기억해 겹쳐 쌓는다.
import { h, panel, nextId, knob } from './ui.js';
import { drawRoll } from './draw.js';
import { Instrument } from './engine.js';
import { LooperState, METERS, QUANTIZE, loopClock, barBeat, eventsInWindow, exampleLoop } from './looper.js';
import { factoryById, FACTORY } from './presets.js';
import { parseChart, arrange, liftPoints, STYLES } from './arrange.js';

const AHEAD = 0.12;
const TICK_MS = 25;

export function LooperView(root, app) {
  const L = new LooperState(4);
  const ex = exampleLoop();
  let clock = loopClock(ex);
  app.studio.bpm = clock.bpm;
  ['worship-pad', 'synth-bass', 'dx-ep'].forEach((id, i) => {
    const { patch } = factoryById(id);
    L.tracks[i].notes = ex.tracks[i].map((n) => ({ ...n }));
    L.tracks[i].sound = { patch, sample: null, label: patch.name };
    L.tracks[i].example = true;
  });
  L.tracks[1].volume = 0.7;
  L.tracks[2].volume = 0.65;
  const t = { playing: false, t0: 0, scheduled: 0, timer: null, lastIter: 0 };
  const rec = { track: 3, active: false, counting: false };
  let metronome = true;
  // 반주 만들기가 표시한 '후렴 앞 마디' (이 마디 끝에 라이저가 끝나도록 자동으로 울림)
  let lifts = [];
  let autoRiser = true;

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
    const vol = knob({
      label: '볼륨', ariaLabel: `${track.name} 볼륨`, min: 0, max: 1, value: track.volume, size: 'sm', tone: track.color === 'signal' ? 'signal' : 'brass',
      format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { track.volume = v; applySound(track); }, onChange: (v) => { track.volume = v; applySound(track); },
      defaultValue: () => 0.8,
    });
    const roll = h('canvas', { class: 'roll', 'aria-label': `${track.name} 음표` });
    const undo = h('button', { type: 'button', class: 'quiet small' }, '실행 취소');
    const clear = h('button', { type: 'button', class: 'quiet small' }, '지우기');
    const take = h('button', { type: 'button', class: 'quiet small', title: '지금 고른 음색(실험실·예배 무대)으로 바꿈' }, '지금 음색으로');
    arm.addEventListener('click', () => {
      if (rec.active && rec.track !== i) stopRecording();
      rec.track = i;
      render();
    });
    mute.addEventListener('click', () => { track.muted = !track.muted; if (track.muted) track.inst?.allOff(undefined, true); render(); });
    solo.addEventListener('click', () => { track.solo = !track.solo; render(); });
    undo.addEventListener('click', () => { if (L.undo(i)) { track.inst?.allOff(undefined, true); render(); } });
    clear.addEventListener('click', () => { L.clear(i); track.example = false; track.inst?.allOff(undefined, true); render(); });
    take.addEventListener('click', () => { setSound(track); render(); app.notice(`${track.name} 음색을 지금 음색 '${track.sound.label}'에 맞췄어요.`); });
    const el = h('div', { class: `track track-${track.color}` },
      h('div', { class: 'track-head' },
        arm,
        h('div', { class: 'track-title' }, h('strong', {}, track.name), sound),
        h('div', { class: 'track-btns' }, mute, solo)),
      roll,
      h('div', { class: 'track-foot' }, vol.el, take, undo, clear));
    return { el, arm, sound, mute, solo, roll, undo, clear, track };
  });

  // ---- 반주 만들기: 코드 진행 → 보이싱 → 트랙 ----
  const chartId = nextId('chart');
  const chartIn = h('input', { type: 'text', id: chartId, class: 'text-input chart-input', value: '| C | G/B | Am7 | Fadd9 |', spellcheck: 'false', autocomplete: 'off' });
  const widthRow = h('div', { class: 'bar-widths', role: 'group', 'aria-label': '마디마다 좁게·넓게' });
  const chartNote = h('p', { class: 'panel-hint', 'aria-live': 'polite' });
  let widths = [];
  const styleSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '반주 스타일' });
  let style = 'pad';
  const SOUND_FOR = { pad: 'worship-pad', pulse: 'tremolo-rhodes', arp: 'arp-pluck', organ: 'gospel-organ' };
  const soundSel = h('select', { 'aria-label': '반주 음색' }, ...FACTORY.filter((f) => !f.patch.layers.length).map((f) => h('option', { value: f.id }, f.patch.name)));
  soundSel.value = SOUND_FOR[style];
  const arrTrack = h('select', { 'aria-label': '넣을 트랙' }, ...L.tracks.map((tr, i) => h('option', { value: i, selected: i === 1 || null }, tr.name)));
  const riserBtn = h('button', { type: 'button', class: 'toggle small', 'aria-pressed': 'true', title: '좁게 → 넓게 로 바뀌는 마디 앞에서 라이저가 끝나도록' }, '후렴 앞 라이저');
  riserBtn.addEventListener('click', () => { autoRiser = !autoRiser; riserBtn.setAttribute('aria-pressed', String(autoRiser)); });
  function renderArranger() {
    const { bars, bad } = parseChart(chartIn.value);
    // 마디 수가 바뀌면 앞 절반은 좁게(절), 뒤 절반은 넓게(후렴)로 다시 시작
    if (widths.length !== bars.length) widths = bars.map((_, i) => (bars.length > 2 && i >= Math.ceil(bars.length / 2) ? 'wide' : 'narrow'));
    widthRow.replaceChildren(...bars.map((chords, i) => {
      const b = h('button', { type: 'button', class: 'bar-width', 'aria-pressed': String(widths[i] === 'wide'), title: '눌러서 좁게 ↔ 넓게' },
        h('span', { class: 'bar-no' }, String(i + 1)), h('strong', {}, chords.map((c) => c.name).join(' ')), h('span', {}, widths[i] === 'wide' ? '넓게' : '좁게'));
      b.addEventListener('click', () => { widths[i] = widths[i] === 'wide' ? 'narrow' : 'wide'; renderArranger(); });
      return b;
    }));
    chartNote.textContent = bad.length
      ? `읽지 못한 코드: ${bad.join(', ')} — 예: C, Am7, G/B, Fadd9, Dsus4, Bb2`
      : bars.length > 8 ? '루퍼는 8마디까지예요. 앞 8마디만 넣어요.' : `${bars.length}마디 · 마디를 눌러 좁게(절)·넓게(후렴)를 바꿔요`;
    styleSeg.replaceChildren(...STYLES.map((x) => {
      const b = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(x.id === style), title: x.hint }, x.label);
      b.addEventListener('click', () => { style = x.id; soundSel.value = SOUND_FOR[style]; renderArranger(); });
      return b;
    }));
    return { bars };
  }
  chartIn.addEventListener('input', renderArranger);
  function putArrangement() {
    const parsed = renderArranger();
    const bars = parsed.bars.slice(0, 8);
    if (!bars.length) {
      app.notice('코드를 하나도 읽지 못했어요. 예: | C | G/B | Am7 | Fadd9 |', 'bad');
      return;
    }
    if (t.playing) stop();
    const loopBars = [1, 2, 4, 8].find((n) => n >= bars.length);
    barsSel.value = String(loopBars);
    clock = loopClock({ bpm: clock.bpm, meter: clock.meter, bars: loopBars });
    L.fitTo(clock.beats);
    const i = Number(arrTrack.value);
    const track = L.tracks[i];
    const w = widths.slice(0, bars.length);
    track.notes = arrange(bars, { style, beatsPerBar: clock.beatsPerBar, widths: w });
    const { patch } = factoryById(soundSel.value);
    track.sound = { patch, sample: null, label: patch.name };
    track.example = false;
    lifts = liftPoints(w);
    applySound(track);
    render();
    app.notice(`${track.name}에 ${bars.length}마디 반주(${STYLES.find((x) => x.id === style).label}, ${patch.name})를 넣었어요.${lifts.length && autoRiser ? ' 후렴 앞에서 라이저가 울려요.' : ''}`, 'good');
  }
  const arranger = h('details', { class: 'arranger' },
    h('summary', {}, '반주 만들기 — 코드 진행으로 트랙 채우기'),
    h('div', { class: 'arranger-body' },
      h('label', { for: chartId, class: 'label' }, '코드 진행 (마디는 | 로, 한 마디 두 코드는 띄어쓰기, % = 앞과 같음)'), chartIn,
      widthRow, chartNote,
      h('div', { class: 'btn-row' }, styleSeg),
      h('div', { class: 'btn-row' }, soundSel, arrTrack, riserBtn,
        h('button', { type: 'button', class: 'primary', onclick: putArrangement }, '트랙에 넣기'))));
  renderArranger();

  root.append(
    panel('루퍼', {
      cls: 'span-wide looper-panel',
      hint: '녹음할 트랙(●)을 고르고 녹음을 누르면 한 마디를 세고 시작해요. 녹음을 켜 둔 채로 돌면 한 바퀴마다 겹쳐 쌓이고, 실행 취소는 마지막 바퀴만 지웁니다.',
    }, transport, h('div', { class: 'tracks' }, ...rows.map((r) => r.el)), arranger));

  // ---- 소리 ----
  function setSound(track) {
    track.sound = { patch: app.patch, sample: app.patch.source === 'sample' ? app.engineSample : null, label: app.patch.name };
    applySound(track);
  }
  function applySound(track) {
    if (!track.sound) return;
    // 트랙 볼륨은 겹친 음색에도 같이
    const sp = track.sound.patch;
    const p = { ...sp, volume: sp.volume * track.volume, layers: sp.layers.map((l) => ({ ...l, level: l.level * track.volume })) };
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
    if (until > 0 && autoRiser && lifts.length && app.stage?.playFxAt) {
      const riserBeats = 2 * clock.beatsPerBar;
      const marks = lifts.map((b) => ({ t: (((b + 1) * clock.beatsPerBar - riserBeats) % clock.beats + clock.beats) % clock.beats, iter: -1 }));
      for (const ev of eventsInWindow(marks, clock.beats, Math.max(0, from), until)) app.stage.playFxAt('riser', t.t0 + ev.at * bs);
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
  bpm.addEventListener('change', () => {
    const v = Math.min(200, Math.max(40, Math.round(Number(bpm.value) || clock.bpm)));
    const before = t.playing ? beatNow() : 0;
    clock = loopClock({ bpm: v, meter: clock.meter, bars: clock.bars });
    if (t.playing) t.t0 = app.studio.ctx.currentTime - before * clock.beatSec;
    app.setTempo(v);
    render();
  });
  const reshape = () => {
    if (t.playing) stop();
    lifts = [];
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
  app.on('tempo', () => L.tracks.forEach((tr) => tr.inst?.syncTempo()));
  render();
  // 예배 무대의 루퍼 줄과 실험실의 '루퍼로 보내기'가 쓰는 손잡이
  return {
    state: L,
    stop,
    play: () => play(),
    toggleRecord: () => (rec.active ? stopRecording() : startRecording()),
    sendSound(i) {
      setSound(L.tracks[i]);
      L.tracks[i].example = false;
      render();
    },
    info() {
      const b = t.playing && app.studio.ctx ? beatNow() : null;
      return { playing: t.playing, recording: rec.active, counting: rec.counting, beat: b, inLoop: b == null || b < 0 ? null : b % clock.beats, clock, armed: rec.track, tracks: L.tracks, t0: t.t0, lifts };
    },
  };
}
