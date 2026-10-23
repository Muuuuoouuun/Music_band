// 음원 따라 만들기 화면: 음원 파일·유튜브 링크·예시 소리를 불러와 구간을 고르고, 그 소리를 재서
// ① 닮은 음색 만들기(다시 합성/가장 닮은 음색 + 맞춤 EQ) ② 지금 음색에 톤만 입히기 ③ 구간을 샘플로
// ④ 앰비언트 패드로 늘리기. 원음 구간과 만든 음색을 같은 크기로 번갈아 들어 본다.
import { h, panel, nextId } from './ui.js';
import { drawOverview, drawBalance, drawBars } from './draw.js';
import { analyzeAudio, planPatch, suggestRegions, paulstretch } from './analyze.js';
import { matchSound, refineSound, toneOnto } from './matcher.js';
import { peaks, toMono, demoSample } from './sample.js';
import { analyzeSample } from './view-sampler.js';
import { renderNote } from './engine.js';
import { normalizePatch } from './patch.js';
import { parseMidi, noteRegions, eventsIn, playedNotes } from './midi.js';
import { FACTORY } from './presets.js';
import { noteName, NOTE_NAMES } from './tuning.js';

const KINDS = {
  tone: { label: '한 음', hint: '배음을 그대로 옮겨 다시 합성해요. 가장 비슷하게 만들 수 있는 경우예요.' },
  chord: { label: '화음·지속음', hint: '여러 음이 함께 울려요. 가장 닮은 음색에서 출발해 톤 균형(맞춤 EQ)과 공간을 맞춰요.' },
  mix: { label: '여러 소리 섞임', hint: '여러 악기가 섞인 구간은 악기 하나로 똑같이 만들 수 없어 톤 균형·공간·성격을 맞춰요. 소리 그대로가 필요하면 ③·④ 를 쓰세요. 악기가 혼자 나오는 곳(전주·끝)을 고르면 더 닮아요.' },
  noise: { label: '음높이 없는 소리', hint: '바람·숨·잡음 같은 소리예요. 톤 균형을 맞추거나 샘플·늘리기를 쓰세요.' },
  silent: { label: '소리 없음', hint: '고른 구간이 너무 조용해요. 다른 곳을 고르세요.' },
};
const PARTS = { tone: '톤 균형', harmonics: '배음', envelope: '엔벨로프', bright: '밝기', width: '폭', space: '공간' };
const MAX_REGION = 12;
const MIN_REGION = 0.3;

const fmt = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
/** '1:23.5' · '83.5' → 초 */
const parseTime = (text) => {
  const parts = String(text).trim().split(':').map(Number);
  if (parts.some((v) => !Number.isFinite(v))) return null;
  return parts.reduce((acc, v) => acc * 60 + v, 0);
};
const rms = (chs) => {
  let e = 0;
  let n = 0;
  for (const c of chs) for (let i = 0; i < c.length; i += 2) { e += c[i] * c[i]; n++; }
  return Math.sqrt(e / Math.max(1, n));
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export function MatchView(root, app) {
  const st = { name: null, buffer: null, over: null, overRate: 1, region: null, suggestions: [], analysis: null, result: null, busy: false, zoom: false, playing: null, link: null, midi: null, midiName: null, track: -1, events: [] };

  // ---- 소리 가져오기 ----
  const fileInput = h('input', { type: 'file', accept: 'audio/*,video/mp4,.m4a,.mp3,.wav,.flac,.ogg', class: 'visually-hidden', id: nextId('mfile') });
  const urlId = nextId('url');
  const urlInput = h('input', { type: 'url', id: urlId, class: 'text-input url-input', placeholder: 'https://www.youtube.com/watch?v=…  또는 .mp3·.wav 링크', autocomplete: 'off', spellcheck: 'false' });
  const fromId = nextId('from');
  const fromInput = h('input', { id: fromId, class: 'text-input time-input', value: '0:00', inputmode: 'decimal', 'aria-label': '받을 구간 시작 (분:초)' });
  const lenSelect = h('select', { 'aria-label': '받을 길이' }, ...[[30, '30초'], [60, '1분'], [120, '2분'], [180, '3분'], [300, '5분'], [600, '10분']].map(([v, t]) => h('option', { value: v, selected: v === 180 || null }, t)));
  const fetchBtn = h('button', { type: 'button', class: 'primary' }, '링크에서 가져오기');
  const linkState = h('p', { class: 'link-state' });
  const demoTone = h('button', { type: 'button' }, '예시: 첼로 한 음');
  const demoChord = h('button', { type: 'button' }, '예시: 패드 화음');
  const fromSampler = h('button', { type: 'button' }, '샘플러 소리로');
  const progress = h('p', { class: 'progress', role: 'status', 'aria-live': 'polite' });
  const midiInput = h('input', { type: 'file', accept: '.mid,.midi,audio/midi,audio/x-midi', class: 'visually-hidden', id: nextId('midi') });
  const trackSelect = h('select', { 'aria-label': 'MIDI 트랙', hidden: true });
  const midiClear = h('button', { type: 'button', class: 'quiet small', hidden: true }, 'MIDI 빼기');
  const midiState = h('p', { class: 'link-state midi-state' });

  const sourceBar = h('section', { class: 'match-source', 'aria-label': '소리 가져오기' },
    h('div', { class: 'match-row' },
      h('label', { class: 'file-btn primary', for: fileInput.id }, '음원 파일 불러오기', fileInput),
      demoTone, demoChord, fromSampler),
    h('div', { class: 'match-row' },
      h('label', { class: 'file-btn', for: midiInput.id }, 'MIDI 함께 불러오기 (선택)', midiInput),
      trackSelect, midiClear),
    midiState,
    h('div', { class: 'match-row link-row' },
      h('label', { for: urlId, class: 'label' }, '링크'),
      urlInput,
      h('label', { for: fromId, class: 'label' }, '시작'), fromInput, lenSelect, fetchBtn),
    linkState);

  const empty = h('div', { class: 'empty-state' },
    h('strong', {}, '따라 만들 소리를 불러오세요'),
    h('p', {}, '음원 파일(MP3·WAV·M4A)이나 유튜브 링크를 넣으면 듣기 좋은 구간을 골라 소리를 재요. 그다음 닮은 음색을 만들거나, 구간을 그대로 샘플로 쓰거나, 흐르는 앰비언트 패드로 늘릴 수 있어요. 악기가 혼자 나오는 전주·끝부분을 고르면 가장 닮게 만들어져요.'));

  // ---- 구간 고르기 ----
  const over = h('canvas', { class: 'overview-canvas', 'aria-label': '음원 전체 파형. 끌어서 구간을 고르세요' });
  const zoomBtn = h('button', { type: 'button', class: 'toggle small', 'aria-pressed': 'false' }, '구간 확대');
  const startId = nextId('rs');
  const lenId = nextId('rl');
  const startInput = h('input', { type: 'number', id: startId, class: 'text-input num-input', min: 0, step: 0.1 });
  const lenInput = h('input', { type: 'number', id: lenId, class: 'text-input num-input', min: MIN_REGION, max: MAX_REGION, step: 0.1 });
  const regionText = h('span', { class: 'region-text' });
  const playRef = h('button', { type: 'button' }, '▶ 원음 구간');
  const chips = h('div', { class: 'chip-row', role: 'group', 'aria-label': '추천 구간' });
  const regionPanel = panel('구간 고르기', {
    cls: 'span-wide',
    hint: '파형을 끌어 구간을 고르거나 시작·길이를 넣으세요 (최대 12초). 고르면 바로 소리를 재요.',
    actions: h('div', { class: 'panel-actions' }, zoomBtn),
  },
  over,
  h('div', { class: 'region-bar' },
    h('label', { for: startId, class: 'label' }, '시작(초)'), startInput,
    h('label', { for: lenId, class: 'label' }, '길이(초)'), lenInput,
    regionText, playRef),
  h('div', { class: 'suggest' }, h('span', { class: 'label' }, '추천 구간'), chips));

  // ---- 잰 결과 ----
  const kindBadge = h('strong', { class: 'kind-badge' });
  const kindHint = h('p', { class: 'panel-hint' });
  const facts = h('dl', { class: 'facts' });
  const balance = h('canvas', { class: 'balance-canvas', 'aria-label': '톤 균형: 원음(청록 면)과 만든 음색(금색 점선)' });
  const harm = h('canvas', { class: 'bar-canvas short', 'aria-label': '배음: 원음(막대)과 만든 음색(선)' });
  const harmWrap = h('div', { class: 'harm-wrap' }, h('p', { class: 'mini-title' }, '배음 (막대 = 원음, 선 = 만든 음색)'), harm);
  const analysisPanel = panel('잰 소리', {},
    h('div', { class: 'kind-line' }, kindBadge), kindHint, facts,
    h('p', { class: 'mini-title' }, '톤 균형 (면 = 원음, 점선 = 만든 음색)'), balance, harmWrap);

  // ---- 만들기 ----
  const makeBtn = h('button', { type: 'button', class: 'primary big' }, '① 닮은 음색 만들기');
  const toneBtn = h('button', { type: 'button' }, '② 지금 음색에 톤만 입히기');
  const sampleBtn = h('button', { type: 'button' }, '③ 구간을 샘플로');
  const stretchSel = h('select', { 'aria-label': '늘리는 배수' }, ...[4, 8, 16].map((v) => h('option', { value: v, selected: v === 8 || null }, `×${v}`)));
  const stretchBtn = h('button', { type: 'button' }, '④ 앰비언트 패드로 늘리기');
  const scoreNum = h('strong', { class: 'score-num' }, '–');
  const scoreBar = h('div', { class: 'score-bar' }, h('span', { class: 'score-fill' }));
  const scoreParts = h('ul', { class: 'score-parts' });
  const steps = h('ol', { class: 'steps' });
  const notes = h('ul', { class: 'made-notes' });
  const playMade = h('button', { type: 'button' }, '▶ 만든 음색');
  const playRef2 = h('button', { type: 'button' }, '▶ 원음 구간');
  const refineBtn = h('button', { type: 'button' }, '더 비슷하게');
  const editBtn = h('button', { type: 'button', class: 'quiet', onclick: () => app.showTab('synth') }, '음색 만들기에서 다듬기 →');
  const saveBtn = h('button', { type: 'button', class: 'quiet', onclick: () => app.savePreset() }, '내 음색으로 저장');
  const result = h('div', { class: 'result', hidden: true },
    h('div', { class: 'score' }, h('span', { class: 'label' }, '닮은 정도'), scoreNum, scoreBar),
    scoreParts,
    h('div', { class: 'btn-row' }, playRef2, playMade, refineBtn),
    steps, notes,
    h('div', { class: 'btn-row' }, editBtn, saveBtn));
  const makePanel = panel('만들기', { hint: '만든 음색은 바로 아래 건반으로 칠 수 있어요. 마음에 들면 저장하세요.' },
    makeBtn,
    h('div', { class: 'btn-row' }, toneBtn, sampleBtn),
    h('div', { class: 'btn-row' }, h('div', { class: 'joined' }, stretchSel, stretchBtn)),
    progress, result);

  const body = h('div', { class: 'match-body' }, regionPanel, analysisPanel, makePanel);
  root.append(sourceBar, empty, body);

  // ---- 불러오기 ----
  function setBusy(text) {
    st.busy = Boolean(text);
    progress.textContent = text || '';
    syncButtons();
  }

  async function loadBuffer(name, buf) {
    stop();
    st.name = name;
    st.buffer = buf;
    st.result = null;
    // 겹쳐 보기·구간 추천은 1/4 로 줄인 모노로 (긴 곡도 가볍게)
    const f = 4;
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const n = Math.floor(L.length / f);
    st.over = new Float32Array(n);
    for (let i = 0; i < n; i++) st.over[i] = (L[i * f] + R[i * f]) / 2;
    st.overRate = buf.sampleRate / f;
    if (st.midi) pickTrack();
    makeSuggestions();
    st.region = { start: st.suggestions[0].start, end: st.suggestions[0].end };
    st.zoom = false;
    zoomBtn.setAttribute('aria-pressed', 'false');
    sync();
    await analyzeRegion();
  }

  // ---- MIDI: 멀티트랙 음원과 함께 받은 MIDI 로 '한 음 구간'을 찾고 같은 음으로 비교 연주 ----
  const trackNotes = () => (st.midi && st.track >= 0 ? st.midi.tracks[st.track].notes : null);
  /** 구간 추천: MIDI 가 있으면 다른 음과 겹치지 않는 긴 음(없으면 가장 긴 화음), 없으면 고르게 이어지는 곳 */
  function makeSuggestions() {
    const notes = trackNotes();
    const dur = st.buffer.duration;
    const fromMidi = notes ? noteRegions(notes, { count: 3, maxLength: MAX_REGION }).filter((r) => r.start < dur - MIN_REGION) : [];
    if (fromMidi.length) {
      st.suggestions = fromMidi.map((r) => ({ start: r.start, end: Math.min(dur, r.end), label: r.notes.map((n) => noteName(n.midi)).join('·') }));
      return;
    }
    const len = Math.min(2.5, dur);
    st.suggestions = suggestRegions(st.over, st.overRate, { seconds: len, count: 3 }).map((r) => ({ start: r.start / st.overRate, end: r.end / st.overRate }));
  }
  /** 음원과 가장 맞는 트랙: 이름이 겹치는 정도 + 음표가 소리 나는 때와 겹치는 정도 */
  function pickTrack() {
    const tokens = (t) => new Set((t || '').toLowerCase().split(/[^0-9a-z가-힣]+/).filter((w) => w.length > 1 || /\d/.test(w)));
    const mine = tokens(st.name);
    let active = null;
    if (st.over) {
      const hop = Math.round(st.overRate * 0.05);
      const frames = Math.floor(st.over.length / hop);
      const db = Array.from({ length: frames }, (_, f) => {
        let e = 0;
        for (let i = f * hop; i < (f + 1) * hop; i++) e += st.over[i] * st.over[i];
        return 10 * Math.log10(e / hop + 1e-12);
      });
      const top = Math.max(...db);
      active = db.map((v) => v > top - 40);
    }
    let best = -1;
    let bestScore = -Infinity;
    st.midi.tracks.forEach((t, i) => {
      if (!t.notes.length) return;
      const name = [...tokens(t.name)].filter((w) => mine.has(w)).length;
      let timing = 0;
      if (active) {
        let on = 0;
        let all = 0;
        for (const n of playedNotes(t.notes)) {
          for (let x = n.start; x < n.end; x += 0.05) {
            all++;
            if (active[Math.floor(x / 0.05)]) on++;
          }
        }
        timing = all ? on / all : 0;
      }
      const score = name * 2 + timing * 3;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    st.track = best;
    renderTracks();
  }
  function renderTracks() {
    trackSelect.hidden = !st.midi;
    midiClear.hidden = !st.midi;
    if (!st.midi) {
      midiState.textContent = '';
      return;
    }
    trackSelect.replaceChildren(...st.midi.tracks.map((t, i) => (t.notes.length ? h('option', { value: i, selected: i === st.track || null }, `${t.name || `트랙 ${i}`} · 음 ${t.notes.length}개`) : null)).filter(Boolean));
    const t = st.midi.tracks[st.track];
    midiState.textContent = t
      ? `MIDI '${st.midiName}' · 트랙 '${t.name || st.track}' 를 이 음원과 맞췄어요. 구간 추천은 다른 음과 겹치지 않는 긴 음이고, 만들 때 같은 음·때·세기로 견줘요.`
      : `MIDI '${st.midiName}' 에 음표가 없어요.`;
    midiState.dataset.state = t ? 'on' : 'off';
  }
  midiInput.addEventListener('change', async () => {
    const f = midiInput.files?.[0];
    midiInput.value = '';
    if (!f) return;
    try {
      st.midi = parseMidi(new Uint8Array(await f.arrayBuffer()));
      st.midiName = f.name.replace(/\.[^.]+$/, '');
      pickTrack();
      if (st.buffer) {
        makeSuggestions();
        st.region = { start: st.suggestions[0].start, end: st.suggestions[0].end };
        sync();
        await analyzeRegion();
      }
    } catch {
      app.notice('MIDI 파일을 읽지 못했어요. .mid 파일인지 확인하세요.', 'bad');
    }
  });
  trackSelect.addEventListener('change', async () => {
    st.track = Number(trackSelect.value);
    renderTracks();
    if (!st.buffer) return;
    makeSuggestions();
    st.region = { start: st.suggestions[0].start, end: st.suggestions[0].end };
    sync();
    await analyzeRegion();
  });
  midiClear.addEventListener('click', async () => {
    st.midi = null;
    st.track = -1;
    st.events = [];
    renderTracks();
    if (!st.buffer) return;
    makeSuggestions();
    sync();
    await analyzeRegion();
  });

  async function loadData(name, data) {
    setBusy('소리 읽는 중…');
    try {
      const ctx = new OfflineAudioContext(2, 1, 44100);
      const buf = await ctx.decodeAudioData(data);
      if (buf.duration < MIN_REGION) throw new Error('short');
      await loadBuffer(name, buf);
      app.notice(`'${name}' (${fmt(buf.duration)})을 불러왔어요. 추천 구간을 쟀어요.`);
    } catch {
      app.notice('이 파일을 소리로 읽지 못했어요. MP3·WAV·M4A 같은 오디오 파일인지 확인하세요.', 'bad');
    } finally {
      setBusy('');
    }
  }

  const bufferFrom = (channels, sr) => {
    const buf = new AudioBuffer({ length: channels[0].length, sampleRate: sr, numberOfChannels: 2 });
    buf.copyToChannel(channels[0], 0);
    buf.copyToChannel(channels[1] ?? channels[0], 1);
    return buf;
  };

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) await loadData(f.name.replace(/\.[^.]+$/, ''), await f.arrayBuffer());
  });
  demoTone.addEventListener('click', async () => {
    const d = demoSample(44100, 3);
    await loadBuffer('예시 첼로 A2', bufferFrom([d], 44100));
  });
  demoChord.addEventListener('click', async () => {
    setBusy('예시 화음 만드는 중…');
    const pad = FACTORY.find((x) => x.patch.name === '쉬머 패드').patch;
    const buf = await renderNote(pad, { notes: [52, 59, 64, 68], seconds: 6, hold: 4.5, dry: false });
    setBusy('');
    await loadBuffer('예시 패드 E 화음', bufferFrom([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate));
  });
  fromSampler.addEventListener('click', async () => {
    const s = app.sample;
    if (!s) return app.notice('샘플러에 소리가 없어요. 샘플러에서 녹음하거나 파일을 불러온 뒤 다시 누르세요.');
    await loadBuffer(s.name, bufferFrom([s.data], s.sr));
  });

  // ---- 링크 (로컬 도우미) ----
  async function checkLink() {
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      st.link = r.ok ? await r.json() : null;
    } catch {
      st.link = null;
    }
    linkState.textContent = !st.link
      ? '링크 가져오기는 로컬 도우미(npm start)로 연 화면에서 돼요. 브라우저는 유튜브 소리를 직접 받을 수 없어요. 지금은 파일을 불러오세요.'
      : !st.link.ffmpeg
        ? '로컬 도우미에 ffmpeg 가 없어 링크를 받을 수 없어요. ffmpeg 를 설치해 주세요.'
        : st.link.ytdlp
          ? '유튜브·음원 링크를 쓸 수 있어요. 시작 위치와 길이만큼만 받아요.'
          : '음원 파일 링크(.mp3·.wav 등)를 쓸 수 있어요. 유튜브는 yt-dlp 를 설치하면 돼요 (pip install yt-dlp).';
    linkState.dataset.state = st.link?.ffmpeg ? 'on' : 'off';
    syncButtons();
  }
  fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    const start = parseTime(fromInput.value);
    if (!/^https?:\/\//i.test(url)) return app.notice('http:// 나 https:// 로 시작하는 링크를 넣어 주세요.', 'bad');
    if (start == null) return app.notice('시작은 1:23 이나 83 처럼 넣어 주세요.', 'bad');
    setBusy('링크에서 소리 받는 중… (영상 길이와 인터넷에 따라 몇십 초 걸려요)');
    try {
      const r = await fetch('api/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, start, duration: Number(lenSelect.value) }) });
      if (!r.ok) {
        const msg = await r.json().catch(() => ({}));
        throw new Error(msg.error || `받지 못했어요 (${r.status})`);
      }
      const title = decodeURIComponent(r.headers.get('X-Title') || '링크 소리');
      const data = await r.arrayBuffer();
      setBusy('');
      await loadData(start > 0 ? `${title} ${fmt(start)}~` : title, data);
    } catch (e) {
      setBusy('');
      app.notice(e.message && !/fetch/i.test(e.message) ? e.message : '로컬 도우미에 연결하지 못했어요. npm start 로 연 화면인지 확인하세요.', 'bad');
    }
  });

  // ---- 구간 ----
  const regionChannels = () => {
    const b = st.buffer;
    const a = Math.round(st.region.start * b.sampleRate);
    const z = Math.round(st.region.end * b.sampleRate);
    const L = b.getChannelData(0).subarray(a, z);
    return [L, b.numberOfChannels > 1 ? b.getChannelData(1).subarray(a, z) : L];
  };
  function setRegion(start, end) {
    const dur = st.buffer.duration;
    let s = Math.max(0, Math.min(start, dur - MIN_REGION));
    let e = Math.min(dur, Math.max(end, s + MIN_REGION));
    if (e - s > MAX_REGION) e = s + MAX_REGION;
    st.region = { start: s, end: e };
  }
  let analyzeTimer = null;
  function scheduleAnalyze() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(() => analyzeRegion(), 120);
  }
  async function analyzeRegion() {
    if (!st.buffer) return;
    st.result = null;
    await nextFrame();
    const notes = trackNotes();
    st.events = notes ? eventsIn(notes, st.region.start, st.region.end) : [];
    // 한 음이면 MIDI 음높이를 알려 줘서 옥타브 착각을 막는다
    const hint = st.events.length === 1 ? 440 * 2 ** ((st.events[0].midi - 69) / 12) : null;
    st.analysis = analyzeAudio(regionChannels(), st.buffer.sampleRate, { pitchHint: hint });
    sync();
  }
  startInput.addEventListener('change', () => {
    const v = Number(startInput.value);
    if (!Number.isFinite(v) || !st.buffer) return;
    setRegion(v, v + (st.region.end - st.region.start));
    sync();
    scheduleAnalyze();
  });
  lenInput.addEventListener('change', () => {
    const v = Number(lenInput.value);
    if (!Number.isFinite(v) || !st.buffer) return;
    setRegion(st.region.start, st.region.start + v);
    sync();
    scheduleAnalyze();
  });
  zoomBtn.addEventListener('click', () => {
    st.zoom = !st.zoom;
    zoomBtn.setAttribute('aria-pressed', String(st.zoom));
    draw();
  });
  const viewRange = () => {
    const dur = st.buffer.duration;
    if (!st.zoom) return { from: 0, to: dur };
    const pad = Math.max(2, (st.region.end - st.region.start) * 1.5);
    return { from: Math.max(0, st.region.start - pad), to: Math.min(dur, st.region.end + pad) };
  };
  let drag = null;
  const timeAt = (e) => {
    const r = over.getBoundingClientRect();
    const v = viewRange();
    return v.from + ((e.clientX - r.left) / r.width) * (v.to - v.from);
  };
  over.addEventListener('pointerdown', (e) => {
    if (!st.buffer) return;
    const r = over.getBoundingClientRect();
    const v = viewRange();
    const x = e.clientX - r.left;
    const xs = ((st.region.start - v.from) / (v.to - v.from)) * r.width;
    const xe = ((st.region.end - v.from) / (v.to - v.from)) * r.width;
    const t = timeAt(e);
    if (Math.abs(x - xs) < 12) drag = { kind: 'start' };
    else if (Math.abs(x - xe) < 12) drag = { kind: 'end' };
    else if (x > xs && x < xe) drag = { kind: 'move', offset: t - st.region.start, len: st.region.end - st.region.start };
    else drag = { kind: 'new', anchor: t };
    over.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  over.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = timeAt(e);
    const { start, end } = st.region;
    if (drag.kind === 'start') setRegion(Math.min(t, end - MIN_REGION), end);
    else if (drag.kind === 'end') setRegion(start, Math.max(t, start + MIN_REGION));
    else if (drag.kind === 'move') setRegion(t - drag.offset, t - drag.offset + drag.len);
    else setRegion(Math.min(drag.anchor, t), Math.max(drag.anchor, t, Math.min(drag.anchor, t) + MIN_REGION));
    syncRegion();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    sync();
    scheduleAnalyze();
  };
  over.addEventListener('pointerup', endDrag);
  over.addEventListener('pointercancel', endDrag);

  // ---- 듣기 (원음 구간과 만든 음색을 같은 크기로) ----
  function stop() {
    if (st.playing) {
      try { st.playing.src.stop(); } catch { /* 이미 멈춤 */ }
      st.playing = null;
    }
    syncButtons();
  }
  async function play(which) {
    if (st.playing?.which === which) return stop();
    stop();
    const ctx = await app.ensureAudio();
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const target = 0.08;
    let from = 0;
    if (which === 'ref') {
      src.buffer = st.buffer;
      from = st.region.start;
      g.gain.value = Math.min(4, target / (rms(regionChannels()) || 1));
      src.start(0, from, st.region.end - st.region.start);
    } else {
      const b = st.result.buffer;
      src.buffer = b;
      g.gain.value = Math.min(4, target / (rms([b.getChannelData(0), b.getChannelData(1)]) || 1));
      src.start();
    }
    src.connect(g).connect(app.studio.bus);
    st.playing = { src, which, t0: ctx.currentTime, from };
    src.onended = () => {
      if (st.playing?.src === src) {
        st.playing = null;
        syncButtons();
        draw();
      }
    };
    syncButtons();
  }
  playRef.addEventListener('click', () => play('ref'));
  playRef2.addEventListener('click', () => play('ref'));
  playMade.addEventListener('click', () => play('made'));
  app.onFrame(() => {
    if (st.playing?.which === 'ref' && !body.hidden && app.tab === 'match') draw();
  });

  // ---- 만들기 ----
  const pool = () => [...FACTORY, ...app.userPresets];
  const madeName = (suffix) => `${(st.name || '음원').slice(0, 26)} ${suffix}`;
  makeBtn.addEventListener('click', async () => {
    if (!st.analysis || st.analysis.kind === 'silent') return;
    stop();
    setBusy('출발 음색 고르는 중…');
    await nextFrame();
    try {
      st.result = await matchSound(st.analysis, pool(), { name: madeName('닮은 음색'), events: st.events, onProgress: (t) => { progress.textContent = `${t}…`; } });
      app.setPatch(st.result.patch, { phase: 'change', presetId: null });
      app.notice(`닮은 정도 ${st.result.score}% 인 음색을 만들어 건반에 걸었어요. '더 비슷하게'로 조금 더 맞춰 볼 수 있어요.`, 'good');
    } finally {
      setBusy('');
      sync();
    }
  });
  refineBtn.addEventListener('click', async () => {
    if (!st.result) return;
    stop();
    setBusy('조금씩 바꿔 보는 중…');
    const before = st.result.score;
    try {
      st.result = await refineSound(st.analysis, st.result, { onProgress: (t) => { progress.textContent = `${t}…`; } });
      app.setPatch(st.result.patch, { phase: 'change', presetId: null });
      app.notice(st.result.score > before ? `닮은 정도 ${before}% → ${st.result.score}%` : '더 닮게 바꿀 값을 찾지 못했어요. 지금이 가장 가까워요.', st.result.score > before ? 'good' : 'info');
    } finally {
      setBusy('');
      sync();
    }
  });
  toneBtn.addEventListener('click', async () => {
    if (!st.analysis || st.analysis.kind === 'silent') return;
    stop();
    setBusy('지금 음색을 같은 음으로 연주해 재는 중…');
    try {
      const notesToPlay = planPatch(st.analysis, pool()).render;
      const r = await toneOnto(app.patch, st.analysis, notesToPlay, st.events);
      app.setPatch({ ...r.patch, name: `${app.patch.name.replace(/ · 톤$/, '')} · 톤`.slice(0, 40) }, { phase: 'change', presetId: null });
      app.notice(`'${st.name}'의 톤 균형·공간·폭을 입혔어요 (닮은 정도 ${r.before}% → ${r.score}%). 맞춤 EQ 는 음색 만들기의 EQ 에서 고칠 수 있어요.`, 'good');
    } finally {
      setBusy('');
    }
  });
  sampleBtn.addEventListener('click', () => {
    if (!st.buffer) return;
    stop();
    const s = analyzeSample(madeName('구간'), toMono(regionChannels()), st.buffer.sampleRate);
    app.setSample(s);
    app.setPatch(normalizePatch({ ...app.patch, name: madeName('샘플'), source: 'sample' }), { phase: 'change', presetId: null });
    app.notice(`구간을 샘플로 건반에 걸었어요 (기준 음 ${noteName(s.root)}). 샘플러에서 루프 지점·가공을 다듬을 수 있어요.`, 'good');
  });
  stretchBtn.addEventListener('click', async () => {
    if (!st.buffer) return;
    stop();
    const factor = Number(stretchSel.value);
    setBusy(`×${factor} 로 늘리는 중… (몇 초 걸려요)`);
    await nextFrame();
    try {
      const sr = st.buffer.sampleRate;
      const mono = toMono(regionChannels());
      // 너무 긴 결과는 무겁다: 늘린 길이를 40초 안으로
      const src = mono.length * factor > sr * 40 ? mono.subarray(0, Math.floor((sr * 40) / factor)) : mono;
      const data = paulstretch(src, sr, factor);
      const s = analyzeSample(madeName('앰비언트'), data, sr);
      // 늘린 소리는 고르게 흘러서 길게 크로스페이드하면 어디서 이어도 매끄럽다
      if (s.loopMode === 'off' || s.cost == null || s.cost > 0.2) {
        s.loopMode = 'forward';
        s.loopStart = Math.round(s.start + (s.end - s.start) * 0.2);
        s.loopEnd = Math.round(s.start + (s.end - s.start) * 0.92);
      }
      s.xfadeMs = 200;
      app.setSample(s);
      app.setPatch(normalizePatch({
        name: madeName('앰비언트 패드'), category: 'texture', source: 'sample', volume: 0.7,
        ampEnv: { a: 1.2, d: 2, s: 1, r: 3.5 }, filter: { cutoff: 12000, keytrack: 0 },
        fx: { chorus: 0.25, reverb: 0.5, size: 5, shimmer: 0.15, width: 1.5, predelay: 0.04 },
      }), { phase: 'change', presetId: null });
      app.notice(`${(data.length / sr).toFixed(0)}초짜리 앰비언트 패드를 만들었어요. 기준 음 ${noteName(s.root)} 를 치면 원곡 높이예요.`, 'good');
    } finally {
      setBusy('');
    }
  });

  // ---- 그리기·맞추기 ----
  function draw() {
    if (!st.buffer) return;
    const v = viewRange();
    const a = Math.floor(v.from * st.overRate);
    const z = Math.ceil(v.to * st.overRate);
    const pk = peaks(st.over, Math.max(100, Math.round(over.clientWidth || 600)), a, Math.min(st.over.length, z));
    let playhead = null;
    if (st.playing?.which === 'ref' && app.studio.ctx) playhead = st.playing.from + (app.studio.ctx.currentTime - st.playing.t0);
    const notes = trackNotes();
    const marks = notes ? playedNotes(notes).map((n) => ({ start: n.start, end: n.end })) : st.suggestions;
    drawOverview(over, pk, { view: v, region: st.region, playhead, marks });
  }
  function syncRegion() {
    const r = st.region;
    if (document.activeElement !== startInput) startInput.value = r.start.toFixed(1);
    if (document.activeElement !== lenInput) lenInput.value = (r.end - r.start).toFixed(1);
    regionText.textContent = `${fmt(r.start)} – ${fmt(r.end)} · 전체 ${fmt(st.buffer.duration)}`;
    draw();
  }
  function syncButtons() {
    const a = st.analysis;
    const ok = Boolean(st.buffer && a && a.kind !== 'silent');
    makeBtn.disabled = st.busy || !ok;
    toneBtn.disabled = st.busy || !ok;
    sampleBtn.disabled = st.busy || !st.buffer;
    stretchBtn.disabled = st.busy || !st.buffer;
    refineBtn.disabled = st.busy || !st.result;
    fetchBtn.disabled = st.busy || !st.link?.ffmpeg;
    for (const b of [demoTone, demoChord, fromSampler]) b.disabled = st.busy;
    playRef.textContent = st.playing?.which === 'ref' ? '■ 멈춤' : '▶ 원음 구간';
    playRef2.textContent = playRef.textContent;
    playMade.textContent = st.playing?.which === 'made' ? '■ 멈춤' : '▶ 만든 음색';
    playMade.disabled = !st.result;
    playRef.disabled = !st.buffer;
  }
  function sync() {
    empty.hidden = Boolean(st.buffer);
    body.hidden = !st.buffer;
    syncButtons();
    if (!st.buffer) return;
    chips.replaceChildren(...st.suggestions.map((r, i) => h('button', {
      type: 'button', class: 'chip-btn',
      'aria-pressed': String(Math.abs(r.start - st.region.start) < 0.05 && Math.abs(r.end - st.region.end) < 0.05),
      onclick: () => {
        st.region = { start: r.start, end: r.end };
        sync();
        scheduleAnalyze();
      },
    }, r.label ? `${i + 1} · ${r.label} · ${fmt(r.start)}` : `${i + 1} · ${fmt(r.start)}`)));
    syncRegion();
    const a = st.analysis;
    if (!a) return;
    const k = KINDS[a.kind];
    kindBadge.textContent = k.label;
    kindBadge.dataset.kind = a.kind;
    kindHint.textContent = k.hint;
    if (a.kind === 'silent') {
      facts.replaceChildren();
      harmWrap.hidden = true;
      result.hidden = true;
      return;
    }
    const e = a.envelope;
    const sec = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
    const rows = [
      ['음높이', a.pitch ? `${noteName(a.pitch.note)} · ${a.pitch.hz.toFixed(1)} Hz · ${a.pitch.cents >= 0 ? '+' : ''}${a.pitch.cents.toFixed(0)} cent` : (a.strongPcs.length ? `센 음: ${a.strongPcs.slice(0, 4).map((pc) => NOTE_NAMES[pc]).join(' ')}` : '찾지 못함')],
      ['엔벨로프', `어택 ${sec(e.attack)} · 서스테인 ${Math.round(e.sustain * 100)}% · 릴리즈 ${sec(e.release)}${e.releaseMeasured ? '' : ' (짐작)'}`],
      ['밝기', `${Math.round(a.brightness.sustain)} Hz${a.brightness.early > a.brightness.sustain * 1.15 ? ` (첫소리 ${Math.round(a.brightness.early)} Hz)` : ''}`],
      ['흔들림', a.vibrato ? `비브라토 ${a.vibrato.rate} Hz · ±${a.vibrato.depth} cent` : a.tremolo ? `트레몰로 ${a.tremolo.rate} Hz` : '거의 없음'],
      ['폭·공간', `좌우 폭 ${Math.round(a.width * 100)}% · 잔향 ${a.space.measured ? `${a.space.rt60.toFixed(1)} s` : '구간 안에서 재지 못함'}`],
    ];
    if (a.kind === 'tone') rows.push(['배음', `${a.harmonics.filter((v) => v > 0.01).length}개 · 숨소리 ${a.noiseLevel > 0.005 ? '있음' : '거의 없음'}${a.inharmonicity > 0.005 ? ' · 위로 늘어난 배음' : ''}`]);
    if (a.kind === 'mix') rows.push(['음 시작', `초당 ${a.onsetRate.toFixed(1)}번`]);
    if (st.midi) rows.push(['MIDI', st.events.length ? `이 구간의 음 ${st.events.map((e) => noteName(e.midi)).join(' ')}${a.pitch?.corrected ? ' · 음높이를 MIDI 로 바로잡음' : ''}` : '이 구간에 MIDI 음이 없어요']);
    facts.replaceChildren(...rows.flatMap(([dt, dd]) => [h('dt', {}, dt), h('dd', {}, dd)]));
    const res = st.result;
    requestAnimationFrame(() => {
      drawBalance(balance, a.curve.centers, a.curve.db, res?.cand?.curve?.db ?? null);
      harmWrap.hidden = !a.harmonics;
      if (a.harmonics) drawBars(harm, a.harmonics.slice(0, 32), { sqrt: true, compare: res?.cand?.harmonics?.slice(0, 32) ?? null });
    });
    result.hidden = !res;
    if (!res) return;
    scoreNum.textContent = `${res.score}%`;
    scoreBar.firstChild.style.width = `${res.score}%`;
    scoreBar.dataset.level = res.score >= 80 ? 'good' : res.score >= 60 ? 'warn' : 'bad';
    scoreParts.replaceChildren(...Object.entries(res.parts).map(([key, v]) => h('li', {}, `${PARTS[key] ?? key} ${Math.round(v * 100)}%`)));
    steps.replaceChildren(...res.steps.map((s) => h('li', {}, `${s.label} ${s.score}%`)));
    notes.replaceChildren(...res.plan.notes.map((t) => h('li', {}, t)));
  }

  app.on('show:match', () => {
    checkLink();
    requestAnimationFrame(sync);
  });
  app.on('resize', () => sync());
  app.on('panic', stop);
  checkLink();
  sync();
  return { state: st, loadBuffer, loadData };
}
