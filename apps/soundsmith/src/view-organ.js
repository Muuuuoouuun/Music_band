// 오르간 · EP 패널 (시안 H2): 실험실의 '오르간 드로바' 상자와 '이펙트' 상자.
// 빨리 고르기(오르간 5 · EP 3), 톤휠 드로바(당긴 만큼 번호가 보이는 막대, 등록값 입력), 퍼커션,
// EP 이펙트(좌우 트레몰로 그림·박에 맞춤, 페이저, 앰프), 로터리 스피커(돌아가는 혼·드럼, 가속 곡선).
import { h, panel, controlGroup } from './ui.js';
import { DRAWBAR_LABELS, ROTOR } from './fx.js';
import { factoryById } from './presets.js';

const BAR_KIND = ['sub', 'sub', 'oct', 'oct', 'mix', 'oct', 'mix', 'mix', 'oct'];
const PICKS = [
  ['b3-full', '오르간'], ['gospel-organ', '오르간'], ['jazz-organ', '오르간'], ['soft-organ', '오르간'], ['pipe-full', '오르간'],
  ['tremolo-rhodes', 'EP'], ['wurli', 'EP'], ['clav', 'EP'],
];
export const regOf = (bars) => `${bars.slice(0, 2).join('')} ${bars.slice(2, 6).join('')} ${bars.slice(6).join('')}`;
const svgNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function pickSummary(p) {
  if (p.source === 'organ') {
    const perc = p.organ.perc === 'off' ? '' : ` · ${p.organ.perc === '2nd' ? '2배' : '3배'} 퍼커션`;
    const rot = p.fx.rotary > 0.001 ? ` · 로터리 ${p.fx.rotaryFast ? '빠름' : '느림'}` : ' · 로터리 끔';
    return `${regOf(p.organ.bars)}${perc}${rot}`;
  }
  const parts = [];
  if (p.fx.trem > 0.001) parts.push(`트레몰로 ${Math.round(p.fx.trem * 100)}% · ${p.fx.tremRate.toFixed(1)} Hz`);
  if (p.fx.phaser > 0.001) parts.push(`페이저 ${Math.round(p.fx.phaser * 100)}%`);
  if (p.fx.drive > 0.001) parts.push(`드라이브 ${Math.round(p.fx.drive * 100)}%`);
  return parts.join(' · ') || '깨끗하게';
}

export function OrganPanels(app, bind) {
  const ctl = controlGroup(bind);
  const animators = [];

  // ---- 빨리 고르기 ----
  function picksPanel() {
    const row = h('div', { class: 'organ-picks' });
    const render = () => row.replaceChildren(...PICKS.map(([id, kind]) => {
      const f = factoryById(id);
      return h('button', { type: 'button', class: 'organ-pick', 'aria-pressed': String(app.presetId === id), onclick: () => app.loadPreset(f) },
        h('span', { class: `pick-kind${kind === 'EP' ? ' ep' : ''}` }, kind), h('strong', {}, f.patch.name), h('span', { class: 'pick-sum' }, pickSummary(f.patch)));
    }));
    return { el: panel('빨리 고르기', { cls: 'span-wide', hint: '오르간 5 · EP 3' }, row), render };
  }

  // ---- 로터리 스피커 ----
  function rotaryPanel() {
    const horn = h('span', { class: 'rotor-horn' });
    const drum = h('span', { class: 'rotor-drum' });
    const hornHz = h('span', { class: 'rotor-hz' });
    const drumHz = h('span', { class: 'rotor-hz' });
    const cab = h('div', { class: 'rotor-cab', 'aria-hidden': 'true' },
      h('div', { class: 'rotor-slot' }, horn), hornHz, h('div', { class: 'rotor-slot drum' }, drum), drumHz);
    const big = h('button', { type: 'button', class: 'rotary-big', 'aria-pressed': 'false' });
    big.addEventListener('click', () => app.setRotaryFast(!app.patch.fx.rotaryFast));
    // 빨라지는 시간 곡선 (혼·드럼의 가속 시간 상수로)
    const chart = svg('svg', { viewBox: '0 0 300 120', class: 'rotor-curve', role: 'img', 'aria-label': '빨라지는 시간: 혼은 1초쯤, 드럼은 3초쯤' });
    const curve = (tau) => {
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const t = (i / 60) * 4;
        pts.push(`${20 + (t / 4) * 270},${100 - 80 * (1 - Math.exp(-t / tau))}`);
      }
      return `M${pts.join(' L')}`;
    };
    chart.append(
      svg('line', { x1: 20, y1: 100, x2: 290, y2: 100, class: 'rc-axis' }),
      svg('line', { x1: 20, y1: 10, x2: 20, y2: 100, class: 'rc-axis' }),
      svg('path', { d: curve(ROTOR.horn.up), class: 'rc-horn' }),
      svg('path', { d: curve(ROTOR.drum.up), class: 'rc-drum' }),
    );
    const t1 = svg('text', { x: 70, y: 22, class: 'rc-label rc-horn-t' });
    t1.textContent = `혼 · ${(ROTOR.horn.up * 3).toFixed(0)}초쯤`;
    const t2 = svg('text', { x: 170, y: 70, class: 'rc-label rc-drum-t' });
    t2.textContent = `드럼 · ${(ROTOR.drum.up * 2).toFixed(0)}초쯤`;
    const t3 = svg('text', { x: 20, y: 116, class: 'rc-label' });
    t3.textContent = '0초';
    const t4 = svg('text', { x: 272, y: 116, class: 'rc-label' });
    t4.textContent = '4초';
    chart.append(t1, t2, t3, t4);
    // 돌아가는 모습: 실제처럼 목표 빠르기에 시간 상수로 다가간다
    const sim = { horn: { speed: ROTOR.horn.slow, angle: 0 }, drum: { speed: ROTOR.drum.slow, angle: 0 }, last: 0 };
    const el = panel('로터리 스피커', { cls: 'span-wide rotary-panel', hint: '느림 ↔ 빠름, 혼·드럼이 따로 가속' },
      h('div', { class: 'rotary-row' }, cab,
        h('div', { class: 'rotary-mid' }, big, h('p', { class: 'panel-hint' }, '예배 무대의 큰 버튼, 건반의 모듈레이션 휠(CC1)도 같은 스위치예요.')),
        h('div', { class: 'rotary-chart' }, h('span', { class: 'label' }, '빨라지는 시간'), chart),
        ctl.knobs(['fx.rotary'], { size: 'md' })));
    const frame = (time) => {
      if (!el.isConnected || el.closest('[hidden]')) { sim.last = 0; return; }
      const dt = sim.last ? Math.min(0.1, (time - sim.last) / 1000) : 0;
      sim.last = time;
      const fx = app.patch.fx;
      const on = fx.rotary > 0.001;
      for (const [name, part] of [['horn', sim.horn], ['drum', sim.drum]]) {
        const c = ROTOR[name];
        const target = on ? (fx.rotaryFast ? c.fast : c.slow) : 0;
        const tau = target > part.speed ? c.up : c.down;
        part.speed += (target - part.speed) * (1 - Math.exp(-dt / tau));
        part.angle = (part.angle + part.speed * dt * 360) % 360;
      }
      horn.style.transform = `rotateY(${sim.horn.angle}deg)`;
      drum.style.transform = `rotateY(${sim.drum.angle}deg)`;
      hornHz.textContent = `혼 ${sim.horn.speed.toFixed(1)} Hz`;
      drumHz.textContent = `드럼 ${sim.drum.speed.toFixed(1)} Hz`;
    };
    animators.push(frame);
    const render = () => {
      const fx = app.patch.fx;
      const used = app.rotaryUsed;
      big.setAttribute('aria-pressed', String(fx.rotaryFast));
      big.disabled = !used && fx.rotary <= 0.001;
      big.replaceChildren(h('span', { class: 'rb-title' }, fx.rotaryFast ? '빠름' : '느림'),
        h('span', { class: 'rb-sub' }, fx.rotary <= 0.001 ? '섞는 양을 올리면 켜져요' : fx.rotaryFast ? '한 번 더 누르면 느림 (천천히 줄어듦)' : '누르면 빠름 (혼부터 빨라짐)'),
        h('span', { class: 'led', 'aria-hidden': 'true' }));
    };
    return { el, render };
  }

  // ---- 오르간 상자 ----
  const regRead = h('output', { class: 'reg-read', 'aria-live': 'polite' });
  const regIn = h('input', { type: 'text', class: 'text-input reg-input', inputmode: 'numeric', maxlength: '11', 'aria-label': '드로바 등록값 9자리 (예: 888000000)', placeholder: '888000000' });
  regIn.addEventListener('change', () => {
    const digits = regIn.value.replace(/\D/g, '');
    if (digits.length !== 9 || /[9]/.test(digits)) {
      app.notice('드로바는 0–8 숫자 9개예요. 예: 888000000', 'bad');
      return;
    }
    const p = structuredClone(app.patch);
    p.organ.bars = digits.split('').map(Number);
    app.setPatch(p, { phase: 'change', keepMacros: true });
  });
  const bars = DRAWBAR_LABELS.map((label, i) => {
    const segs = Array.from({ length: 8 }, (_, k) => h('span', { class: 'db-seg' }, String(k + 1)));
    const stick = h('span', { class: 'db-stick' }, ...segs);
    const cap = h('span', { class: 'db-cap' });
    const bar = h('span', {
      class: `db db-${BAR_KIND[i]}`, role: 'slider', tabindex: '0', 'aria-label': `드로바 ${label}`, 'aria-valuemin': '0', 'aria-valuemax': '8',
    }, h('span', { class: 'db-slot', 'aria-hidden': 'true' }), stick, cap);
    const set = (v, phase) => {
      const next = Math.max(0, Math.min(8, Math.round(v)));
      if (next === app.patch.organ.bars[i] && phase === 'input') return;
      app.setParam(`organ.bars.${i}`, next, phase);
    };
    let drag = false;
    const at = (e) => {
      const r = bar.getBoundingClientRect();
      return ((e.clientY - r.top - 14) / (r.height - 34)) * 8;
    };
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      bar.focus({ preventScroll: true });
      bar.setPointerCapture(e.pointerId);
      drag = true;
      set(at(e), 'input');
    });
    bar.addEventListener('pointermove', (e) => { if (drag) set(at(e), 'input'); });
    const end = () => { if (drag) { drag = false; app.setPatch(app.patch, { phase: 'change', keepMacros: true }); } };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', (e) => {
      const map = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: -8, End: 8 };
      if (!(e.key in map)) return;
      e.preventDefault();
      set(app.patch.organ.bars[i] + map[e.key], 'change');
    });
    return { el: h('div', { class: 'db-col' }, h('span', { class: 'db-label' }, label), bar), bar, stick, cap, i };
  });
  const percSeg = ctl.seg('organ.perc', { label: '퍼커션 — 누를 때 톡 하는 배음' });
  const speedSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '퍼커션 빠르기' },
    ...[[true, '빠름'], [false, '느림']].map(([v, label]) => {
      const b = h('button', { type: 'button', class: 'seg-btn', dataset: { fast: String(v) } }, label);
      b.addEventListener('click', () => app.setParam('organ.percFast', v, 'change'));
      return b;
    }));
  const softBtn = h('button', { type: 'button', class: 'toggle small' }, '작게');
  softBtn.addEventListener('click', () => app.setParam('organ.percSoft', !app.patch.organ.percSoft, 'change'));
  const organPicks = picksPanel();
  const organRotary = rotaryPanel();
  const organEditor = {
    el: h('div', { class: 'node-grid organ-grid' },
      organPicks.el,
      panel('톤휠 오르간', { cls: 'tonewheel', hint: "소리 재료 '오르간'" },
        h('div', { class: 'reg-row' }, h('span', { class: 'label' }, '드로바'), regRead, regIn),
        h('p', { class: 'panel-hint' }, '갈색 = 아래 옥타브 · 흰색 = 옥타브 배음 · 검정 = 5도·3도 배음. 막대를 아래로 끌수록 그 배음이 커져요 (0–8, 한 칸 = 3 dB).'),
        h('div', { class: 'db-housing' }, h('span', { class: 'db-rail', 'aria-hidden': 'true' }), ...bars.map((b) => b.el))),
      panel('퍼커션 · 키 클릭', { cls: 'perc-panel' },
        percSeg, h('div', { class: 'btn-row' }, speedSeg, softBtn),
        ctl.knobs(['organ.click', 'fx.drive']),
        h('p', { class: 'panel-hint' }, '퍼커션은 손을 다 뗐다가 새로 누를 때만 나와요 (진짜 해먼드처럼).')),
      organRotary.el),
    draw() {
      const o = app.patch.organ;
      regRead.textContent = regOf(o.bars);
      if (document.activeElement !== regIn) regIn.value = o.bars.join('');
      for (const b of bars) {
        const v = o.bars[b.i];
        b.stick.style.height = `calc((100% - 34px) * ${v / 8})`;
        b.cap.style.top = `calc(14px + (100% - 34px) * ${v / 8})`;
        b.cap.textContent = String(v);
        b.bar.setAttribute('aria-valuenow', String(v));
      }
      speedSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fast === String(o.percFast))));
      softBtn.setAttribute('aria-pressed', String(o.percSoft));
      organPicks.render();
      organRotary.render();
    },
  };

  // ---- 이펙트 상자 (EP 이펙트 · 로터리 · 공간 · 색깔) ----
  const wave = svg('svg', { viewBox: '0 0 320 70', class: 'trem-wave', role: 'img', 'aria-label': '좌우 트레몰로 모양' });
  const wavePath = svg('path', { class: 'tw-path' });
  const lr = (y, t) => { const s = svg('text', { x: 4, y, class: 'tw-lr' }); s.textContent = t; return s; };
  wave.append(svg('line', { x1: 16, y1: 35, x2: 316, y2: 35, class: 'tw-mid' }), wavePath, lr(14, 'L'), lr(64, 'R'));
  const syncBtn = h('button', { type: 'button', class: 'chip-btn sync-btn' });
  syncBtn.addEventListener('click', () => app.setParam('fx.tremRate', Math.max(0.3, Math.min(10, Math.round((app.studio.bpm / 60) * 2 * 100) / 100)), 'change'));
  const epPicks = picksPanel();
  const fxRotary = rotaryPanel();
  const fxEditor = {
    el: h('div', { class: 'node-grid fx-grid' },
      epPicks.el,
      panel('EP 이펙트', { cls: 'ep-panel', hint: '로즈 · 우리처 · 클라비' },
        h('span', { class: 'label' }, '트레몰로 — 좌우로 흔들기'), wave,
        h('div', { class: 'ep-row' }, ctl.knobs(['fx.trem', 'fx.tremRate']), syncBtn),
        h('span', { class: 'label' }, '페이저 — 쉬익 도는 소리'),
        ctl.knobs(['fx.phaser', 'fx.phaserRate'], { tone: 'signal' }),
        h('span', { class: 'label' }, '앰프'),
        h('div', { class: 'knobs' }, ctl.add('fx.drive'), ctl.add('tone.clarity', { label: '밝기' }))),
      panel('공간', { hint: '딜레이 간격은 루퍼의 BPM 을 따라요. 시머는 잔향을 한 옥타브 위로 번지게 해요' },
        ctl.knobs(['fx.reverb', 'fx.size', 'fx.shimmer', 'fx.chorus', 'fx.delay', 'fx.feedback']), ctl.seg('fx.delayBeats')),
      panel('색깔', { hint: '로파이는 낡은 테이프처럼, 비트는 옛 샘플러처럼' },
        ctl.knobs(['fx.lofi', 'fx.bits'])),
      fxRotary.el),
    draw() {
      const fx = app.patch.fx;
      // 1초 동안의 좌우 흔들림 (깊이 = 폭, 빠르기 = 굽이 수)
      const pts = [];
      const cycles = Math.max(0.5, fx.tremRate);
      for (let i = 0; i <= 120; i++) {
        const x = 16 + (i / 120) * 300;
        pts.push(`${x.toFixed(1)},${(35 - Math.sin((i / 120) * cycles * 2 * Math.PI) * 28 * fx.trem).toFixed(1)}`);
      }
      wavePath.setAttribute('d', `M${pts.join(' L')}`);
      const beat8 = (app.studio.bpm / 60) * 2;
      syncBtn.textContent = `박에 맞춤 · 8분 (${beat8.toFixed(1)} Hz)`;
      syncBtn.setAttribute('aria-pressed', String(Math.abs(fx.tremRate - beat8) < 0.05));
      epPicks.render();
      fxRotary.render();
    },
  };
  return {
    organEditor,
    fxEditor,
    sync: () => ctl.sync(),
    frame: (time) => animators.forEach((f) => f(time)),
  };
}
