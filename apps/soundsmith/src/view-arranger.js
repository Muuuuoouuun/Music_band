// 반주 만들기 (시안 H5): 곡 줄(곡·조·BPM·박자, 음색, 섹션 스타일) → 섹션마다 마디 칸 → 펼친 보이싱 미리 보기 →
// 보이싱 이유 → 넣기(미리 듣기·루퍼 트랙·베이스 따로·라이저·다른 보이싱·band2sheet 불러오기).
// 코드는 들리는 음 그대로 적는다 (조옮김 +2 인 D 곡이면 D). 루퍼에 넣을 때 조옮김만큼 내려 적어서, 연주할 때 다시 올라간다.
import { h, nextId } from './ui.js';
import { fit, color } from './draw.js';
import { Instrument } from './engine.js';
import { FACTORY, factoryById } from './presets.js';
import { TRANSITIONS } from './fxgen.js';
import { parseChord, arrange, liftPoints, STYLES, transposeName, voicingReason, parseChordPro, sectionKind, keyRef, noteText, pcName } from './arrange.js';

const MAX_BARS = 8;
const KINDS = {
  verse: { label: '절', tone: 'signal', width: 'narrow', style: 'pad' },
  chorus: { label: '후렴', tone: 'brass', width: 'wide', style: 'pulse' },
  bridge: { label: '브릿지', tone: 'sky', width: 'wide', style: 'arp' },
  other: { label: '구간', tone: 'good', width: 'narrow', style: 'pad' },
};
// C 장조로 적어 둔 기본 진행. 곡 조로 옮겨서 채운다.
const BASE = { verse: ['C', 'G/B', 'Am7', 'Fadd9'], chorus: ['F', 'C/E', 'Dm7', 'Gsus4 G'], bridge: ['Am7', 'Fmaj7', 'C/G', 'G'], other: ['C', 'F'] };
const WIDTH_TEXT = { narrow: '좁게: 한 옥타브 반 안', wide: '넓게: 두 옥타브 넓게 + 위 음 하나 더' };
const SOUND_FOR = { pad: 'worship-pad', pulse: 'tremolo-rhodes', arp: 'arp-pluck', organ: 'gospel-organ' };
const BASS_SOUND = 'sub-bass';
const pcOf = (m) => ((m % 12) + 12) % 12;
// 코드 없음(N.C.)은 쉬는 자리: 마디 안 자리는 차지하지만 소리는 내지 않는다
const isRest = (w) => /^(N\.?C\.?|x)$/i.test(w);
const REST = { name: 'N.C.', rest: true };
const moveCell = (cell, semis, key) => cell.split(/\s+/).filter(Boolean).map((w) => (w === '%' || isRest(w) ? w : transposeName(w, semis, key))).join(' ');

/** api: { tracks, clock(), load({ parts, bars, lifts, autoRiser }), setClock({ bpm, meter }), setAutoRiser(on), stop(), playing() } */
export function ArrangerPanel(app, api) {
  let sections = [];
  let sel = 0;
  let edited = false;
  let chartKey = 0; // 지금 칸에 적힌 코드의 조
  let imported = null; // band2sheet 에서 불러온 곡 { title, key, keyPc }
  let variant = 0;
  let target = 1;
  let bassSplit = true;
  let autoRiser = true;
  let soundId = SOUND_FOR.pad;
  let soundPicked = false;
  let built = null;
  let uid = 0;

  const songKey = () => (imported?.keyPc ?? pcOf(app.tuning.transpose));
  const makeSection = (kind, bars = 4, name = KINDS[kind].label, key = songKey()) => ({
    id: `sec${++uid}`, kind, name, width: KINDS[kind].width, style: KINDS[kind].style,
    chords: Array.from({ length: bars }, (_, i) => moveCell(BASE[kind][i % BASE[kind].length], key, key)),
  });
  function defaults() {
    sections = [makeSection('verse'), makeSection('chorus')];
    sel = 0;
    chartKey = songKey();
    edited = false;
  }
  const totalBars = () => sections.reduce((n, s) => n + s.chords.length, 0);

  // ---- 곡 줄 ----
  const songName = h('strong', { class: 'arr-song-name' });
  const songMeta = h('span', { class: 'arr-song-meta' });
  const moveKeyBtn = h('button', { type: 'button', class: 'chip-btn arr-move-key', hidden: true });
  const soundSel = h('select', { 'aria-label': '반주 음색', class: 'arr-sound' },
    ...FACTORY.map((f) => h('option', { value: f.id }, f.patch.name)));
  const styleLabel = h('span', { class: 'arr-label' });
  const styleChips = h('div', { class: 'arr-styles', role: 'group', 'aria-label': '고른 섹션의 반주 스타일' });
  function moveToSongKey() {
    const k = songKey();
    const d = pcOf(k - chartKey);
    for (const s of sections) s.chords = s.chords.map((c) => moveCell(c, d, k));
    chartKey = k;
    renderSections();
  }
  moveKeyBtn.addEventListener('click', moveToSongKey);
  soundSel.addEventListener('change', () => { soundId = soundSel.value; soundPicked = true; });
  const songBar = h('div', { class: 'arr-song' },
    h('div', { class: 'arr-song-left' }, h('span', { class: 'arr-label' }, '곡'), songName, songMeta, moveKeyBtn),
    h('div', { class: 'arr-song-right' },
      h('label', { class: 'arr-sound-field' }, h('span', { class: 'arr-label' }, '음색'), soundSel),
      styleLabel, styleChips));

  // ---- 섹션 · 마디 칸 ----
  const rowsEl = h('div', { class: 'arr-sections' });
  const addRow = h('div', { class: 'arr-add' });
  const badNote = h('p', { class: 'arr-bad', 'aria-live': 'polite' });
  const cells = []; // [{ input, section, bar }]

  function renderSections() {
    cells.length = 0;
    sel = Math.min(sel, sections.length - 1);
    const full = totalBars() >= MAX_BARS;
    rowsEl.replaceChildren(...sections.map((s, si) => {
      const kind = KINDS[s.kind];
      const inputs = s.chords.map((c, bi) => {
        const input = h('input', {
          type: 'text', class: 'text-input bar-cell', value: c, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
          'aria-label': `${s.name} ${bi + 1}마디 코드`, placeholder: bi ? '%' : 'C',
        });
        input.addEventListener('input', () => { s.chords[bi] = input.value; edited = true; update(); });
        cells.push({ input, s, bi });
        return input;
      });
      const widthSeg = h('div', { class: 'seg arr-width', role: 'group', 'aria-label': `${s.name} 보이싱 폭` },
        ...['narrow', 'wide'].map((w) => {
          const b = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(s.width === w) }, w === 'wide' ? '넓게' : '좁게');
          b.addEventListener('click', () => { s.width = w; renderSections(); });
          return b;
        }));
      const minus = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `${s.name} 마디 줄이기`, disabled: s.chords.length <= 1 || null }, '−');
      const plus = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `${s.name} 마디 늘리기`, disabled: full || null }, '+');
      minus.addEventListener('click', () => { s.chords.pop(); renderSections(); });
      plus.addEventListener('click', () => { s.chords.push(s.chords.at(-1) ?? ''); renderSections(); });
      const remove = sections.length > 1
        ? h('button', { type: 'button', class: 'quiet small arr-remove', 'aria-label': `${s.name} 빼기`, onclick: () => { sections.splice(si, 1); renderSections(); } }, '빼기')
        : null;
      const caption = h('span', { class: 'arr-caption', dataset: { sec: s.id } });
      const row = h('div', { class: `arr-row tone-${kind.tone}${si === sel ? ' is-selected' : ''}`, dataset: { sec: s.id } },
        h('div', { class: 'arr-row-head' },
          h('strong', {}, s.name),
          h('span', { class: 'arr-bars' }, minus, h('span', {}, `${s.chords.length}마디`), plus),
          remove),
        h('div', { class: 'arr-cells', style: `--n:${Math.max(4, s.chords.length)};--m:${Math.min(4, s.chords.length)}` }, ...inputs),
        h('div', { class: 'arr-row-side' }, widthSeg, caption));
      row.addEventListener('focusin', () => select(si));
      row.addEventListener('pointerdown', () => select(si));
      return row;
    }));
    const missing = ['verse', 'chorus', 'bridge'].find((k) => !sections.some((s) => s.kind === k));
    if (!missing) addRow.replaceChildren();
    else {
      const room = MAX_BARS - totalBars();
      const b = h('button', { type: 'button', class: 'arr-add-btn', disabled: room <= 0 || null }, `+ ${KINDS[missing].label}`);
      b.addEventListener('click', () => {
        const order = ['verse', 'chorus', 'bridge'];
        const s = makeSection(missing, Math.min(missing === 'bridge' ? 2 : 4, MAX_BARS - totalBars()), KINDS[missing].label, chartKey);
        const at = sections.findIndex((x) => order.indexOf(x.kind) > order.indexOf(missing));
        sections.splice(at < 0 ? sections.length : at, 0, s);
        sel = sections.indexOf(s);
        renderSections();
      });
      addRow.replaceChildren(b, h('span', { class: 'arr-add-hint' }, room <= 0
        ? `${MAX_BARS}마디가 다 찼어요. 절이나 후렴의 마디를 줄이면 ${KINDS[missing].label}를 더할 수 있어요.`
        : "섹션을 더하고 마디마다 코드를 적어요. 'G/B' 처럼 베이스 음, 'add9 · sus4 · m7' 다 읽어요. 한 마디 두 코드는 띄어서, % 는 앞과 같음."));
    }
    renderSongBar();
    update();
  }
  function select(i) {
    if (sel === i) return;
    sel = i;
    rowsEl.querySelectorAll('.arr-row').forEach((r, k) => r.classList.toggle('is-selected', k === i));
    renderSongBar();
  }

  function renderSongBar() {
    const ck = api.clock();
    const k = songKey();
    const stageSong = app.stage?.currentSong?.();
    songName.textContent = imported?.title || stageSong?.name || '지금 곡';
    songMeta.textContent = `${imported?.key || pcName(k, k)} · ${ck.bpm} BPM · ${ck.meter}`;
    const d = pcOf(k - chartKey);
    moveKeyBtn.hidden = !edited || d === 0;
    moveKeyBtn.textContent = `코드를 ${pcName(chartKey, chartKey)} → ${pcName(k, k)} 로 옮기기`;
    if (!soundPicked) soundId = SOUND_FOR[sections[0]?.style ?? 'pad'];
    soundSel.value = soundId;
    const s = sections[sel];
    styleLabel.textContent = s ? `스타일 · ${s.name}` : '스타일';
    styleChips.replaceChildren(...STYLES.map((x) => {
      const b = h('button', { type: 'button', class: `chip-btn arr-style${s ? ` tone-${KINDS[s.kind].tone}` : ''}`, 'aria-pressed': String(s?.style === x.id), title: x.hint }, x.label);
      b.addEventListener('click', () => {
        if (!s) return;
        s.style = x.id;
        if (!soundPicked && sel === 0) soundId = SOUND_FOR[x.id];
        renderSongBar();
        update();
      });
      return b;
    }));
  }

  // ---- 진행 → 음표 ----
  function build() {
    const bpb = api.clock().beatsPerBar;
    const bars = [];
    const widths = [];
    const styles = [];
    const barSec = [];
    const marks = [];
    const bad = [];
    const badCells = new Set();
    for (const s of sections) {
      s.chords.forEach((cell, bi) => {
        const chords = [];
        for (const word of cell.split(/\s+/).filter(Boolean)) {
          if (word === '%') chords.push(...(chords.length ? [chords.at(-1)] : bars.at(-1) ?? []));
          else if (isRest(word)) chords.push(REST);
          else {
            const c = parseChord(word);
            if (c) chords.push(c);
            else { bad.push(word); badCells.add(`${s.id}:${bi}`); }
          }
        }
        // 빈 칸은 앞 마디를 그대로 이어서
        const bar = chords.length ? chords : bars.at(-1) ?? [];
        const b = bars.length;
        bar.forEach((c, k) => marks.push({ beat: b * bpb + (k * bpb) / bar.length, name: c.name }));
        bars.push(bar);
        widths.push(s.width);
        styles.push(s.style);
        barSec.push(s);
      });
    }
    // 6/8 은 8분음표가 한 박이라 8분 펄스·아르페지오도 한 박씩
    const notes = arrange(bars, { beatsPerBar: bpb, widths, styles, variant, eighth: api.clock().meter === '6/8' ? 1 : 0.5 });
    return { bars, widths, styles, barSec, marks, notes, voicings: notes.voicings, lifts: liftPoints(widths), bad, badCells, bpb, beats: Math.max(1, bars.length) * bpb };
  }

  function update() {
    built = build();
    for (const { input, s, bi } of cells) input.setAttribute('aria-invalid', String(built.badCells.has(`${s.id}:${bi}`)));
    badNote.textContent = built.bad.length ? `읽지 못한 코드: ${[...new Set(built.bad)].join(', ')} — 예: C, Am7, G/B, Fadd9, Dsus4, Bb2` : '';
    badNote.hidden = !built.bad.length;
    let start = 0;
    for (const s of sections) {
      const cap = rowsEl.querySelector(`.arr-caption[data-sec="${s.id}"]`);
      const lifted = built.lifts.includes(start - 1);
      if (cap) cap.textContent = [STYLES.find((x) => x.id === s.style)?.label, bassSplit ? '왼손 베이스 따로' : '베이스 같이', lifted && autoRiser ? '라이저 앞에 자동' : null].filter(Boolean).join(' · ');
      start += s.chords.length;
    }
    renderLegend();
    renderReasons();
    renderInsert();
    drawPreview();
  }

  // ---- 미리 보기 ----
  const canvas = h('canvas', { class: 'arr-roll', role: 'img', 'aria-label': '펼친 보이싱 미리 보기: 섹션 색으로 칠한 음표, 위에 코드 이름, 아래 효과 자리' });
  const legend = h('div', { class: 'arr-legend' });
  function renderLegend() {
    const seen = new Set();
    legend.replaceChildren(...sections.filter((s) => !seen.has(`${s.name}|${s.width}`) && seen.add(`${s.name}|${s.width}`))
      .map((s) => h('span', { class: `arr-chip tone-${KINDS[s.kind].tone}` }, `${s.name} = ${WIDTH_TEXT[s.width]}`)),
    bassSplit ? h('span', { class: 'arr-chip tone-rose' }, `베이스 → 트랙 ${bassTrack() + 1}`) : null);
  }
  function drawPreview(playBeat = null) {
    if (!built || !canvas.isConnected) return;
    const { g, w, h: H } = fit(canvas);
    const { notes, marks, barSec, lifts, bpb, beats } = built;
    const left = 34;
    const right = 6;
    const top = 20;
    const lane = 54;
    const bottom = H - lane;
    const pw = w - left - right;
    const xOf = (b) => left + (b / beats) * pw;
    g.font = `10px ${color('font-data')}`;
    if (!notes.length) {
      g.fillStyle = color('faint');
      g.font = `12px ${color('font-body')}`;
      g.fillText('코드를 적으면 여기 펼친 보이싱이 보여요', left + 8, H / 2);
      return;
    }
    const lo = Math.min(...notes.map((n) => n.midi)) - 2;
    const hi = Math.max(...notes.map((n) => n.midi)) + 2;
    const rh = (bottom - top) / (hi - lo + 1);
    const yOf = (m) => top + (hi - m) * rh;
    for (let m = lo; m <= hi; m++) {
      if ([1, 3, 6, 8, 10].includes(pcOf(m))) {
        g.fillStyle = 'rgba(0, 0, 0, 0.22)';
        g.fillRect(left, yOf(m), pw, rh);
      }
    }
    const key = songKey();
    g.fillStyle = color('faint');
    g.strokeStyle = color('grid');
    for (let m = lo; m <= hi; m++) {
      if (pcOf(m) !== key) continue;
      const y = Math.round(yOf(m) + rh) + 0.5;
      g.beginPath(); g.moveTo(left, y); g.lineTo(w - right, y); g.stroke();
      g.fillText(noteText(m, key), 4, y - 2);
    }
    for (let b = 0; b <= beats; b++) {
      const x = Math.round(xOf(b)) + 0.5;
      g.strokeStyle = color(b % bpb === 0 ? 'line-strong' : 'grid');
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, top - 4); g.lineTo(x, bottom); g.stroke();
    }
    const tone = (s) => KINDS[s.kind].tone;
    // 섹션이 바뀌는 자리는 다음 섹션 색으로 굵게
    barSec.forEach((s, b) => {
      if (!b || barSec[b - 1] === s) return;
      g.strokeStyle = color(tone(s));
      g.lineWidth = 2;
      const x = Math.round(xOf(b * bpb));
      g.beginPath(); g.moveTo(x, top - 4); g.lineTo(x, H - 4); g.stroke();
    });
    g.lineWidth = 1;
    g.fillStyle = color('muted');
    for (const mk of marks) g.fillText(mk.name, xOf(mk.beat) + 4, 12, Math.max(16, (bpb / 2 / beats) * pw * 2 - 6));
    for (const n of notes) {
      const s = barSec[Math.min(barSec.length - 1, Math.floor(n.t / bpb))];
      g.fillStyle = color(bassSplit && n.part === 'left' ? 'rose' : tone(s));
      g.globalAlpha = 0.45 + 0.55 * n.velocity;
      const x = xOf(n.t) + 1;
      const ww = Math.max(2, (n.dur / beats) * pw - 2);
      const hh = Math.max(2, Math.min(rh - 1, 6));
      g.beginPath();
      g.roundRect(x, yOf(n.midi) + (rh - hh) / 2, ww, hh, Math.min(2, hh / 2));
      g.fill();
    }
    g.globalAlpha = 1;
    // 효과 자리: 섹션 이름 · 폭 · 스타일, 라이저 경사
    const laneTop = bottom + 6;
    g.strokeStyle = color('line');
    g.beginPath(); g.moveTo(left, bottom + 0.5); g.lineTo(w - right, bottom + 0.5); g.stroke();
    g.fillStyle = color('faint');
    g.fillText('효과', 4, laneTop + 12);
    barSec.forEach((s, b) => {
      if (b && barSec[b - 1] === s) return;
      const end = barSec.findIndex((x, k) => k > b && x !== s);
      const span = ((end < 0 ? barSec.length : end) - b) * bpb;
      g.fillStyle = color(tone(s));
      g.font = `11px ${color('font-body')}`;
      g.fillText(`${s.name} · ${s.width === 'wide' ? '넓게' : '좁게'} · ${STYLES.find((x) => x.id === s.style)?.label ?? ''}`, xOf(b * bpb) + 6, laneTop + 12, Math.max(20, (span / beats) * pw - 10));
    });
    if (autoRiser) {
      const riserBeats = TRANSITIONS.find((x) => x.id === 'riser').beats;
      for (const lift of lifts) {
        const end = (lift + 1) * bpb;
        const start = Math.max(0, end - riserBeats);
        const x0 = xOf(start);
        const x1 = xOf(end);
        g.fillStyle = color('brass-wash');
        g.strokeStyle = color('brass');
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x0, H - 5); g.lineTo(x1, H - 5); g.lineTo(x1, laneTop + 17); g.closePath();
        g.fill(); g.stroke();
        g.lineWidth = 1;
        g.fillStyle = color('brass-hi');
        g.font = `11px ${color('font-body')}`;
        const label = '라이저 · 후렴 첫 박에 끝 →';
        const tw = g.measureText(label).width;
        g.fillText(label, x0 - tw - 6 > left ? x0 - tw - 6 : x0 + 4, H - 8);
      }
    }
    if (playBeat != null) {
      const x = xOf(playBeat);
      g.strokeStyle = color('fg');
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, top - 4); g.lineTo(x, H - 4); g.stroke();
      g.lineWidth = 1;
    }
  }

  // ---- 보이싱 이유 ----
  const reasonList = h('dl', { class: 'arr-reasons' });
  const reasonFoot = h('p', { class: 'arr-reason-foot' });
  function renderReasons() {
    const vs = built.voicings;
    const items = [];
    const seen = new Set();
    vs.forEach((v, i) => {
      if (seen.has(v.chord.name)) return;
      seen.add(v.chord.name);
      const next = vs[i + 1];
      const key = songKey();
      const r = voicingReason(v, key);
      const sus = v.chord.tones.includes(5) && !v.chord.tones.includes(4);
      // Asus4 A 처럼 한 마디 안에서 4 → 3 으로 풀면 둘을 함께 설명
      if (sus && next && next.bar === v.bar && next.chord.root === v.chord.root && next.chord.tones.includes(4)) {
        seen.add(next.chord.name);
        items.push({ rank: 0, wide: built.widths[v.bar] === 'wide', name: `${v.chord.name} ${next.chord.name}`, notes: '', why: '한 마디 안에서 4 → 3 으로 풀기 — 끝맺는 긴장감' });
        return;
      }
      const plain = r.why.startsWith('앞 코드와');
      items.push({ rank: plain ? 2 : 1, wide: built.widths[v.bar] === 'wide', ...r });
    });
    const pick = items.map((x, i) => ({ ...x, i })).sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i);
    reasonList.replaceChildren(...pick.flatMap((x) => [
      h('dt', { class: x.wide ? 'is-wide' : '' }, x.name),
      h('dd', {}, x.notes ? h('span', { class: 'arr-notes' }, x.notes) : null, x.notes ? ' — ' : null, x.why),
    ]));
    if (!pick.length) reasonList.append(h('dd', { class: 'arr-empty' }, '코드를 적으면 왜 이렇게 쳤는지 여기에 적어요.'));
    reasonFoot.textContent = `목소리 이끌기: 다음 코드로 갈 때 가장 가까운 음으로 움직여 손 모양이 크게 바뀌지 않아요.${variant ? ` (다른 보이싱 ${variant + 1}번째 자리)` : ''}`;
  }

  // ---- 넣기 ----
  const bassTrack = () => (target === 3 ? 2 : target + 1);
  const previewBtn = h('button', { type: 'button', class: 'arr-wide-btn arr-preview', 'aria-pressed': 'false' });
  const trackSeg = h('div', { class: 'seg arr-track-seg', role: 'group', 'aria-label': '넣을 루퍼 트랙' });
  const putBtn = h('button', { type: 'button', class: 'primary arr-put' });
  const bassBtn = h('button', { type: 'button', class: 'chip-btn arr-bass tone-rose', 'aria-pressed': 'true' });
  const riserBtn = h('button', { type: 'button', class: 'chip-btn arr-riser tone-brass', 'aria-pressed': 'true', title: '좁게 → 넓게 로 바뀌는 마디 앞에서 라이저가 끝나도록' }, '라이저 자동');
  const againBtn = h('button', { type: 'button', class: 'arr-wide-btn arr-again' }, '다른 보이싱으로 다시');
  const fileId = nextId('cho');
  const fileIn = h('input', { type: 'file', id: fileId, accept: '.cho,.chopro,.chordpro,.pro,.txt,text/plain', class: 'visually-hidden' });
  const importBtn = h('label', { for: fileId, class: 'arr-wide-btn arr-import', role: 'button', tabindex: '0' }, 'band2sheet 코드 진행 불러오기');
  importBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  function renderInsert() {
    previewBtn.textContent = pv.on ? '■ 멈추기' : `▶ 미리 듣기 · ${built.bars.length}마디`;
    previewBtn.setAttribute('aria-pressed', String(pv.on));
    trackSeg.replaceChildren(h('span', { class: 'arr-label' }, '넣을 트랙'), ...api.tracks.map((tr, i) => {
      const b = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(i === target), 'aria-label': tr.name }, String(i + 1));
      b.addEventListener('click', () => { target = i; update(); });
      return b;
    }));
    putBtn.textContent = `루퍼 트랙 ${target + 1}에 넣기`;
    putBtn.disabled = !built.notes.length;
    bassBtn.textContent = `베이스 음은 트랙 ${bassTrack() + 1}에 따로`;
    bassBtn.setAttribute('aria-pressed', String(bassSplit));
    riserBtn.setAttribute('aria-pressed', String(autoRiser));
  }
  bassBtn.addEventListener('click', () => { bassSplit = !bassSplit; update(); });
  riserBtn.addEventListener('click', () => { autoRiser = !autoRiser; api.setAutoRiser(autoRiser); update(); });
  againBtn.addEventListener('click', () => {
    variant += 1;
    update();
    app.notice(`다른 자리의 보이싱으로 다시 펼쳤어요 (${variant + 1}번째).`);
  });

  const soundPatch = () => (factoryById(soundId) ?? factoryById(SOUND_FOR.pad)).patch;
  const bassPatch = () => factoryById(BASS_SOUND).patch;
  // 연주할 때 조옮김만큼 다시 올라가므로 적어 둘 때는 내린다
  const toTrack = (notes) => notes.map(({ part, ...n }) => ({ ...n, midi: n.midi - app.tuning.transpose }));

  function put() {
    stopPreview();
    if (built.bad.length && !built.notes.length) {
      app.notice('코드를 하나도 읽지 못했어요. 예: C, G/B, Am7, Fadd9', 'bad');
      return;
    }
    const { notes, bars, lifts } = built;
    const parts = bassSplit
      ? [{ track: target, notes: toTrack(notes.filter((n) => n.part !== 'left')), patch: soundPatch() },
        { track: bassTrack(), notes: toTrack(notes.filter((n) => n.part === 'left')), patch: bassPatch() }]
      : [{ track: target, notes: toTrack(notes), patch: soundPatch() }];
    api.load({ parts, bars: bars.length, lifts, autoRiser });
    const names = sections.map((s) => s.name).join('·');
    app.notice(`트랙 ${target + 1}에 ${bars.length}마디 반주(${names}, ${soundPatch().name})를 넣었어요.${bassSplit ? ` 베이스는 트랙 ${bassTrack() + 1}.` : ''}${lifts.length && autoRiser ? ' 후렴 앞에서 라이저가 울려요.' : ''}`, 'good');
  }
  putBtn.addEventListener('click', put);

  // 미리 듣기: 루퍼와 같은 BPM 으로 한 번 쭉
  const pv = { on: false, timer: null, t0: 0, i: 0, events: [], insts: [], fx: [], beatSec: 0.8, beats: 0 };
  async function startPreview() {
    if (!built.notes.length) return;
    const ctx = await app.ensureAudio();
    if (api.playing()) api.stop();
    stopPreview();
    const main = new Instrument(app.studio.env(), soundPatch(), null);
    const bass = bassSplit ? new Instrument(app.studio.env(), bassPatch(), null) : null;
    pv.insts = [main, bass].filter(Boolean);
    pv.events = built.notes.map((n) => ({ n, inst: bass && n.part === 'left' ? bass : main })).sort((a, b) => a.n.t - b.n.t);
    pv.beatSec = api.clock().beatSec;
    pv.beats = built.beats;
    pv.t0 = ctx.currentTime + 0.12;
    pv.i = 0;
    pv.on = true;
    if (autoRiser && app.stage?.playFxAt) {
      const riserBeats = TRANSITIONS.find((x) => x.id === 'riser').beats;
      pv.fx = built.lifts.map((lift) => app.stage.playFxAt('riser', pv.t0 + ((lift + 1) * built.bpb - riserBeats) * pv.beatSec));
    }
    pv.timer = setInterval(tickPreview, 25);
    tickPreview();
    renderInsert();
  }
  function tickPreview() {
    const now = app.studio.ctx.currentTime;
    const shift = app.tuning.transpose;
    while (pv.i < pv.events.length && pv.t0 + pv.events[pv.i].n.t * pv.beatSec < now + 0.15) {
      const { n, inst } = pv.events[pv.i++];
      const at = Math.max(now, pv.t0 + n.t * pv.beatSec);
      inst.noteOn(n.midi - shift, n.velocity, at);
      inst.noteOff(n.midi - shift, at + Math.max(0.03, n.dur * pv.beatSec - 0.01));
    }
    if (now > pv.t0 + pv.beats * pv.beatSec + 0.1) stopPreview(false);
  }
  function stopPreview(hard = true) {
    if (!pv.on) return;
    clearInterval(pv.timer);
    pv.on = false;
    const insts = pv.insts;
    pv.insts = [];
    // 멈추면 아직 울릴 라이저도 거둔다
    for (const job of pv.fx) job.then((cancel) => cancel?.());
    pv.fx = [];
    for (const inst of insts) inst.allOff(undefined, hard);
    setTimeout(() => insts.forEach((x) => x.dispose()), hard ? 300 : 4000);
    if (built) { renderInsert(); drawPreview(); }
  }
  previewBtn.addEventListener('click', () => (pv.on ? stopPreview() : startPreview()));

  // band2sheet ChordPro 불러오기
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    loadChordPro(await f.text(), f.name);
  });
  function loadChordPro(text, fileName = '') {
    const song = parseChordPro(text);
    if (!song.sections.length) {
      app.notice('코드 진행을 찾지 못했어요. band2sheet 에서 내보낸 ChordPro(.cho) 파일인지 확인해 주세요.', 'bad');
      return false;
    }
    const kindOf = sectionKind;
    // 종류마다 처음 나온 섹션만. 8마디를 후렴 → 절 → 브릿지 순으로 4마디씩 먼저 나누고, 남으면 앞에서부터 더 담는다
    let picked = [];
    for (const s of song.sections) if (picked.length < 4 && !picked.some((p) => p.kind === kindOf(s))) picked.push({ kind: kindOf(s), src: s });
    const take = picked.map(() => 0);
    let room = MAX_BARS;
    for (const k of ['chorus', 'verse', 'bridge', 'other']) {
      picked.forEach((p, i) => { if (p.kind === k) { take[i] = Math.min(p.src.bars.length, 4, room); room -= take[i]; } });
    }
    picked.forEach((p, i) => { const more = Math.min(room, p.src.bars.length - take[i]); take[i] += more; room -= more; });
    const dropped = picked.filter((_, i) => !take[i]).map((p) => p.src.name);
    picked = picked.map((p, i) => ({ ...p, take: take[i] })).filter((p) => p.take);
    const keyPc = keyRef(song.key) ?? keyRef(song.sections[0].bars[0]?.[0]) ?? 0;
    imported = { title: song.title || fileName.replace(/\.[^.]+$/, ''), key: song.key, keyPc };
    sections = picked.map((p) => {
      const name = p.src.name && p.src.name.length <= 8 ? p.src.name : KINDS[p.kind].label;
      const s = makeSection(p.kind, p.take, name);
      s.chords = p.src.bars.slice(0, p.take).map((b) => b.join(' '));
      return s;
    });
    sel = 0;
    chartKey = keyPc;
    edited = true;
    variant = 0;
    const meter = /^(3\/4|6\/8|4\/4)$/.test(song.time) ? song.time : null;
    if (song.tempo || meter) api.setClock({ bpm: song.tempo ? Math.round(song.tempo) : null, meter });
    renderSections();
    app.notice(`'${imported.title}' 코드 진행을 불러왔어요 (${sections.map((s) => `${s.name} ${s.chords.length}마디`).join(' · ')})${dropped.length ? ` · 8마디가 넘어서 ${dropped.join('·')}는 뺐어요` : ''}. 고칠 마디만 눌러 고치면 돼요.`, 'good');
    return true;
  }

  const el = h('section', { class: 'arranger', 'aria-label': '반주 만들기', hidden: true },
    h('header', { class: 'arr-head' },
      h('h3', {}, '반주 만들기'),
      h('p', { class: 'panel-hint' }, '코드만 적으면 예배 반주처럼 열린 보이싱으로 펼쳐서 루퍼 트랙에 넣어요.')),
    songBar,
    h('div', { class: 'arr-box arr-chart' },
      h('h4', {}, '코드 진행', h('span', {}, ' · 마디마다 한 칸')),
      rowsEl, addRow, badNote),
    h('div', { class: 'arr-box arr-preview-box' },
      h('h4', {}, '미리 보기', h('span', {}, ' · 펼친 보이싱과 효과 자리')),
      canvas, legend),
    h('div', { class: 'arr-lower' },
      h('div', { class: 'arr-box arr-why' }, h('h4', {}, '보이싱 이유'), reasonList, reasonFoot),
      h('div', { class: 'arr-box arr-insert' },
        h('h4', {}, '넣기'),
        previewBtn, trackSeg, putBtn,
        h('div', { class: 'arr-toggles' }, bassBtn, riserBtn),
        againBtn,
        h('hr'),
        importBtn, fileIn,
        h('p', { class: 'panel-hint' }, 'band2sheet 가 음원에서 뽑은 코드·마디를 그대로 채워요 (.cho). 고칠 마디만 눌러 고치면 돼요.'))));

  // 곡이나 조옮김이 바뀌면: 코드를 손대지 않았으면 새 조로 옮기고, 손댔으면 옮기기 단추만 띄운다
  const followSong = () => {
    if (!edited && songKey() !== chartKey) moveToSongKey();
    else renderSongBar();
  };
  app.on('tuning', () => { if (!imported) followSong(); });
  app.on('song', () => { imported = null; followSong(); });
  app.on('tempo', () => { if (!el.hidden) renderSongBar(); });
  app.on('panic', () => stopPreview());
  app.on('resize', () => drawPreview());
  app.onFrame(() => {
    if (!pv.on || el.hidden) return;
    drawPreview(Math.max(0, (app.studio.ctx.currentTime - pv.t0) / pv.beatSec));
  });

  defaults();
  renderSections();
  return {
    el,
    open(on = true) {
      el.hidden = !on;
      if (on) requestAnimationFrame(() => { renderSongBar(); update(); });
      else stopPreview();
    },
    get isOpen() { return !el.hidden; },
    refresh() { if (!el.hidden) { renderSongBar(); update(); } },
    stopPreview,
    loadChordPro,
    info: () => ({ sections: sections.map((s) => ({ name: s.name, kind: s.kind, width: s.width, style: s.style, chords: [...s.chords] })), variant, target, bassSplit, autoRiser, preview: pv.on, bars: built?.bars.length ?? 0 }),
  };
}
