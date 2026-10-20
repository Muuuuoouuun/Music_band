// 화면 부품: 작은 DOM 도우미와 음색 값에 묶인 슬라이더·버튼 묶음.
import { PARAMS, getPath, toUnit, fromUnit, formatValue, waveCycle } from './patch.js';
import { drawWaveIcon, drawBars } from './draw.js';

let uid = 0;
export const nextId = (prefix = 'c') => `${prefix}-${++uid}`;

/** h('div', { class: 'x', onclick }, '글자', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function panel(title, { hint, cls = '', actions } = {}, ...body) {
  return h('section', { class: `panel ${cls}` },
    h('header', { class: 'panel-head' }, h('h3', {}, title), hint ? h('p', { class: 'panel-hint' }, hint) : null, actions ?? null),
    h('div', { class: 'panel-body' }, ...body));
}

/**
 * 음색 값 하나에 묶인 조절기. bind = { get(): patch, set(path, value, phase) } — phase 'input' 은 끄는 중,
 * 'change' 는 손을 뗐을 때(되돌리기 기록).
 */
export function control(path, bind, { label } = {}) {
  const spec = PARAMS[path];
  if (spec.kind === 'enum') return segmented(path, bind, { label });
  if (spec.kind === 'bool') return toggle(path, bind, { label });
  const id = nextId('p');
  const input = h('input', { type: 'range', id });
  if (spec.step) Object.assign(input, { min: spec.min, max: spec.max, step: spec.step });
  else Object.assign(input, { min: 0, max: 1000, step: 1 });
  const out = h('output', { for: id });
  const read = () => (spec.step ? Number(input.value) : fromUnit(spec, Number(input.value) / 1000));
  input.addEventListener('input', () => {
    const v = read();
    out.textContent = formatValue(path, v);
    bind.set(path, v, 'input');
  });
  input.addEventListener('change', () => bind.set(path, read(), 'change'));
  const el = h('div', { class: 'ctl' }, h('label', { for: id }, label ?? spec.label), out, input);
  const sync = () => {
    const v = getPath(bind.get(), path);
    input.value = spec.step ? v : Math.round(toUnit(spec, v) * 1000);
    out.textContent = formatValue(path, v);
  };
  sync();
  return { el, sync, input };
}

export function segmented(path, bind, { label, icons = false, iconFor = (v) => waveCycle(v, 64) } = {}) {
  const spec = PARAMS[path];
  let customIcon = null;
  const buttons = spec.values.map((value, i) => {
    const b = h('button', { type: 'button', class: icons ? 'seg-btn wave-btn' : 'seg-btn', 'aria-pressed': 'false' });
    if (icons) {
      const c = h('canvas', { width: 44, height: 22, 'aria-hidden': 'true' });
      b.append(c, h('span', {}, spec.labels[i]));
      if (value === 'custom') customIcon = c;
      requestAnimationFrame(() => drawWaveIcon(c, iconFor(value)));
    } else b.textContent = spec.labels[i];
    b.addEventListener('click', () => {
      bind.set(path, value, 'change');
      sync();
    });
    return b;
  });
  const el = h('div', { class: 'ctl ctl-seg' }, h('span', { class: 'label' }, label ?? spec.label),
    h('div', { class: 'seg', role: 'group', 'aria-label': label ?? spec.label }, ...buttons));
  let lastCustom = null;
  const sync = () => {
    const v = getPath(bind.get(), path);
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(spec.values[i] === v)));
    // 직접 그린 파형 아이콘은 그림이 바뀔 때마다 다시
    const cur = bind.get().custom;
    if (customIcon && cur !== lastCustom) {
      lastCustom = cur;
      drawWaveIcon(customIcon, iconFor('custom'));
    }
  };
  sync();
  return { el, sync };
}

/**
 * 끌어서 그리는 막대 (배음 표·맞춤 EQ). get() → 지금 값 배열, set(values, phase).
 * count() 만큼만 보여 주고 고친다 (나머지 값은 그대로).
 */
export function barEditor({ label, get, set, min = 0, max = 1, sqrt = false, labels = null, count = () => get().length, compare = () => null, cls = 'bar-canvas' }) {
  const canvas = h('canvas', { class: cls, role: 'img', 'aria-label': label });
  let values = null;
  let last = null;
  let layout = null;
  const draw = () => {
    const src = values ?? get();
    const n = count();
    const cmp = compare();
    layout = drawBars(canvas, src.slice(0, n), { min, max, sqrt, labels: labels?.slice(0, n) ?? null, compare: cmp ? cmp.slice(0, n) : null });
  };
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    const n = count();
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
    return { i, v: Math.round(layout.yToValue(e.clientY - r.top) * 1000) / 1000 };
  };
  const paint = (e) => {
    const p = at(e);
    // 빠르게 끌어도 사이 막대가 비지 않게 이어 칠한다
    const from = last ?? p;
    const steps = Math.abs(p.i - from.i);
    for (let k = 0; k <= steps; k++) {
      const t = steps ? k / steps : 1;
      const i = Math.round(from.i + (p.i - from.i) * t);
      values[i] = Math.min(max, Math.max(min, from.v + (p.v - from.v) * t));
    }
    last = p;
    draw();
    set([...values], 'input');
  };
  canvas.addEventListener('pointerdown', (e) => {
    values = [...get()];
    last = null;
    canvas.setPointerCapture(e.pointerId);
    paint(e);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (values) paint(e);
  });
  const end = () => {
    if (!values) return;
    const v = values;
    values = null;
    last = null;
    set([...v], 'change');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  requestAnimationFrame(draw);
  return { el: canvas, sync: draw };
}

export function toggle(path, bind, { label } = {}) {
  const spec = PARAMS[path];
  const b = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false' }, label ?? spec.label);
  b.addEventListener('click', () => {
    bind.set(path, !getPath(bind.get(), path), 'change');
    sync();
  });
  const sync = () => b.setAttribute('aria-pressed', String(Boolean(getPath(bind.get(), path))));
  sync();
  return { el: h('div', { class: 'ctl ctl-toggle' }, b), sync };
}

/** 여러 조절기를 만들고 한 번에 다시 맞춘다. */
export function controlGroup(bind) {
  const list = [];
  return {
    add(path, opts) {
      const c = control(path, bind, opts);
      list.push(c);
      return c.el;
    },
    seg(path, opts) {
      const c = segmented(path, bind, opts);
      list.push(c);
      return c.el;
    },
    custom(c) {
      list.push(c);
      return c.el;
    },
    sync() {
      for (const c of list) c.sync();
    },
  };
}

export function chipButton(text, onclick, attrs = {}) {
  return h('button', { type: 'button', class: 'chip-btn', onclick, ...attrs }, text);
}
