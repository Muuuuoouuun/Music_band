// 하이브리드 — 한 음색에 소리 셋 (시안 H1): 실험실에서 음색 카드 바로 아래.
// 건반 띠(막대 끝을 끌어 범위, 흰 점선을 끌어 나누는 점), 파트 카드 3장(켬·음색·볼륨·옥타브·범위),
// 빨리 고르기(자주 쓰는 겹치기 4개), 지금 소리(한 문장 + 들어 보기·저장·무대 패드).
import { h, knob } from './ui.js';
import { drawKeyStrip } from './draw.js';
import { normalizePatch, normalizeLayer, MAX_LAYERS, SOURCES } from './patch.js';
import { FACTORY, factoryById } from './presets.js';
import { noteName } from './tuning.js';

const PART_COLORS = ['brass', 'signal', 'rose'];
const QUICK = ['piano-pad', 'rhodes-strings', 'organ-pad', 'split-bass-piano'];
const clampKey = (m) => Math.max(0, Math.min(127, m));
const rangeText = (lo, hi) => `${lo <= 21 ? 'A0' : noteName(lo)}–${hi >= 108 ? 'C8' : noteName(hi)}`;

/** 파트의 역할: 메인은 오른손(나눴을 때)·전체, 겹친 음색은 왼손·위쪽·위에 깔기 */
function roleOf(part, main, isMain, split) {
  if (isMain) return split ? '오른손' : '전체 건반';
  if (part.hi < main.lo) return '왼손';
  if (part.lo > main.hi) return '오른손 위쪽';
  return '위에 깔기';
}

export function HybridSection(app, { padSelect }) {
  const strip = h('canvas', { class: 'keystrip-canvas', tabindex: '0', role: 'img', 'aria-label': '건반 띠: 파트마다 소리 나는 범위. 막대 양 끝을 끌어 범위를, 흰 점선을 끌어 나누는 점을 옮겨요. 화살표 키로 나누는 점을 반음씩' });
  const cards = h('div', { class: 'part-cards' });
  const quick = h('div', { class: 'quick-cards' });
  const now = h('p', { class: 'hybrid-now', 'aria-live': 'polite' });
  const splitBtn = h('button', { type: 'button', class: 'toggle small' });
  const addBtn = h('button', { type: 'button', class: 'small' }, '+ 음색 겹치기');
  const addSel = h('select', { 'aria-label': '겹칠 음색', class: 'small' });

  const parts = () => {
    const p = app.patch;
    return [
      { lo: p.keys.lo, hi: p.keys.hi, on: true, name: p.name, main: true },
      ...p.layers.map((l) => ({ lo: l.lo, hi: l.hi, on: l.on, name: l.patch.name, level: l.level })),
    ];
  };
  /** 메인과 겹친 음색 하나가 맞닿아 있으면 그 경계가 나누는 점 */
  const splitPoint = () => {
    const p = app.patch;
    const k = p.layers.findIndex((l) => l.hi + 1 === p.keys.lo && p.keys.lo > 21);
    return k >= 0 ? { at: p.keys.lo, layer: k } : null;
  };
  const sources = () => [
    ...app.userPresets.filter((u) => !u.patch.layers.length).map((u) => ({ id: u.id, name: `${u.patch.name} (내 음색)`, patch: u.patch })),
    ...FACTORY.filter((f) => !f.patch.layers.length).map((f) => ({ id: f.id, name: f.patch.name, patch: f.patch })),
  ];
  const commit = (patch, phase = 'change') => app.setPatch(normalizePatch(patch), { phase, keepMacros: true });
  const setLayer = (i, change, phase) => commit({ ...app.patch, layers: app.patch.layers.map((l, k) => (k === i ? { ...l, ...change } : l)) }, phase);
  const setKeys = (change, phase) => commit({ ...app.patch, keys: { ...app.patch.keys, ...change } }, phase);
  const setRange = (i, lo, hi, phase) => (i === 0 ? setKeys({ lo, hi }, phase) : setLayer(i - 1, { lo, hi }, phase));

  function addLayer(id, opts = {}) {
    if (app.patch.layers.length >= MAX_LAYERS) {
      app.notice(`겹칠 수 있는 음색은 ${MAX_LAYERS}개까지예요 (메인 + ${MAX_LAYERS}).`, 'bad');
      return;
    }
    const src = sources().find((x) => x.id === id);
    if (src) commit({ ...app.patch, layers: [...app.patch.layers, normalizeLayer({ preset: id, patch: src.patch, level: 0.45, ...opts })] });
  }
  addBtn.addEventListener('click', () => addLayer(addSel.value));
  splitBtn.addEventListener('click', () => {
    const sp = splitPoint();
    if (sp) {
      // 나누기 풀기: 모두 전체 건반으로
      commit({ ...app.patch, keys: { ...app.patch.keys, lo: 0, hi: 127 }, layers: app.patch.layers.map((l) => ({ ...l, lo: 0, hi: 127 })) });
    } else if (app.patch.layers.length) {
      // 마지막 겹친 음색을 왼손(C4 아래)으로
      const k = app.patch.layers.length - 1;
      commit({ ...app.patch, keys: { ...app.patch.keys, lo: 60 }, layers: app.patch.layers.map((l, i) => (i === k ? { ...l, lo: 0, hi: 59 } : l)) });
    } else {
      const bass = factoryById('moog-bass');
      commit({ ...app.patch, keys: { ...app.patch.keys, lo: 60, hi: 127 }, layers: [{ preset: bass.id, patch: bass.patch, level: 0.85, lo: 0, hi: 59 }] });
    }
  });

  // ---- 건반 띠 끌기 ----
  let geo = null;
  let drag = null;
  strip.addEventListener('pointerdown', (e) => {
    if (!geo) return;
    const r = strip.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const sp = splitPoint();
    if (sp && geo.splitX != null && Math.abs(x - geo.splitX) < 9 && y > geo.keyTop - 8) drag = { kind: 'split', layer: sp.layer };
    else {
      const row = geo.rows.find((rw) => y >= rw.y0 - 3 && y <= rw.y1 + 3);
      if (!row) return;
      if (Math.abs(x - row.x0) < 10) drag = { kind: 'lo', index: row.index };
      else if (Math.abs(x - row.x1) < 10) drag = { kind: 'hi', index: row.index };
      else if (sp && geo.splitX != null && Math.abs(x - geo.splitX) < 9) drag = { kind: 'split', layer: sp.layer };
      else return;
    }
    e.preventDefault();
    strip.setPointerCapture(e.pointerId);
  });
  strip.addEventListener('pointermove', (e) => {
    if (!drag || !geo) return;
    const x = e.clientX - strip.getBoundingClientRect().left;
    const list = parts();
    if (drag.kind === 'split') {
      const at = Math.max(22, geo.nearest(x, 'lo'));
      if (at === app.patch.keys.lo) return;
      commit({ ...app.patch, keys: { ...app.patch.keys, lo: at }, layers: app.patch.layers.map((ly, k) => (k === drag.layer ? { ...ly, hi: at - 1, lo: Math.min(ly.lo, at - 1) } : ly)) }, 'input');
    } else {
      const p = list[drag.index];
      if (drag.kind === 'lo') {
        const lo = geo.nearest(x, 'lo');
        if (lo !== p.lo && lo <= p.hi) setRange(drag.index, lo <= 21 ? 0 : lo, p.hi, 'input');
      } else {
        const hi = geo.nearest(x, 'hi');
        if (hi !== p.hi && hi >= p.lo) setRange(drag.index, p.lo, hi >= 108 ? 127 : hi, 'input');
      }
    }
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    commit(app.patch, 'change');
  };
  strip.addEventListener('pointerup', endDrag);
  strip.addEventListener('pointercancel', endDrag);
  strip.addEventListener('keydown', (e) => {
    const sp = splitPoint();
    if (!sp || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const at = Math.max(22, Math.min(108, sp.at + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 12 : 1)));
    commit({ ...app.patch, keys: { ...app.patch.keys, lo: at }, layers: app.patch.layers.map((ly, k) => (k === sp.layer ? { ...ly, hi: at - 1, lo: Math.min(ly.lo, at - 1) } : ly)) });
  });

  // ---- 파트 카드 ----
  function partCard(i) {
    const p = app.patch;
    const main = i === 0;
    const l = main ? null : p.layers[i - 1];
    const lo = main ? p.keys.lo : l.lo;
    const hi = main ? p.keys.hi : l.hi;
    const role = roleOf({ lo, hi }, { lo: p.keys.lo, hi: p.keys.hi }, main, p.keys.lo > 21 || p.keys.hi < 108);
    const on = main || l.on;
    const color = PART_COLORS[i];
    const onBtn = main ? h('span', { class: 'part-badge' }, '메인')
      : h('button', { type: 'button', class: 'part-on', 'aria-pressed': String(on), 'aria-label': `${i + 1}번 파트 켜기·끄기`, onclick: () => setLayer(i - 1, { on: !on }) }, h('span', { class: 'led', 'aria-hidden': 'true' }), on ? '켬' : '끔');
    // 음색 고르기
    const sel = h('select', { class: 'part-sound', 'aria-label': `${i + 1}번 파트 음색` });
    if (main) {
      sel.append(h('option', { value: '' }, p.name));
      sel.disabled = false;
      for (const s of sources()) sel.append(h('option', { value: s.id }, s.name));
      sel.addEventListener('change', () => {
        const s = sources().find((x) => x.id === sel.value);
        // 메인을 바꾸면 겹친 음색·범위는 그대로 두고 소리만 바꾼다
        if (s) commit({ ...s.patch, name: p.layers.length ? `${s.patch.name} + 겹침` : s.patch.name, keys: p.keys, layers: p.layers });
      });
    } else {
      for (const s of sources()) sel.append(h('option', { value: s.id, selected: s.id === l.preset || null }, s.name));
      if (!sources().some((s) => s.id === l.preset)) sel.prepend(h('option', { value: '', selected: true }, l.patch.name));
      sel.addEventListener('change', () => {
        const s = sources().find((x) => x.id === sel.value);
        if (s) setLayer(i - 1, { preset: s.id, patch: s.patch });
      });
    }
    const vol = knob({
      label: '볼륨', ariaLabel: `${i + 1}번 파트 볼륨`, min: 0, max: 1, value: main ? p.volume : l.level, tone: color === 'signal' ? 'signal' : 'brass',
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => (main ? app.setParam('volume', v, 'input') : setLayer(i - 1, { level: v }, 'input')),
      onChange: (v) => (main ? app.setParam('volume', v, 'change') : setLayer(i - 1, { level: v })),
      defaultValue: () => (main ? 0.8 : 0.5),
    });
    vol.el.classList.add(`knob-${color}`);
    const oct = main ? p.keys.octave : l.octave;
    const octSeg = h('div', { class: 'seg oct-seg', role: 'group', 'aria-label': `${i + 1}번 파트 옥타브` },
      ...[-2, -1, 0, 1, 2].map((o) => h('button', {
        type: 'button', class: 'seg-btn', 'aria-pressed': String(o === oct),
        onclick: () => (main ? app.setParam('keys.octave', o, 'change') : setLayer(i - 1, { octave: o })),
      }, o > 0 ? `+${o}` : String(o))));
    const move = (d) => {
      const nlo = clampKey(lo + d);
      const nhi = clampKey(hi + d);
      if (nhi - nlo === hi - lo) setRange(i, nlo, nhi, 'change');
    };
    const range = h('div', { class: 'range-step' },
      h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `${i + 1}번 파트 범위를 한 옥타브 아래로`, onclick: () => move(-12) }, '◀'),
      h('output', {}, rangeText(lo, hi)),
      h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `${i + 1}번 파트 범위를 한 옥타브 위로`, onclick: () => move(12) }, '▶'));
    const src = main ? p : l.patch;
    const hint = main
      ? (p.source === 'piano' ? '세기 층 3개 샘플 · 페달은 건반 띠의 홀드' : SOURCES.find((s) => s.id === p.source)?.hint ?? '')
      : (FACTORY.find((f) => f.id === l.preset)?.desc ?? `${l.patch.name}`);
    return h('section', { class: `part-card2 part-${color}${on ? '' : ' is-off'}`, 'aria-label': `${i + 1}번 파트` },
      h('div', { class: 'part-top' },
        h('span', { class: 'part-no' }, String(i + 1)), h('span', { class: 'part-role' }, role),
        main ? onBtn : h('span', { class: 'part-badge quiet' }, '겹침'),
        main ? null : onBtn,
        main ? null : h('button', { type: 'button', class: 'quiet small part-del', onclick: () => commit({ ...app.patch, layers: app.patch.layers.filter((_, k) => k !== i - 1) }) }, '빼기')),
      sel,
      h('div', { class: 'part-body2' }, vol.el,
        h('div', { class: 'part-ctl' }, h('span', { class: 'label' }, '옥타브'), octSeg, h('span', { class: 'label' }, '건반 범위'), range)),
      h('p', { class: 'panel-hint' }, hint || src.name));
  }

  // ---- 빨리 고르기 ----
  const thumb = (patch) => {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 180 26');
    svg.setAttribute('class', 'quick-thumb');
    svg.setAttribute('aria-hidden', 'true');
    const xOf = (m) => ((Math.max(21, Math.min(108, m)) - 21) / 87) * 180;
    for (let k = 0; k < 52; k++) {
      const r = document.createElementNS(svgNS, 'rect');
      Object.entries({ x: k * (180 / 52), y: 0, width: 180 / 52 - 0.6, height: 26, class: 'qt-key' }).forEach(([a, v]) => r.setAttribute(a, v));
      svg.append(r);
    }
    const bars = [{ lo: patch.keys.lo, hi: patch.keys.hi, c: PART_COLORS[0] }, ...patch.layers.map((l, i) => ({ lo: l.lo, hi: l.hi, c: PART_COLORS[i + 1] }))];
    bars.forEach((b, i) => {
      const r = document.createElementNS(svgNS, 'rect');
      Object.entries({ x: xOf(b.lo), y: 8 + i * 6, width: Math.max(3, xOf(b.hi) - xOf(b.lo)), height: 4, class: `qt-bar qt-${b.c}` }).forEach(([a, v]) => r.setAttribute(a, v));
      svg.append(r);
    });
    return svg;
  };
  function renderQuick() {
    quick.replaceChildren(...QUICK.map((id) => {
      const f = factoryById(id);
      return h('button', { type: 'button', class: 'quick-card', 'aria-pressed': String(app.presetId === id), onclick: () => app.loadPreset(f) },
        thumb(f.patch), h('strong', {}, f.patch.name.replace('왼손 베이스 + 피아노', '베이스 나누기')), h('span', {}, f.desc));
    }));
  }

  // ---- 지금 소리 ----
  function sentence() {
    const p = app.patch;
    const ps = parts().map((x, i) => ({ ...x, color: PART_COLORS[i] })).filter((x) => x.on);
    const left = ps.filter((x) => x.hi < 60 && !x.main);
    const top = ps.filter((x) => !left.includes(x));
    const name = (x) => h('strong', { class: `t-${x.color}` }, x.name);
    const out = [];
    if (left.length) out.push('왼손은 ', ...left.flatMap((x, k) => [k ? ', ' : '', name(x)]), ', ');
    const mainPart = top.find((x) => x.main) ?? top[0];
    const over = top.filter((x) => x !== mainPart);
    if (mainPart) {
      out.push(left.length ? '오른손은 ' : '', name(mainPart));
      if (over.length) out.push(' 위에 ', ...over.flatMap((x, k) => [k ? '와 ' : '', name(x)]), `가 ${over.map((x) => `${Math.round(x.level * 100)}%`).join('·')}로 깔려요.`);
      else out.push(left.length ? '예요.' : (p.layers.length ? ' 혼자 울려요 (겹친 음색은 꺼짐).' : ' 혼자 울려요. 아래에서 음색을 겹치거나 나눠 보세요.'));
    }
    return out;
  }

  const listen = h('button', { type: 'button', class: 'primary', onclick: () => app.audition([36, 48, 60, 64, 67, 72]) }, 'C 코드로 들어 보기');
  const save = h('button', { type: 'button', onclick: () => app.savePreset() }, '내 음색으로 저장');
  const toPad = h('button', { type: 'button', onclick: () => app.sendToPad(Number(padSelect.value)) }, '무대 패드에 올리기');
  const el = h('section', { class: 'hybrid', 'aria-labelledby': 'hybrid-h' },
    h('div', { class: 'lab-head' }, h('h2', { id: 'hybrid-h' }, '하이브리드 — 한 음색에 소리 셋'),
      h('p', { class: 'panel-hint' }, '메인 음색 위에 두 개까지 겹치거나, 건반을 나눠 왼손·오른손에 다른 소리를 둬요.')),
    h('div', { class: 'panel strip-panel' },
      h('header', { class: 'panel-head' }, h('h3', {}, '건반 띠'), h('p', { class: 'panel-hint' }, '막대 양 끝을 끌어 범위를 바꾸고, 흰 점선을 끌어 나누는 점을 옮겨요. 겹친 범위는 막대가 겹쳐 보여요.')),
      strip,
      h('div', { class: 'btn-row strip-actions' }, h('div', { class: 'joined' }, addSel, addBtn), splitBtn)),
    cards,
    h('div', { class: 'hybrid-bottom' },
      h('div', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h3', {}, '빨리 고르기'), h('p', { class: 'panel-hint' }, '자주 쓰는 겹치기 4개')), quick),
      h('div', { class: 'panel hybrid-now-panel' }, h('header', { class: 'panel-head' }, h('h3', {}, '지금 소리')), now,
        h('div', { class: 'btn-row' }, listen, save, toPad),
        h('p', { class: 'panel-hint' }, '겹친 음색도 하나의 음색처럼 무대 패드·루퍼 트랙·톤 맞추기에 함께 따라가요.'))));

  function draw() {
    if (el.closest('[hidden]')) return;
    const list = parts();
    const sp = splitPoint();
    geo = drawKeyStrip(strip, list.map((x, i) => ({
      lo: x.lo, hi: x.hi, on: x.on, color: PART_COLORS[i], label: x.name,
      note: `${rangeText(x.lo, x.hi)}${x.main ? '' : ` · 볼륨 ${Math.round(x.level * 100)}%`}`,
    })), { split: sp?.at ?? null });
  }
  function render() {
    const p = app.patch;
    cards.replaceChildren(...[0, ...p.layers.map((_, i) => i + 1)].map(partCard));
    const keep = addSel.value;
    addSel.replaceChildren(...sources().map((s) => h('option', { value: s.id }, s.name)));
    addSel.value = sources().some((s) => s.id === keep) ? keep : 'worship-pad';
    addBtn.disabled = p.layers.length >= MAX_LAYERS;
    splitBtn.textContent = splitPoint() ? '나누기 풀기' : 'C4 에서 나누기';
    splitBtn.setAttribute('aria-pressed', String(Boolean(splitPoint())));
    now.replaceChildren(...sentence());
    renderQuick();
    requestAnimationFrame(draw);
  }
  return { el, render, draw };
}
