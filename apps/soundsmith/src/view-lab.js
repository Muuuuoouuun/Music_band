// 실험실: 위는 고르고 다듬기(쓰임새 → 음색 카드 → '지금 소리' 설명 → 도우미 슬라이더 → 들어 보기),
// 아래는 자세히 조절(소리 흐름 그림을 눌러 고칠 곳 고르기 → 배음 그리기·끄는 필터·끄는 엔벨로프·세부 값).
import {
  CATEGORIES, MACROS, RANDOM_KINDS, PARAMS, applyMacro, normalizePatch, randomPatch, mutatePatch,
  describePatch, envLevel, harmonicsOf, waveCycle, toUnit, fromUnit, formatValue, getPath, BASE_PATCH,
} from './patch.js';
import { FACTORY, USES } from './presets.js';
import { h, panel, controlGroup, nextId, knob } from './ui.js';
import { drawHarmonics, drawCycle, drawAdsr, drawFilterEditor } from './draw.js';
import { HybridSection } from './view-hybrid.js';
import { OrganPanels, regOf } from './view-organ.js';
import { LIBRARIES } from './library.js';
import { saveFile, copyText } from './store.js';

/** 카드에 넣는 작은 볼륨 모양 (SVG 경로). */
function envPath(env, w = 200, hgt = 36) {
  const hold = Math.max(0.3, env.a + env.d * 0.8);
  const total = hold + env.r;
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * total;
    const v = t <= hold ? envLevel(env, t) : envLevel(env, hold) * Math.exp(-(t - hold) / Math.max(env.r / 5, 1e-4));
    pts.push(`${((t / total) * w).toFixed(1)} ${(hgt - 2 - v * (hgt - 6)).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}

const svgEl = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

export function LabView(root, app) {
  const bind = {
    get: () => app.patch,
    set: (path, v, phase) => app.setParam(path, v, phase),
    // 노브를 두 번 누르면 고른 음색(없으면 기본 소리)의 값으로
    defaultOf: (path) => getPath(app.findPreset(app.presetId)?.patch ?? BASE_PATCH, path),
  };
  let use = 'all';
  let kind = 'all';
  let node = 'osc0';
  let lastSource = app.patch.source;

  // =========================================================================
  // 위: 고르고 다듬기
  // =========================================================================
  const useChips = h('div', { class: 'use-chips', role: 'group', 'aria-label': '쓰임새' });
  const kindChips = h('div', { class: 'use-chips kind-chips', role: 'group', 'aria-label': '종류' });
  const cards = h('div', { class: 'cards' });
  const pick = h('section', { class: 'lab-pick', 'aria-labelledby': 'lab-pick-h' },
    h('div', { class: 'lab-head' }, h('h2', { id: 'lab-pick-h' }, '어떤 자리에 쓸까요?'), useChips),
    kindChips,
    cards);
  const KINDS = [{ id: 'all', label: '모든 종류' }, ...CATEGORIES, { id: 'hybrid', label: '겹친 음색' }];
  const kindOk = (patch) => kind === 'all' || (kind === 'hybrid' ? patch.layers.length > 0 : patch.category === kind);

  function renderPick() {
    useChips.replaceChildren(...USES.map((u) => h('button', {
      type: 'button', class: 'chip-btn use-chip', 'aria-pressed': String(u.id === use),
      onclick: () => { use = u.id; renderPick(); },
    }, u.label)));
    kindChips.replaceChildren(...KINDS.map((k) => h('button', {
      type: 'button', class: 'chip-btn use-chip kind-chip', 'aria-pressed': String(k.id === kind), dataset: { kind: k.id },
      onclick: () => { kind = k.id; renderPick(); },
    }, k.label)));
    const mine = use === 'all' ? app.userPresets.filter((u) => kindOk(u.patch)) : [];
    const list = FACTORY.filter((f) => (use === 'all' || f.uses.includes(use)) && kindOk(f.patch));
    cards.replaceChildren(
      ...mine.map((u) => card(u, '내 음색', true)),
      ...list.map((f) => card(f, f.desc, false)));
  }

  function card(entry, desc, mine) {
    const on = app.presetId === entry.id;
    const svg = svgEl('svg', { viewBox: '0 0 200 36', 'aria-hidden': 'true', class: 'card-env' });
    svg.append(svgEl('path', { d: envPath(entry.patch.ampEnv), fill: 'none', 'stroke-width': '2.5' }));
    const b = h('button', { type: 'button', class: 'card', 'aria-pressed': String(on), onclick: () => app.loadPreset(entry) },
      h('span', { class: 'card-top' }, h('strong', {}, entry.patch.name), on ? h('span', { class: 'card-badge' }, '고름') : null),
      svg,
      h('span', { class: 'card-desc' }, desc));
    if (!mine) return b;
    return h('div', { class: 'card-wrap' }, b,
      h('button', { type: 'button', class: 'card-del', 'aria-label': `${entry.patch.name} 지우기`, onclick: () => app.deletePreset(entry.id) }, '×'));
  }

  // ---- 다듬기 ----
  const shapeTitle = h('h2', {});
  const summary = h('p', { class: 'summary', 'aria-live': 'polite' });
  const undoBtn = h('button', { type: 'button', class: 'quiet', onclick: () => app.undo() }, '되돌리기');
  const resetBtn = h('button', {
    type: 'button', class: 'quiet', onclick: () => {
      const e = app.findPreset(app.presetId);
      if (e) app.loadPreset(e);
    },
  }, '처음 소리로');
  // 도우미 노브: 가운데(12시)가 지금 소리. 돌리기 시작한 순간의 소리를 기준으로 여러 값을 함께 움직인다.
  const signedPct = (v) => {
    const n = Math.round((v - 0.5) * 100);
    return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0';
  };
  const macroState = {};
  const macroEls = MACROS.map((m) => {
    const st = (macroState[m.id] = { base: null, startPos: 0.5, last: 0.5, knob: null });
    const apply = (v, phase) => {
      if (!st.base) {
        st.base = app.patch;
        st.startPos = st.last;
      }
      app.setPatch(applyMacro(st.base, m.id, 0.5 + v - st.startPos), { phase, keepMacros: true });
      if (phase === 'change') {
        st.last = v;
        st.base = null;
      }
    };
    st.knob = knob({
      label: m.label, min: 0, max: 1, value: 0.5, bipolar: true, center: 0.5, size: 'lg', format: signedPct,
      low: m.low, high: m.high, onInput: (v) => apply(v, 'input'), onChange: (v) => apply(v, 'change'), defaultValue: () => 0.5,
    });
    st.knob.dial.classList.add('macro-knob');
    return st.knob.el;
  });
  const resetMacros = () => {
    for (const st of Object.values(macroState)) {
      st.knob.set(0.5);
      st.last = 0.5;
      st.base = null;
    }
  };
  const listen = (notes) => app.audition(notes, 1.8);

  // ---- 저장·보내기 ----
  const nameId = nextId('name');
  const nameInput = h('input', { id: nameId, class: 'name-input', maxlength: '40', autocomplete: 'off' });
  nameInput.addEventListener('change', () => app.rename(nameInput.value));
  const catSelect = h('select', { 'aria-label': '분류' }, ...CATEGORIES.map((c) => h('option', { value: c.id }, c.label)));
  catSelect.addEventListener('change', () => app.setPatch({ ...app.patch, category: catSelect.value }, { phase: 'change', keepMacros: true }));
  const padSel = h('select', { 'aria-label': '올릴 무대 패드' }, ...Array.from({ length: 8 }, (_, i) => h('option', { value: i }, `패드 ${i + 1}`)));
  const trackSel = h('select', { 'aria-label': '보낼 루퍼 트랙' }, ...Array.from({ length: 4 }, (_, i) => h('option', { value: i, selected: i === 3 || null }, `트랙 ${i + 1}`)));
  const kindSelect = h('select', { 'aria-label': '랜덤으로 만들 종류' }, ...RANDOM_KINDS.map((k) => h('option', { value: k }, CATEGORIES.find((c) => c.id === k).label)));
  const importInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: nextId('imp') });
  importInput.addEventListener('change', async () => {
    const f = importInput.files?.[0];
    importInput.value = '';
    if (!f) return;
    try {
      app.setPatch(normalizePatch(JSON.parse(await f.text())), { phase: 'change', presetId: null });
      app.notice(`'${app.patch.name}' 음색을 불러왔어요.`);
    } catch {
      app.notice('음색 파일(JSON)을 읽지 못했어요. 음색 공방에서 내보낸 파일인지 확인하세요.', 'bad');
    }
  });

  const shape = h('section', { class: 'lab-shape', 'aria-label': '다듬기' },
    h('div', { class: 'lab-head' }, shapeTitle, h('div', { class: 'btn-row' }, undoBtn, resetBtn)),
    summary,
    h('div', { class: 'macro-row' }, ...macroEls),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'primary', onclick: () => listen([48, 60, 64, 67]) }, 'C 코드로 들어 보기'),
      h('button', { type: 'button', onclick: () => listen([43, 55, 59, 62]) }, 'G 코드로 들어 보기'),
      h('button', { type: 'button', onclick: () => listen([57]) }, '한 음 (A3)'),
      h('span', { class: 'bar-sep', 'aria-hidden': 'true' }),
      h('div', { class: 'joined' }, kindSelect,
        h('button', { type: 'button', onclick: () => app.setPatch(randomPatch(kindSelect.value), { phase: 'change', presetId: null }) }, '랜덤 만들기')),
      h('button', { type: 'button', title: '지금 음색을 조금씩 흔든 새 음색', onclick: () => app.setPatch(mutatePatch(app.patch, 0.3), { phase: 'change', presetId: null }) }, '변주')),
    h('div', { class: 'save-row' },
      h('div', { class: 'name-field' }, h('label', { for: nameId, class: 'label' }, '이름'), nameInput),
      catSelect,
      h('button', { type: 'button', class: 'primary', onclick: () => app.savePreset() }, '내 음색으로 저장'),
      h('div', { class: 'joined' }, padSel, h('button', { type: 'button', onclick: () => app.sendToPad(Number(padSel.value)) }, '무대 패드에 올리기')),
      h('div', { class: 'joined' }, trackSel, h('button', { type: 'button', onclick: () => app.sendToTrack(Number(trackSel.value)) }, '루퍼로 보내기')),
      h('button', {
        type: 'button', class: 'quiet', onclick: async () => {
          const json = JSON.stringify(app.patch, null, 2);
          const r = await saveFile(`${app.patch.name}.json`, json, 'application/json');
          if (r !== 'saved') app.notice((await copyText(json)) ? '파일 저장을 쓸 수 없어 JSON 을 클립보드에 복사했어요.' : '이 화면에서는 파일을 저장할 수 없어요.');
        },
      }, '파일로 내보내기'),
      h('label', { class: 'quiet file-btn', for: importInput.id }, '불러오기', importInput)));

  // =========================================================================
  // 아래: 자세히 조절
  // =========================================================================
  const ctl = controlGroup(bind);
  const flow = h('div', { class: 'flow', role: 'group', 'aria-label': '소리 흐름. 상자를 누르면 아래에서 고칠 수 있어요' });
  const editor = h('div', { class: 'node-editor' });
  const editors = {};

  // ---- 오실레이터: 배음 그리기 ----
  const oscEditor = (i) => {
    const bars = h('canvas', { class: 'harm-canvas', tabindex: '0', 'aria-label': `오실레이터 ${i + 1} 배음 24개. 끌어서 세기를 그려요. 화살표 키로도 바꿀 수 있어요` });
    const cyc = h('canvas', { class: 'cycle-canvas', 'aria-hidden': 'true' });
    const note = h('p', { class: 'panel-hint' });
    let geo = null;
    let focus = 0;
    const draw = () => {
      const o = app.patch.osc[i];
      const harm = harmonicsOf(o.wave, app.patch.custom);
      geo = drawHarmonics(bars, harm, { ghost: o.wave !== 'custom', focus: document.activeElement === bars ? focus : -1 });
      drawCycle(cyc, waveCycle(o.wave, 128, app.patch.custom));
      note.textContent = o.wave === 'custom'
        ? '직접 그린 파형이에요. 두 오실레이터가 같은 그림을 써요. 새로 누르는 음부터 바뀌어요.'
        : `지금은 '${PARAMS[`osc.${i}.wave`].labels[PARAMS[`osc.${i}.wave`].values.indexOf(o.wave)]}' 파형의 배음이에요. 막대를 끌면 이 모양에서 시작해 '직접 그림'이 돼요.`;
    };
    const paint = (index, amp, phase) => {
      const o = app.patch.osc[i];
      const custom = harmonicsOf(o.wave, app.patch.custom);
      custom[index] = amp;
      if (index === 0 && custom.every((v) => v === 0)) custom[0] = 0.001;
      const p = structuredClone(app.patch);
      p.custom = custom;
      p.osc[i].wave = 'custom';
      app.setPatch(p, { phase, keepMacros: true });
    };
    let drawing = false;
    const at = (e) => {
      const r = bars.getBoundingClientRect();
      return geo.at(e.clientX - r.left, e.clientY - r.top);
    };
    bars.addEventListener('pointerdown', (e) => {
      drawing = true;
      bars.setPointerCapture(e.pointerId);
      const { index, amp } = at(e);
      focus = index;
      paint(index, amp, 'input');
    });
    bars.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const { index, amp } = at(e);
      focus = index;
      paint(index, amp, 'input');
    });
    const end = () => { if (drawing) { drawing = false; app.setPatch(app.patch, { phase: 'change', keepMacros: true }); } };
    bars.addEventListener('pointerup', end);
    bars.addEventListener('pointercancel', end);
    bars.addEventListener('keydown', (e) => {
      const harm = harmonicsOf(app.patch.osc[i].wave, app.patch.custom);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        focus = Math.max(0, Math.min(harm.length - 1, focus + (e.key === 'ArrowLeft' ? -1 : 1)));
        draw();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const db = harm[focus] > 0 ? 20 * Math.log10(harm[focus]) : -48;
        const next = Math.min(0, db + (e.key === 'ArrowUp' ? 3 : -3));
        paint(focus, next <= -47 ? 0 : Math.round(10 ** (next / 20) * 1000) / 1000, 'change');
      } else return;
      e.preventDefault();
    });
    bars.addEventListener('focus', draw);
    bars.addEventListener('blur', draw);
    const start = (wave) => {
      const p = structuredClone(app.patch);
      p.custom = harmonicsOf(wave);
      p.osc[i].wave = 'custom';
      app.setPatch(p, { phase: 'change', keepMacros: true });
    };
    return {
      el: h('div', { class: 'node-grid' },
        panel('파형', { hint: '배음 막대를 끌어 나만의 파형을 그려요 (세로는 dB)' },
          ctl.seg(`osc.${i}.wave`, { icons: true }),
          bars, note,
          h('div', { class: 'btn-row' },
            h('span', { class: 'label' }, '여기서 시작'),
            ...[['sine', '사인'], ['sawtooth', '톱니'], ['organ', "오르간 8'·4'·2⅔'"], ['choir', "합창 '오' 모음"]].map(([w, l]) =>
              h('button', { type: 'button', class: 'chip-btn', onclick: () => start(w) }, l)))),
        panel('한 주기 · 음정 · 두께', {},
          cyc,
          ctl.knobs([`osc.${i}.octave`, `osc.${i}.semi`, `osc.${i}.detune`, `osc.${i}.level`, `osc.${i}.unison`, `osc.${i}.spread`]))),
      draw,
    };
  };
  editors.osc0 = oscEditor(0);
  editors.osc1 = oscEditor(1);
  editors.fm = { el: h('div', { class: 'node-grid' }, panel('FM · 숨소리', { hint: 'DX7 방식. 오실레이터 1의 음높이를 빠르게 흔들어 종·일렉피아노 소리를 만들어요' },
    ctl.knobs(['fm.amount', 'fm.decay', 'fm.sustain', 'noise']), ctl.seg('fm.ratio'))) };
  editors.pluck = { el: h('div', { class: 'node-grid' }, panel('줄 뜯기 (물리 모델)', { hint: '지연선 안에서 줄 진동을 계산해요. 기타·하프·피치카토' },
    ctl.knobs(['pluck.bright', 'pluck.decay', 'pluck.pick', 'pluck.body']))) };
  // ---- 오르간 · EP · 로터리 (시안 H2, view-organ.js) ----
  const organ = OrganPanels(app, bind);
  editors.organ = organ.organEditor;
  app.onFrame(organ.frame);

  // ---- 그랜드 피아노 (샘플) ----
  const pianoState = h('p', { class: 'graph-read' });
  const pianoLoad = h('button', { type: 'button', onclick: () => app.studio.library.load('grand').catch(() => {}) }, '피아노 소리 받기');
  editors.piano = {
    el: h('div', { class: 'node-grid' },
      panel('그랜드 피아노', { hint: '실제 피아노를 녹음한 소리예요. 30개 음 × 세기 3층에서 가장 가까운 것을 골라 늘려 써요' },
        pianoState, h('div', { class: 'btn-row' }, pianoLoad),
        h('p', { class: 'panel-hint credit' }, LIBRARIES.grand.credit)),
      panel('치는 느낌', { hint: '세게 칠수록 밝은 층으로 바뀌어요. 릴리즈 = 건반을 뗄 때 댐퍼가 내려오는 시간' },
        ctl.knobs(['ampEnv.r', 'volume']))),
    draw() {
      const st = app.studio.library.status('grand');
      pianoState.textContent = st.state === 'ready' ? '받아 둠 · 90개 샘플' : st.state === 'loading' ? `받는 중 ${st.done}/${st.total}` : st.state === 'error' ? '받지 못했어요. 다시 눌러 보세요' : '아직 안 받음 (약 6 MB, 처음 칠 때 자동으로 받아요)';
      pianoLoad.hidden = st.state === 'ready';
      pianoLoad.disabled = st.state === 'loading';
    },
  };
  app.on('library', () => { if (node === 'piano') editors.piano.draw(); });

  // 샘플러는 따로 탭이 아니라 '샘플' 상자를 누르면 여기 열린다 (app.js 가 채움)
  const sampleSlot = h('div', { class: 'sample-slot' });
  editors.sample = { el: sampleSlot, draw: () => app.emit('show:sampler') };

  // ---- 필터: 끄는 곡선 ----
  const qSpec = PARAMS['filter.q'];
  const fCanvas = h('canvas', { class: 'graph-canvas', 'aria-label': '필터 곡선. 금색 점을 끌면 가로는 차단 주파수, 세로는 레조넌스' });
  const fRead = h('p', { class: 'graph-read' });
  let fDrag = false;
  const fPointer = (e, phase) => {
    const r = fCanvas.getBoundingClientRect();
    const cutoff = Math.min(18000, Math.max(40, 20 * 1000 ** ((e.clientX - r.left) / r.width)));
    const q = fromUnit(qSpec, 1 - (e.clientY - r.top - 8) / (r.height - 16));
    const p = structuredClone(app.patch);
    p.filter.cutoff = cutoff;
    p.filter.q = q;
    app.setPatch(p, { phase, keepMacros: true });
  };
  fCanvas.addEventListener('pointerdown', (e) => { fDrag = true; fCanvas.setPointerCapture(e.pointerId); fPointer(e, 'input'); });
  fCanvas.addEventListener('pointermove', (e) => fDrag && fPointer(e, 'input'));
  const fEnd = (e) => { if (fDrag) { fDrag = false; fPointer(e, 'change'); } };
  fCanvas.addEventListener('pointerup', fEnd);
  fCanvas.addEventListener('pointercancel', () => { fDrag = false; });

  // ---- 엔벨로프: 꼭짓점 끌기 ----
  const adsrEditor = (key, accent, title, hint) => {
    const canvas = h('canvas', { class: 'graph-canvas', 'aria-label': `${title}. 꼭짓점 A·D·S·R 을 끌어 바꿔요` });
    const read = h('p', { class: 'graph-read' });
    const unit = (k, v) => toUnit(PARAMS[`${key}.${k}`], v);
    let lay = null;
    let grab = null;
    const draw = () => {
      lay = drawAdsr(canvas, app.patch[key], unit, accent);
      const e = app.patch[key];
      read.textContent = `A ${formatValue(`${key}.a`, e.a)} · D ${formatValue(`${key}.d`, e.d)} · S ${formatValue(`${key}.s`, e.s)} · R ${formatValue(`${key}.r`, e.r)}`;
    };
    const move = (e, phase) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const { pad, seg, top, bottom, xA, xS } = lay.geo;
      const p = structuredClone(app.patch);
      const env = p[key];
      const sOf = () => Math.min(1, Math.max(0, (bottom - y) / (bottom - top)));
      if (grab === 'a') env.a = fromUnit(PARAMS[`${key}.a`], (x - pad) / seg);
      if (grab === 'd') { env.d = fromUnit(PARAMS[`${key}.d`], (x - xA) / seg); env.s = sOf(); }
      if (grab === 's') env.s = sOf();
      if (grab === 'r') env.r = fromUnit(PARAMS[`${key}.r`], (x - xS) / seg);
      app.setPatch(p, { phase, keepMacros: true });
    };
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      let best = null;
      for (const [k, [hx, hy]] of Object.entries(lay.handles)) {
        const d = Math.hypot(hx - x, hy - y);
        if (d < 26 && (!best || d < best.d)) best = { k, d };
      }
      if (!best) return;
      grab = best.k;
      canvas.setPointerCapture(e.pointerId);
      move(e, 'input');
    });
    canvas.addEventListener('pointermove', (e) => grab && move(e, 'input'));
    const end = (e) => { if (grab) { move(e, 'change'); grab = null; } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => { grab = null; });
    return {
      el: panel(title, { hint }, canvas, read, ctl.knobs([`${key}.a`, `${key}.d`, `${key}.s`, `${key}.r`])),
      draw,
    };
  };
  const filterEnv = adsrEditor('filterEnv', 'signal', '필터 엔벨로프', '누른 뒤 필터가 열렸다 닫히는 모양');
  const ampEnv = adsrEditor('ampEnv', 'brass', '볼륨 엔벨로프', '패드는 어택·릴리즈를 길게, 건반은 짧게');
  editors.filter = {
    el: h('div', { class: 'node-grid' },
      panel('필터', { hint: '금색 점을 끌어요. 가로는 차단 주파수, 세로는 레조넌스' },
        fCanvas, fRead, ctl.seg('filter.type'), ctl.knobs(['filter.cutoff', 'filter.q', 'filter.env', 'filter.keytrack'])),
      filterEnv.el),
    draw: () => {
      drawFilterEditor(fCanvas, app.patch.filter, toUnit(qSpec, app.patch.filter.q));
      fRead.textContent = `${formatValue('filter.cutoff', app.patch.filter.cutoff)} · 레조넌스 ${formatValue('filter.q', app.patch.filter.q)}`;
      filterEnv.draw();
    },
  };
  editors.amp = {
    el: h('div', { class: 'node-grid' }, ampEnv.el,
      panel('연주', {}, ctl.add('mono'), ctl.knobs(['glide', 'volume'])),
      panel('피치 엔벨로프', { hint: '누른 순간 음 높이가 벗어났다 돌아와요. 808 베이스(+12, 짧게)·떨어지는 효과음(−24)' },
        ctl.knobs(['pitch.amt', 'pitch.decay']))),
    draw: ampEnv.draw,
  };
  editors.lfo = { el: h('div', { class: 'node-grid' }, panel('LFO (느린 흔들림)', { hint: '비브라토·와우·트레몰로. 늦게 시작하면 바이올린처럼 자연스러워요' },
    ctl.seg('lfo.target'), ctl.knobs(['lfo.rate', 'lfo.depth', 'lfo.delay']))) };
  editors.fx = organ.fxEditor;

  const sourceSeg = ctl.seg('source', { label: '소리 재료' });
  const detail = h('section', { class: 'lab-detail', 'aria-labelledby': 'lab-detail-h' },
    h('div', { class: 'lab-head' }, h('h2', { id: 'lab-detail-h' }, '자세히 조절'), h('p', { class: 'panel-hint' }, '소리 흐름의 상자를 눌러 고칠 곳을 고르세요.')),
    sourceSeg,
    h('div', { class: 'flow-wrap' }, flow),
    editor);

  const hybrid = HybridSection(app, { padSelect: padSel });
  root.append(h('div', { class: 'lab' }, pick, hybrid.el, shape, detail));

  // ---- 소리 흐름 그림 ----
  function flowNodes() {
    const p = app.patch;
    const f = (path) => formatValue(path, path.split('.').reduce((o, k) => o[k], p));
    const waveLabel = (i) => PARAMS[`osc.${i}.wave`].labels[PARAMS[`osc.${i}.wave`].values.indexOf(p.osc[i].wave)];
    const sources = p.source === 'synth'
      ? [
        { id: 'osc0', title: '오실레이터 1', value: `${waveLabel(0)} ×${p.osc[0].unison}` },
        { id: 'osc1', title: '오실레이터 2', value: p.osc[1].level > 0.001 ? `${waveLabel(1)} · ${f('osc.1.level')}` : '꺼짐' },
        { id: 'fm', title: 'FM · 숨소리', value: p.fm.amount > 0.001 || p.noise > 0.001 ? `FM ${f('fm.amount')} · 숨 ${f('noise')}` : '꺼짐' },
      ]
      : p.source === 'pluck'
        ? [{ id: 'pluck', title: '줄 뜯기', value: `울림 ${f('pluck.decay')}` }]
        : p.source === 'organ'
          ? [{ id: 'organ', title: '오르간 드로바', value: `${regOf(p.organ.bars)}${p.organ.perc !== 'off' ? ` · 퍼커션 ${f('organ.perc')}` : ''}` }]
          : p.source === 'piano'
            ? [{ id: 'piano', title: '그랜드 피아노', value: app.studio.library.status('grand').state === 'ready' ? '샘플 90개' : '처음 칠 때 받음' }]
            : [{ id: 'sample', title: '샘플', value: app.sample ? app.sample.name : '없음' }];
    const chain = [
      { id: 'filter', title: '필터', value: `${p.filter.type === 'lowpass' ? 'LP' : p.filter.type === 'highpass' ? 'HP' : 'BP'} ${f('filter.cutoff')}` },
      { id: 'amp', title: '볼륨', value: `A ${f('ampEnv.a')} · R ${f('ampEnv.r')}` },
      { id: 'fx', title: '이펙트', value: [`잔향 ${f('fx.reverb')}`, p.fx.rotary > 0.001 ? `로터리 ${p.fx.rotaryFast ? '빠름' : '느림'}` : null, p.fx.shimmer > 0.001 ? '시머' : null, p.fx.trem > 0.001 ? '트레몰로' : null, p.fx.phaser > 0.001 ? '페이저' : null, p.fx.lofi > 0.001 || p.fx.bits < 16 ? '로파이' : null].filter(Boolean).slice(0, 3).join(' · ') },
    ];
    const split = p.keys.lo > 0 || p.keys.hi < 127 || p.layers.some((l) => l.lo > 0 || l.hi < 127);
    return {
      sources,
      chain,
      lfo: { id: 'lfo', title: 'LFO', value: p.lfo.depth > 0.001 ? `${f('lfo.target')} ${f('lfo.rate')}` : '꺼짐' },
      layers: { id: 'layers', title: '겹치기·나누기', value: p.layers.length ? `${p.layers.map((l) => l.patch.name).join(' + ')}${split ? ' · 나눔' : ''}` : '혼자' },
    };
  }

  const nodeBtn = (n) => h('button', {
    type: 'button', class: 'flow-node', 'aria-pressed': String(node === n.id),
    // 겹치기·나누기는 위의 하이브리드 구역으로 옮겨 간다
    onclick: () => { if (n.id === 'layers') { hybrid.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } node = n.id; renderDetail(); },
  }, h('span', { class: 'flow-title' }, n.title), h('span', { class: 'flow-value' }, n.value));

  function renderFlow() {
    const { sources, chain, lfo, layers } = flowNodes();
    flow.replaceChildren(
      h('div', { class: 'flow-row' },
        h('div', { class: 'flow-sources' }, ...sources.map(nodeBtn)),
        sources.length > 1 ? h('span', { class: 'flow-join' }, '섞기') : null,
        ...chain.flatMap((n) => [h('span', { class: 'flow-arrow', 'aria-hidden': 'true' }), nodeBtn(n)]),
        h('span', { class: 'flow-arrow', 'aria-hidden': 'true' }),
        h('span', { class: 'flow-out' }, '출력')),
      h('div', { class: 'flow-lfo' }, nodeBtn(lfo), h('span', { class: 'flow-dash' }, '음정·필터·볼륨 중 한 곳을 천천히 흔들어요')),
      h('div', { class: 'flow-lfo' }, nodeBtn(layers), h('span', { class: 'flow-dash' }, '다른 음색을 겹치거나 건반을 왼손·오른손으로 나눠요')));
  }

  function renderDetail() {
    const p = app.patch;
    const sourceNodes = p.source === 'synth' ? ['osc0', 'osc1', 'fm'] : [p.source];
    // 소리 재료를 바꾸면 그 재료의 상자를 바로 연다 (샘플이면 샘플러)
    if (p.source !== lastSource) {
      lastSource = p.source;
      node = sourceNodes[0];
    }
    if (!sourceNodes.includes(node) && !['filter', 'amp', 'fx', 'lfo'].includes(node)) node = sourceNodes[0];
    renderFlow();
    const ed = editors[node];
    if (editor.firstChild !== ed.el) editor.replaceChildren(ed.el);
    requestAnimationFrame(() => ed.draw?.());
  }

  function sync({ keepMacros, phase } = {}) {
    const p = app.patch;
    ctl.sync();
    organ.sync();
    editors[node]?.draw?.();
    summary.replaceChildren(h('span', { class: 'summary-label' }, '지금 소리 '), ...describePatch(p).map((x) => (x.strong ? h('strong', {}, x.text) : x.text)));
    if (phase === 'input') {
      hybrid.draw();
      return;
    }
    hybrid.render();
    shapeTitle.textContent = `${p.name} 다듬기`;
    if (document.activeElement !== nameInput) nameInput.value = p.name;
    catSelect.value = p.category;
    undoBtn.disabled = !app.history.length;
    resetBtn.disabled = !app.findPreset(app.presetId);
    if (!keepMacros) resetMacros();
    renderPick();
    renderDetail();
  }

  app.on('patch', sync);
  app.on('presets', renderPick);
  app.on('sample', () => renderFlow());
  app.on('resize', () => { editors[node]?.draw?.(); hybrid.draw(); });
  app.on('show:lab', () => requestAnimationFrame(() => sync({ keepMacros: true })));
  sync();
  return {
    sync,
    sampleSlot,
    /** 다른 곳(옛 #sampler 주소 등)에서 샘플 편집을 바로 열 때 */
    openSample() {
      if (app.patch.source !== 'sample') app.setParam('source', 'sample', 'change');
      node = 'sample';
      renderDetail();
      detail.scrollIntoView?.({ block: 'start' });
    },
  };
}
