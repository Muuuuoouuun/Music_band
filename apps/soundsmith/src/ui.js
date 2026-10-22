// 화면 부품: 작은 DOM 도우미, 돌리는 노브(시안 A), 음색 값에 묶인 노브·버튼 묶음.
import { PARAMS, getPath, formatValue, waveCycle } from './patch.js';
import { drawWaveIcon } from './draw.js';

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

// ---------------------------------------------------------------------------
// 노브: 금색 링이 값만큼 차오르고(가운데가 0인 값은 12시에서 양쪽으로), 바늘이 돈다.
// 위·오른쪽으로 끌면 커지고 아래·왼쪽은 작아짐 (Shift = 미세), 화살표·PageUp/Down·Home/End,
// 포커스된 채 휠, 두 번 누르면 기본값. 손가락으로 끌어도 페이지가 스크롤되지 않는다.
// ---------------------------------------------------------------------------

const clamp01 = (u) => Math.min(1, Math.max(0, u));

/**
 * opts: { label, min, max, value, step, scale: 'lin'|'log', bipolar, size: 'sm'|'md'|'lg', tone: 'brass'|'signal',
 *         format(v), onInput(v), onChange(v), defaultValue: () => v, low, high }
 */
export function knob(opts) {
  const { min = 0, max = 1, step = 0, scale = 'lin', size = 'md', tone = 'brass' } = opts;
  const toU = (v) => clamp01(scale === 'log' ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromU = (u) => {
    let v = scale === 'log' ? min * (max / min) ** clamp01(u) : min + clamp01(u) * (max - min);
    if (step) v = Math.round(v / step) * step;
    return Math.min(max, Math.max(min, v));
  };
  const bipolar = opts.bipolar ?? (min < 0 && max > 0);
  const centerU = bipolar ? toU(opts.center ?? 0) : 0;
  const fmt = opts.format ?? ((v) => String(Math.round(v * 100) / 100));
  const dial = h('span', {
    class: 'knob-dial', role: 'slider', tabindex: '0', 'aria-label': opts.ariaLabel ?? opts.label,
    'aria-valuemin': String(min), 'aria-valuemax': String(max),
  }, h('span', { class: 'knob-ring', 'aria-hidden': 'true' }), h('span', { class: 'knob-cap', 'aria-hidden': 'true' }),
  h('span', { class: 'knob-pointer', 'aria-hidden': 'true' }));
  const out = h('output', { class: 'knob-value' });
  const ends = opts.low || opts.high ? h('span', { class: 'knob-ends', 'aria-hidden': 'true' }, h('span', {}, opts.low ?? ''), h('span', {}, opts.high ?? '')) : null;
  const el = h('div', { class: `knob knob-${size} knob-${tone}` }, dial, h('span', { class: 'knob-label' }, opts.label), out, ends);
  let value = opts.value ?? min;
  const show = (v) => {
    const u = toU(v);
    const a = Math.min(u, centerU) * 270;
    const b = Math.max(u, centerU) * 270;
    dial.style.setProperty('--a', `${a}deg`);
    dial.style.setProperty('--b', `${b}deg`);
    dial.style.setProperty('--rot', `${-135 + u * 270}deg`);
    const text = fmt(v);
    out.textContent = text;
    dial.setAttribute('aria-valuenow', String(Math.round(v * 1000) / 1000));
    dial.setAttribute('aria-valuetext', text);
  };
  const setValue = (v, phase) => {
    if (v === value && phase === 'input') return;
    value = v;
    show(v);
    if (phase === 'input') opts.onInput?.(v);
    else opts.onChange?.(v);
  };
  // 끌기: 시작점에서의 거리만큼 (220px = 전체, Shift 면 4배 정밀)
  let drag = null;
  dial.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    dial.focus({ preventScroll: true });
    dial.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, u: toU(value), moved: false };
    el.classList.add('is-turning');
  });
  dial.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const span = e.shiftKey ? 880 : 220;
    const du = ((drag.y - e.clientY) + (e.clientX - drag.x)) / span;
    if (Math.abs(du) > 0.002) drag.moved = true;
    setValue(fromU(drag.u + du), 'input');
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    el.classList.remove('is-turning');
    if (moved) opts.onChange?.(value);
  };
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  dial.addEventListener('lostpointercapture', end);
  dial.addEventListener('dblclick', () => {
    const d = opts.defaultValue?.();
    if (d != null) setValue(d, 'change');
  });
  const nudge = (du) => {
    const u = toU(value);
    let next = fromU(u + du);
    // 정수 값(옥타브·겹치기)은 한 칸씩 반드시 움직이게
    if (step && next === value && du !== 0) next = Math.min(max, Math.max(min, value + Math.sign(du) * step));
    setValue(next, 'change');
  };
  dial.addEventListener('keydown', (e) => {
    const small = step ? step / (max - min) : 0.01;
    const map = { ArrowUp: small, ArrowRight: small, ArrowDown: -small, ArrowLeft: -small, PageUp: 0.1, PageDown: -0.1 };
    if (e.key in map) nudge(map[e.key] * (e.shiftKey && !step ? 0.25 : 1));
    else if (e.key === 'Home') setValue(min, 'change');
    else if (e.key === 'End') setValue(max, 'change');
    else return;
    e.preventDefault();
  });
  dial.addEventListener('wheel', (e) => {
    if (document.activeElement !== dial) return;
    e.preventDefault();
    nudge((e.deltaY < 0 ? 1 : -1) * (step ? step / (max - min) : 0.01));
  }, { passive: false });
  show(value);
  return {
    el,
    dial,
    get value() { return value; },
    set(v) {
      if (drag) return; // 돌리는 중에는 밖에서 덮어쓰지 않음
      value = v;
      show(v);
    },
  };
}

// 노브 아래 이름은 좁으니 짧게
const SHORT = {
  detune: '미세 음정', spread: '퍼짐', unison: '겹치기', 'fm.decay': 'FM 감쇠', 'fm.sustain': 'FM 남김', 'fm.amount': 'FM 세기',
  noise: '숨소리', 'filter.cutoff': '차단', 'filter.keytrack': '건반 추적', 'filter.env': '엔벨로프',
  'lfo.delay': '늦게 시작', 'fx.feedback': '반복', 'fx.size': '잔향 길이', 'pluck.pick': '뜯는 위치', 'pluck.decay': '울림',
};
const shortLabel = (path, spec) => SHORT[path] ?? SHORT[path.split('.').at(-1)] ?? spec.label;

/**
 * 음색 값 하나에 묶인 조절기. bind = { get(): patch, set(path, value, phase), defaultOf?(path) } —
 * phase 'input' 은 돌리는 중, 'change' 는 손을 뗐을 때(되돌리기 기록).
 * 숫자 값은 노브, 고르는 값은 버튼 묶음, 켜고 끄는 값은 토글.
 */
export function control(path, bind, { label, size = 'md', tone } = {}) {
  const spec = PARAMS[path];
  if (spec.kind === 'enum') return segmented(path, bind, { label });
  if (spec.kind === 'bool') return toggle(path, bind, { label });
  const k = knob({
    label: label ?? shortLabel(path, spec),
    ariaLabel: spec.label,
    min: spec.min,
    max: spec.max,
    step: spec.step ?? 0,
    scale: spec.scale,
    size,
    tone: tone ?? (path.startsWith('lfo.') || path.startsWith('filterEnv.') ? 'signal' : 'brass'),
    value: getPath(bind.get(), path),
    format: (v) => formatValue(path, v),
    onInput: (v) => bind.set(path, v, 'input'),
    onChange: (v) => bind.set(path, v, 'change'),
    defaultValue: bind.defaultOf ? () => bind.defaultOf(path) : null,
  });
  return { el: k.el, sync: () => k.set(getPath(bind.get(), path)) };
}

export function segmented(path, bind, { label, icons = false } = {}) {
  const spec = PARAMS[path];
  const buttons = spec.values.map((value, i) => {
    const b = h('button', { type: 'button', class: icons ? 'seg-btn wave-btn' : 'seg-btn', 'aria-pressed': 'false' });
    if (icons) {
      const c = h('canvas', { width: 44, height: 22, 'aria-hidden': 'true' });
      b.append(c, h('span', {}, spec.labels[i]));
      requestAnimationFrame(() => drawWaveIcon(c, waveCycle(value, 64)));
    } else b.textContent = spec.labels[i];
    b.addEventListener('click', () => {
      bind.set(path, value, 'change');
      sync();
    });
    return b;
  });
  const el = h('div', { class: 'ctl ctl-seg' }, h('span', { class: 'label' }, label ?? spec.label),
    h('div', { class: 'seg', role: 'group', 'aria-label': label ?? spec.label }, ...buttons));
  const sync = () => {
    const v = getPath(bind.get(), path);
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(spec.values[i] === v)));
  };
  sync();
  return { el, sync };
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
    /** 노브 여러 개를 한 줄(넘치면 다음 줄)로 */
    knobs(paths, opts) {
      return h('div', { class: 'knobs' }, ...paths.map((path) => {
        const c = control(path, bind, opts);
        list.push(c);
        return c.el;
      }));
    },
    sync() {
      for (const c of list) c.sync();
    },
  };
}

export function chipButton(text, onclick, attrs = {}) {
  return h('button', { type: 'button', class: 'chip-btn', onclick, ...attrs }, text);
}
