// 샘플러 화면: 소리 가져오기(파일·마이크·데모·지금 음색 굽기), 시작/끝·루프 지점 끌기, 이음새 보기,
// 기준 음·미세 조정(튜닝), 루프 방식, 크로스페이드, SFZ 악기 내보내기.
import { h, panel, nextId } from './ui.js';
import { drawSample, drawSeam } from './draw.js';
import { peaks, trimSilence, detectPitch, findLoop, upwardZeroCrossings, encodeWav, sfzText, demoSample, toMono, reversed, withFades } from './sample.js';
import { paulstretch } from './analyze.js';
import { noteName } from './tuning.js';
import { renderNote } from './engine.js';
import { makeZip } from './zip.js';
import { saveFile } from './store.js';

const LOOP_MODES = [
  { id: 'off', label: '한 번만', hint: '끝까지 한 번 울리고 멈춤 (드럼·효과음)' },
  { id: 'forward', label: '반복', hint: '루프 구간을 계속 되풀이 (패드·현·오르간)' },
  { id: 'pingpong', label: '왕복', hint: '앞으로 갔다 뒤로 돌아옴. 이음새가 튀는 소리에 유리' },
];

/** 새 소리를 받아 자동으로 무음 자르기 → 음높이 찾기 → 루프 찾기까지 한다. */
export function analyzeSample(name, data, sr, rootHint = null) {
  const { start, end } = trimSilence(data, sr);
  const detected = detectPitch(data, sr, { start, end });
  const root = rootHint ?? detected?.note ?? 60;
  const fine = rootHint != null ? 0 : detected ? Math.round(detected.cents) : 0;
  const s = { name, data, sr, start, end, root, fine, detected, loopMode: 'forward', loopStart: 0, loopEnd: 0, xfadeMs: 30, cost: null };
  autoLoop(s);
  return s;
}

export function autoLoop(s) {
  const hz = s.detected?.hz ?? null;
  const loop = findLoop(s.data, s.sr, { start: s.start, end: s.end, hz });
  if (loop) {
    s.loopStart = loop.loopStart;
    s.loopEnd = loop.loopEnd;
    s.cost = loop.cost;
  } else {
    s.loopStart = Math.round(s.start + (s.end - s.start) * 0.4);
    s.loopEnd = Math.round(s.start + (s.end - s.start) * 0.9);
    s.loopMode = 'off';
    s.cost = null;
  }
}

export function SamplerView(root, app) {
  const fileInput = h('input', { type: 'file', accept: 'audio/*', class: 'visually-hidden', id: nextId('file') });
  const recBtn = h('button', { type: 'button' }, '● 마이크로 녹음');
  const bakeNote = h('select', { 'aria-label': '구울 음' }, ...[45, 48, 52, 57, 60, 64, 69].map((m) => h('option', { value: m, selected: m === 57 || null }, noteName(m))));
  const bakeBtn = h('button', { type: 'button' }, '지금 음색을 샘플로 굽기');
  const demoBtn = h('button', { type: 'button' }, '데모 소리 (활로 켠 A2)');

  const empty = h('div', { class: 'empty-state' },
    h('strong', {}, '샘플이 아직 없어요'),
    h('p', {}, '오디오 파일을 불러오거나, 데모 소리·지금 음색 굽기로 시작하세요. 불러오면 무음 자르기, 음높이 찾기, 루프 지점 찾기를 자동으로 합니다.'));

  const wave = h('canvas', { class: 'wave-canvas', 'aria-label': '샘플 파형. 시작·끝·루프 표시를 끌어 옮길 수 있어요' });
  const zoomBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false' }, '루프 부분 확대');
  const snapBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'true' }, '0 지점에 붙이기');
  const seam = h('canvas', { class: 'seam-canvas', 'aria-label': '루프 이음새' });
  const seamScore = h('strong', { class: 'seam-score' });
  const info = h('dl', { class: 'facts' });

  const rootSel = h('select', { id: nextId('root') }, ...Array.from({ length: 73 }, (_, i) => i + 24).map((m) => h('option', { value: m }, noteName(m))));
  const fineId = nextId('fine');
  const fine = h('input', { type: 'range', id: fineId, min: -50, max: 50, step: 1 });
  const fineOut = h('output', { for: fineId });
  const modeBtns = LOOP_MODES.map((m) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'false', title: m.hint, onclick: () => update((s) => { s.loopMode = m.id; }) }, m.label));
  const modeHint = h('p', { class: 'panel-hint' });
  const xfId = nextId('xf');
  const xfade = h('input', { type: 'range', id: xfId, min: 0, max: 200, step: 1 });
  const xfOut = h('output', { for: xfId });
  const useBtn = h('button', { type: 'button', class: 'primary' }, '이 샘플로 건반 연주');
  const stretchSel = h('select', { 'aria-label': '늘리는 배수' }, ...[2, 4, 8].map((v) => h('option', { value: v, selected: v === 4 || null }, `×${v}`)));
  const restoreBtn = h('button', { type: 'button', class: 'quiet' }, '원래대로');
  const exportBtn = h('button', { type: 'button' }, 'SFZ 악기 내보내기 (.zip)');

  const body = h('div', { class: 'sampler-body' },
    panel('파형과 루프', {
      cls: 'span-wide',
      hint: '흰 표시는 소리의 시작·끝, 금색 표시는 루프 구간. 끌어서 옮기세요.',
      actions: h('div', { class: 'panel-actions' }, zoomBtn, snapBtn),
    }, wave),
    panel('이음새', { hint: '루프 끝에서 루프 시작으로 넘어가는 순간. 두 선이 매끄럽게 이어져야 "틱" 소리가 없어요.' },
      seam, h('p', { class: 'seam-line' }, seamScore),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', onclick: () => update((s) => autoLoop(s)) }, '루프 자동 찾기'),
        h('button', { type: 'button', onclick: () => update((s) => Object.assign(s, trimSilence(s.data, s.sr))) }, '무음 자르기'))),
    panel('튜닝', { hint: '샘플이 실제로 어떤 음인지. 감지한 값을 넣어 두면 건반을 누른 음 그대로 납니다.' },
      info,
      h('div', { class: 'ctl' }, h('label', { for: rootSel.id }, '기준 음'), h('span'), rootSel),
      h('div', { class: 'ctl' }, h('label', { for: fineId }, '미세 조정'), fineOut, fine),
      h('div', { class: 'btn-row' }, h('button', {
        type: 'button', onclick: () => update((s) => {
          s.detected = detectPitch(s.data, s.sr, { start: s.start, end: s.end });
          if (s.detected) { s.root = s.detected.note; s.fine = Math.round(s.detected.cents); }
        }),
      }, '음높이 다시 찾기'))),
    panel('가공', { hint: '거꾸로 돌리면 스웰, 늘리면 흐르는 앰비언트 패드가 돼요. 원래대로로 언제든 돌아가요.' },
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', onclick: () => processSample('거꾸로', (x) => reversed(x)) }, '거꾸로'),
        h('div', { class: 'joined' }, stretchSel,
          h('button', { type: 'button', onclick: () => processSample(`×${stretchSel.value}`, (x, sr) => paulstretch(x, sr, Number(stretchSel.value)), { pad: true }) }, '늘리기')),
        h('button', { type: 'button', onclick: () => processSample('페이드', (x, sr) => withFades(x, sr, 200, 400)) }, '앞뒤 페이드'),
        restoreBtn)),
    panel('재생 방식', {},
      h('div', { class: 'ctl ctl-seg' }, h('span', { class: 'label' }, '루프'), h('div', { class: 'seg', role: 'group', 'aria-label': '루프 방식' }, ...modeBtns)),
      modeHint,
      h('div', { class: 'ctl' }, h('label', { for: xfId }, '이음새 크로스페이드'), xfOut, xfade),
      h('div', { class: 'btn-row' }, useBtn, exportBtn)));

  root.append(
    h('div', { class: 'sampler-tools' },
      h('label', { class: 'file-btn primary', for: fileInput.id }, '오디오 파일 불러오기', fileInput),
      recBtn, demoBtn,
      h('span', { class: 'bar-sep', 'aria-hidden': 'true' }),
      h('div', { class: 'joined' }, bakeNote, bakeBtn)),
    empty, body);

  // ---- 소리 가져오기 ----
  const accept = (s, { use = true } = {}) => {
    app.setSample(s);
    if (use && app.patch.source !== 'sample') {
      app.setParam('source', 'sample', 'change');
      app.notice(`'${s.name}' 샘플을 건반에 걸었어요. 음색 만들기의 소리 재료가 '샘플'로 바뀌었어요.`);
    }
  };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const ctx = await app.ensureAudio();
      const buf = await ctx.decodeAudioData(await f.arrayBuffer());
      const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      accept(analyzeSample(f.name.replace(/\.[^.]+$/, ''), toMono(ch), buf.sampleRate));
    } catch {
      app.notice('이 파일을 소리로 읽지 못했어요. WAV·MP3·M4A 같은 오디오 파일인지 확인하세요.', 'bad');
    }
  });
  demoBtn.addEventListener('click', () => accept(analyzeSample('데모 첼로 A2', demoSample(44100), 44100)));
  bakeBtn.addEventListener('click', async () => {
    const midi = Number(bakeNote.value);
    bakeBtn.disabled = true;
    try {
      const patch = app.patch.source === 'sample' ? { ...app.patch, source: 'synth' } : app.patch;
      const buf = await renderNote(patch, { midi, seconds: Math.min(6, 2.5 + patch.ampEnv.a), hold: Math.min(5, 2 + patch.ampEnv.a), tuning: {} });
      accept(analyzeSample(`${patch.name} ${noteName(midi)}`, toMono([buf.getChannelData(0), buf.getChannelData(1)]), buf.sampleRate, midi));
    } finally {
      bakeBtn.disabled = false;
    }
  });
  let recorder = null;
  recBtn.addEventListener('click', async () => {
    if (recorder) {
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      app.notice('이 브라우저(또는 이 화면)에서는 마이크를 쓸 수 없어요. 파일을 불러오거나 데모 소리를 쓰세요.', 'bad');
      return;
    }
    let stream;
    try {
      const ctx = await app.ensureAudio();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearTimeout(recorder.limit);
        recorder = null;
        recBtn.textContent = '● 마이크로 녹음';
        recBtn.classList.remove('recording');
        try {
          const buf = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
          accept(analyzeSample('내 녹음', toMono([buf.getChannelData(0)]), buf.sampleRate));
        } catch {
          app.notice('녹음한 소리를 읽지 못했어요. 다시 녹음해 보세요.', 'bad');
        }
      };
      recorder.start();
      recorder.limit = setTimeout(() => recorder?.stop(), 10000);
      recBtn.textContent = '■ 녹음 멈추기 (최대 10초)';
      recBtn.classList.add('recording');
      app.notice('한 음을 길게 내 주세요. 이어폰을 끼면 스피커 소리가 섞이지 않아요.');
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      recorder = null;
      app.notice('마이크를 열지 못했어요. 브라우저의 마이크 권한을 확인하거나, 파일을 불러오세요.', 'bad');
    }
  });

  // ---- 가공: 시작~끝 구간을 바꿔 새 샘플로 (기준 음은 그대로). 처음 소리는 '원래대로'를 위해 남긴다 ----
  async function processSample(label, fn, { pad = false } = {}) {
    const s = app.sample;
    if (!s) return;
    app.notice(`${label} 하는 중…`);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const original = s.original ?? { name: s.name, data: s.data };
    const next = analyzeSample(`${original.name} ${label}`.slice(0, 40), fn(s.data.slice(s.start, s.end), s.sr), s.sr, s.root);
    next.fine = s.fine;
    next.original = original;
    if (pad) {
      // 늘린 소리는 고르게 흘러서 길게 크로스페이드하면 어디서 이어도 매끄럽다
      next.loopMode = 'forward';
      if (next.cost == null || next.cost > 0.2) {
        next.loopStart = Math.round(next.start + (next.end - next.start) * 0.2);
        next.loopEnd = Math.round(next.start + (next.end - next.start) * 0.92);
      }
      next.xfadeMs = 200;
    }
    app.setSample(next);
    app.notice(`'${next.name}' 으로 바꿨어요.`, 'good');
  }
  restoreBtn.addEventListener('click', () => {
    const s = app.sample;
    if (!s?.original) return;
    const back = analyzeSample(s.original.name, s.original.data, s.sr, s.root);
    back.fine = s.fine;
    app.setSample(back);
  });

  // ---- 값 바꾸기 ----
  function update(fn) {
    const s = app.sample;
    if (!s) return;
    fn(s);
    s.loopStart = Math.max(s.start + 1, Math.min(s.loopStart, s.end - 2));
    s.loopEnd = Math.max(s.loopStart + 1, Math.min(s.loopEnd, s.end));
    app.setSample(s);
  }
  rootSel.addEventListener('change', () => update((s) => { s.root = Number(rootSel.value); }));
  fine.addEventListener('input', () => {
    fineOut.textContent = `${Number(fine.value) > 0 ? '+' : ''}${fine.value} cent`;
  });
  fine.addEventListener('change', () => update((s) => { s.fine = Number(fine.value); }));
  xfade.addEventListener('input', () => { xfOut.textContent = `${xfade.value} ms`; });
  xfade.addEventListener('change', () => update((s) => { s.xfadeMs = Number(xfade.value); }));
  useBtn.addEventListener('click', () => {
    app.setParam('source', 'sample', 'change');
    app.notice('건반이 이 샘플을 연주해요.');
  });
  exportBtn.addEventListener('click', async () => {
    const s = app.sample;
    const baked = app.bakedSample;
    if (!s || !baked) return;
    const safe = s.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40) || 'sample';
    const sfz = sfzText({
      file: `${safe}.wav`, name: s.name, root: s.root, tune: -s.fine,
      loop: baked.loop ? { start: baked.loop.start, end: baked.loop.end } : null,
      env: app.patch.ampEnv,
    });
    const zip = makeZip([{ name: `${safe}.sfz`, data: sfz }, { name: `${safe}.wav`, data: encodeWav(baked.data, s.sr, { gain: baked.gain }) }]);
    const r = await saveFile(`${safe}.zip`, zip, 'application/zip');
    app.notice(r === 'saved' ? `${safe}.zip 파일을 저장했어요. 압축을 풀어 sfizz·Sforzando 같은 무료 SFZ 플레이어에서 여세요.` : '이 화면에서는 파일을 저장할 수 없어요.', r === 'saved' ? 'good' : 'bad');
  });
  zoomBtn.addEventListener('click', () => {
    zoomBtn.setAttribute('aria-pressed', String(zoomBtn.getAttribute('aria-pressed') !== 'true'));
    draw();
  });
  snapBtn.addEventListener('click', () => snapBtn.setAttribute('aria-pressed', String(snapBtn.getAttribute('aria-pressed') !== 'true')));

  // ---- 표시 끌기 ----
  const viewRange = (s) => {
    if (zoomBtn.getAttribute('aria-pressed') !== 'true') return { from: 0, to: s.data.length };
    const pad = Math.max(Math.round(s.sr * 0.05), Math.round((s.loopEnd - s.loopStart) * 0.15));
    return { from: Math.max(0, s.loopStart - pad), to: Math.min(s.data.length, s.loopEnd + pad) };
  };
  const markerList = (s) => [
    { key: 'start', at: s.start, label: '시작', kind: 'edge' },
    { key: 'end', at: s.end, label: '끝', kind: 'edge' },
    ...(s.loopMode !== 'off' ? [{ key: 'loopStart', at: s.loopStart, label: '루프 ▸', kind: 'loop' }, { key: 'loopEnd', at: s.loopEnd, label: '◂ 루프', kind: 'loop' }] : []),
  ];
  let drag = null;
  const sampleAt = (e, s) => {
    const r = wave.getBoundingClientRect();
    const v = viewRange(s);
    return Math.round(v.from + ((e.clientX - r.left) / r.width) * (v.to - v.from));
  };
  wave.addEventListener('pointerdown', (e) => {
    const s = app.sample;
    if (!s) return;
    const r = wave.getBoundingClientRect();
    const v = viewRange(s);
    const x = e.clientX - r.left;
    let best = null;
    for (const m of markerList(s)) {
      const mx = ((m.at - v.from) / (v.to - v.from)) * r.width;
      const d = Math.abs(mx - x);
      if (d < 18 && (!best || d < best.d)) best = { key: m.key, d };
    }
    if (!best) return;
    drag = best.key;
    wave.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  wave.addEventListener('pointermove', (e) => {
    const s = app.sample;
    if (!drag || !s) return;
    s[drag] = Math.max(0, Math.min(s.data.length, sampleAt(e, s)));
    draw(drag);
  });
  const endDrag = () => {
    const s = app.sample;
    if (!drag || !s) return;
    const key = drag;
    drag = null;
    update((x) => {
      if (key.startsWith('loop') && snapBtn.getAttribute('aria-pressed') === 'true') {
        const z = upwardZeroCrossings(x.data, x[key] - 400, x[key] + 400);
        if (z.length) x[key] = z.reduce((a, b) => (Math.abs(b - x[key]) < Math.abs(a - x[key]) ? b : a));
      }
      if (x.start > x.end - 100) x.start = Math.max(0, x.end - 100);
      x.cost = null;
    });
  };
  wave.addEventListener('pointerup', endDrag);
  wave.addEventListener('pointercancel', endDrag);

  // ---- 그리기 ----
  function draw(active) {
    const s = app.sample;
    if (!s) return;
    const v = viewRange(s);
    const pk = peaks(s.data, Math.max(100, Math.round(wave.clientWidth || 600)), v.from, v.to);
    drawSample(wave, pk, {
      view: v,
      region: { start: s.start, end: s.end },
      loop: s.loopMode !== 'off' ? { start: s.loopStart, end: s.loopEnd } : null,
      markers: markerList(s).map((m) => ({ ...m, active: m.key === active })),
    });
    const b = app.bakedSample;
    if (s.loopMode !== 'off' && b?.loop) drawSeam(seam, b.data, b.loop.start, b.loop.end, s.sr);
    else drawSeam(seam, s.data, s.loopStart, s.loopEnd, s.sr);
  }

  function sync() {
    const s = app.sample;
    empty.hidden = Boolean(s);
    body.hidden = !s;
    exportBtn.disabled = !s;
    if (!s) return;
    restoreBtn.disabled = !s.original;
    const sec = (n) => `${(n / s.sr).toFixed(2)} s`;
    const d = s.detected;
    info.replaceChildren(
      h('dt', {}, '이름'), h('dd', {}, s.name),
      h('dt', {}, '길이'), h('dd', {}, `${sec(s.end - s.start)} (전체 ${sec(s.data.length)}) · ${s.sr} Hz`),
      h('dt', {}, '감지한 음'), h('dd', {}, d ? `${noteName(d.note)} · ${d.hz.toFixed(1)} Hz · ${d.cents >= 0 ? '+' : ''}${d.cents.toFixed(0)} cent · 확신 ${Math.round(d.clarity * 100)}%` : '음높이를 찾지 못함 (타악기·잡음)'),
      h('dt', {}, '루프'), h('dd', {}, s.loopMode === 'off' ? '없음' : `${sec(s.loopStart - s.start)} → ${sec(s.loopEnd - s.start)} (${sec(s.loopEnd - s.loopStart)})`));
    rootSel.value = String(s.root);
    fine.value = String(s.fine);
    fineOut.textContent = `${s.fine > 0 ? '+' : ''}${s.fine} cent`;
    xfade.value = String(s.xfadeMs);
    xfOut.textContent = `${s.xfadeMs} ms`;
    modeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(LOOP_MODES[i].id === s.loopMode)));
    modeHint.textContent = LOOP_MODES.find((m) => m.id === s.loopMode).hint;
    const cost = app.bakedSample?.seamCost;
    seamScore.textContent = s.loopMode === 'off' ? '루프 없음' : cost == null ? '' : `이음새 매끄러움 ${Math.round(Math.max(0, 1 - cost) * 100)}%`;
    seamScore.dataset.level = cost == null ? '' : cost < 0.05 ? 'good' : cost < 0.25 ? 'warn' : 'bad';
    draw();
  }

  app.on('sample', sync);
  app.on('resize', () => draw());
  app.on('show:sampler', () => requestAnimationFrame(sync));
  sync();
  return { sync };
}
