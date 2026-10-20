// 음색 만들기 화면: 프리셋 서랍, 도우미 슬라이더, 모듈(오실레이터·FM·줄·필터·엔벨로프·LFO·이펙트).
import { CATEGORIES, MACROS, RANDOM_KINDS, SOURCES, applyMacro, normalizePatch, randomPatch, mutatePatch } from './patch.js';
import { FACTORY } from './presets.js';
import { h, panel, controlGroup, nextId } from './ui.js';
import { drawEnvelope, drawFilter } from './draw.js';
import { saveFile, copyText } from './store.js';

export function SynthView(root, app) {
  const bind = { get: () => app.patch, set: (path, v, phase) => app.setParam(path, v, phase) };
  const ctl = controlGroup(bind);
  const canvases = {};
  const sourcePanels = {};

  // ---- 프리셋 서랍 ----
  const library = h('aside', { class: 'library', 'aria-label': '음색 목록' });
  function renderLibrary() {
    const groups = [];
    if (app.userPresets.length) {
      groups.push(h('div', { class: 'lib-group' }, h('h4', {}, '내 음색'),
        h('ul', {}, ...app.userPresets.map((u) => h('li', {},
          h('button', { type: 'button', class: 'lib-item', 'aria-current': String(app.presetId === u.id), onclick: () => app.loadPreset(u) }, u.patch.name),
          h('button', { type: 'button', class: 'lib-del', 'aria-label': `${u.patch.name} 지우기`, onclick: () => app.deletePreset(u.id) }, '×'))))));
    }
    for (const c of CATEGORIES) {
      const items = FACTORY.filter((f) => f.patch.category === c.id);
      if (!items.length) continue;
      groups.push(h('div', { class: 'lib-group' }, h('h4', {}, c.label),
        h('ul', {}, ...items.map((f) => h('li', {},
          h('button', { type: 'button', class: 'lib-item', 'aria-current': String(app.presetId === f.id), onclick: () => app.loadPreset(f) }, f.patch.name))))));
    }
    library.replaceChildren(h('h3', { class: 'lib-title' }, '음색 서랍'), ...groups);
  }

  // ---- 위쪽 막대: 이름·저장·되돌리기·랜덤·변주·내보내기 ----
  const nameId = nextId('name');
  const nameInput = h('input', { id: nameId, class: 'name-input', maxlength: '40', autocomplete: 'off' });
  nameInput.addEventListener('change', () => app.rename(nameInput.value));
  const catSelect = h('select', { 'aria-label': '분류' }, ...CATEGORIES.map((c) => h('option', { value: c.id }, c.label)));
  catSelect.addEventListener('change', () => app.setPatch({ ...app.patch, category: catSelect.value }, { phase: 'change' }));
  const kindSelect = h('select', { 'aria-label': '랜덤으로 만들 종류' }, ...RANDOM_KINDS.map((k) => h('option', { value: k }, CATEGORIES.find((c) => c.id === k).label)));
  const undoBtn = h('button', { type: 'button', class: 'quiet', onclick: () => app.undo() }, '되돌리기');
  const importInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: nextId('imp') });
  importInput.addEventListener('change', async () => {
    const f = importInput.files?.[0];
    if (!f) return;
    try {
      app.setPatch(normalizePatch(JSON.parse(await f.text())), { phase: 'change', presetId: null });
      app.notice(`'${app.patch.name}' 음색을 불러왔어요.`);
    } catch {
      app.notice('음색 파일(JSON)을 읽지 못했어요. 음색 공방에서 내보낸 파일인지 확인하세요.', 'bad');
    }
    importInput.value = '';
  });
  const bar = h('div', { class: 'patch-bar' },
    h('div', { class: 'name-field' }, h('label', { for: nameId, class: 'label' }, '음색 이름'), nameInput),
    catSelect,
    h('button', { type: 'button', class: 'primary', onclick: () => app.savePreset() }, '내 음색으로 저장'),
    undoBtn,
    h('span', { class: 'bar-sep', 'aria-hidden': 'true' }),
    h('div', { class: 'joined' },
      kindSelect,
      h('button', { type: 'button', onclick: () => app.setPatch(randomPatch(kindSelect.value), { phase: 'change', presetId: null }) }, '랜덤 만들기')),
    h('button', { type: 'button', onclick: () => app.setPatch(mutatePatch(app.patch, 0.3), { phase: 'change', presetId: null }), title: '지금 음색을 조금씩 흔든 새 음색' }, '변주'),
    h('span', { class: 'bar-sep', 'aria-hidden': 'true' }),
    h('button', {
      type: 'button', class: 'quiet', onclick: async () => {
        const json = JSON.stringify(app.patch, null, 2);
        const r = await saveFile(`${app.patch.name}.json`, json, 'application/json');
        if (r !== 'saved') app.notice((await copyText(json)) ? '파일 저장을 쓸 수 없어 JSON 을 클립보드에 복사했어요.' : '이 화면에서는 파일을 저장할 수 없어요.');
      },
    }, '파일로 내보내기'),
    h('label', { class: 'quiet file-btn', for: importInput.id }, '불러오기', importInput));

  // ---- 도우미 슬라이더 ----
  const macroState = {};
  const macroEls = MACROS.map((m) => {
    const id = nextId('macro');
    const input = h('input', { type: 'range', id, min: 0, max: 1000, value: 500, class: 'macro-range' });
    const st = (macroState[m.id] = { input, base: null, startPos: 0.5 });
    input.addEventListener('input', () => {
      const v = Number(input.value) / 1000;
      if (!st.base) {
        st.base = app.patch;
        st.startPos = st.last ?? 0.5;
      }
      app.setPatch(applyMacro(st.base, m.id, 0.5 + v - st.startPos), { phase: 'input', keepMacros: true });
    });
    input.addEventListener('change', () => {
      st.last = Number(input.value) / 1000;
      st.base = null;
      app.setPatch(app.patch, { phase: 'change', keepMacros: true });
    });
    return h('div', { class: 'macro' },
      h('label', { for: id }, m.label),
      input,
      h('div', { class: 'macro-ends', 'aria-hidden': 'true' }, h('span', {}, m.low), h('span', {}, m.high)));
  });
  const resetMacros = () => {
    for (const st of Object.values(macroState)) {
      st.input.value = 500;
      st.last = 0.5;
      st.base = null;
    }
  };

  // ---- 모듈 ----
  const sourceHint = h('p', { class: 'source-hint' });
  const toSampler = h('button', { type: 'button', class: 'link-btn', onclick: () => app.showTab('sampler') }, '샘플러 화면으로 →');
  const envCanvas = (key) => (canvases[key] = h('canvas', { class: 'env-canvas', 'aria-hidden': 'true' }));
  const modules = h('div', { class: 'modules' },
    panel('소리 재료', { cls: 'span-wide' }, ctl.seg('source'), sourceHint, toSampler),
    (sourcePanels.osc0 = panel('오실레이터 1', { hint: '기본 소리. 겹치기를 늘리면 합창처럼 두꺼워짐' },
      ctl.seg('osc.0.wave', { icons: true }), ctl.add('osc.0.octave'), ctl.add('osc.0.semi'), ctl.add('osc.0.detune'),
      ctl.add('osc.0.level'), ctl.add('osc.0.unison'), ctl.add('osc.0.spread'))),
    (sourcePanels.osc1 = panel('오실레이터 2', { hint: '아래 옥타브·5도로 두께를 더할 때' },
      ctl.seg('osc.1.wave', { icons: true }), ctl.add('osc.1.octave'), ctl.add('osc.1.semi'), ctl.add('osc.1.detune'),
      ctl.add('osc.1.level'), ctl.add('osc.1.unison'), ctl.add('osc.1.spread'))),
    (sourcePanels.fm = panel('FM · 숨소리', { hint: 'DX7 방식. 오실레이터 1의 음높이를 빠르게 흔들어 종·일렉피아노 소리' },
      ctl.add('fm.amount'), ctl.seg('fm.ratio'), ctl.add('fm.decay'), ctl.add('fm.sustain'), ctl.add('noise'))),
    (sourcePanels.pluck = panel('줄 뜯기 (물리 모델)', { hint: '지연선 안에서 줄 진동을 계산. 기타·하프·피치카토' },
      ctl.add('pluck.bright'), ctl.add('pluck.decay'), ctl.add('pluck.pick'), ctl.add('pluck.body'))),
    panel('필터', { hint: '밝기를 깎는 곳. 레조넌스를 올리면 차단 주파수 근처가 솟음' },
      (canvases.filter = h('canvas', { class: 'env-canvas', 'aria-hidden': 'true' })),
      ctl.seg('filter.type'), ctl.add('filter.cutoff'), ctl.add('filter.q'), ctl.add('filter.env'), ctl.add('filter.keytrack')),
    panel('필터 엔벨로프', { hint: '누른 뒤 필터가 열렸다 닫히는 모양' },
      envCanvas('filterEnv'), ctl.add('filterEnv.a'), ctl.add('filterEnv.d'), ctl.add('filterEnv.s'), ctl.add('filterEnv.r')),
    panel('볼륨 엔벨로프', { hint: '패드는 어택·릴리즈를 길게, 건반은 짧게' },
      envCanvas('ampEnv'), ctl.add('ampEnv.a'), ctl.add('ampEnv.d'), ctl.add('ampEnv.s'), ctl.add('ampEnv.r')),
    panel('LFO (느린 흔들림)', { hint: '비브라토·와우·트레몰로. 늦게 시작하면 바이올린처럼 자연스러움' },
      ctl.seg('lfo.target'), ctl.add('lfo.rate'), ctl.add('lfo.depth'), ctl.add('lfo.delay')),
    panel('이펙트', { hint: '딜레이 간격은 루퍼의 BPM 을 따름' },
      ctl.add('fx.drive'), ctl.add('fx.chorus'), ctl.add('fx.delay'), ctl.seg('fx.delayBeats'), ctl.add('fx.feedback'),
      ctl.add('fx.reverb'), ctl.add('fx.size')),
    panel('연주', {}, ctl.add('mono'), ctl.add('glide'), ctl.add('volume')));

  root.append(h('div', { class: 'synth-layout' }, library,
    h('div', { class: 'editor' }, bar, h('section', { class: 'macros', 'aria-label': '도우미 슬라이더' },
      h('div', { class: 'macros-head' }, h('h3', {}, '도우미'), h('p', {}, '가운데가 지금 소리. 좌우로 밀면 여러 값이 함께 움직여요.')),
      h('div', { class: 'macro-row' }, ...macroEls)), modules)));

  function redraw() {
    const p = app.patch;
    drawEnvelope(canvases.ampEnv, p.ampEnv, 'brass');
    drawEnvelope(canvases.filterEnv, p.filterEnv, 'signal');
    drawFilter(canvases.filter, p.filter);
  }

  function sync({ keepMacros, phase } = {}) {
    const p = app.patch;
    ctl.sync();
    redraw();
    if (phase === 'input') return;
    if (document.activeElement !== nameInput) nameInput.value = p.name;
    catSelect.value = p.category;
    undoBtn.disabled = !app.history.length;
    const s = SOURCES.find((x) => x.id === p.source);
    sourceHint.textContent = p.source === 'sample'
      ? (app.sample ? `샘플: ${app.sample.name} (기준 음 ${app.sample.rootName})` : '아직 샘플이 없어요. 샘플러에서 파일·데모·녹음을 불러오세요.')
      : s.hint;
    toSampler.hidden = p.source !== 'sample';
    for (const k of ['osc0', 'osc1', 'fm']) sourcePanels[k].hidden = p.source !== 'synth';
    sourcePanels.pluck.hidden = p.source !== 'pluck';
    if (!keepMacros) resetMacros();
    renderLibrary();
  }

  app.on('patch', sync);
  app.on('presets', renderLibrary);
  app.on('sample', () => sync({ keepMacros: true }));
  app.on('resize', redraw);
  sync();
  return { sync };
}
