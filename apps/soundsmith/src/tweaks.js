// 고민별 다듬기: "먹먹해요" 같은 말을 실제 값 변경으로 옮긴다. 무엇을 얼마나 바꿨는지 함께 돌려줘서
// 어느 손잡이가 어떤 소리를 내는지 배우게 한다 (튜닝법). 바꾼 음색은 되돌리기로 돌아간다.
import { PARAMS, getPath, setPath, normalizePatch, formatValue } from './patch.js';

const mul = (f) => (v) => v * f;
const add = (d) => (v) => v + d;
const to = (x) => () => x;

/**
 * panel: 바꾼 값이 있는 패널 (음색 만들기 화면의 data-panel).
 * steps(patch) → [[경로, 새 값을 만드는 함수]] — 음색 종류(줄 뜯기·베이스 등)에 따라 다르게.
 */
export const FIXES = [
  {
    id: 'brighter', label: '더 또렷하게', problem: '먹먹하고 어두워요', panel: 'filter',
    steps: (p) => [
      p.source === 'pluck' ? ['pluck.bright', add(0.15)] : ['filter.cutoff', mul(1.6)],
      ['eq.high', add(2)],
    ],
  },
  {
    id: 'darker', label: '더 부드럽게', problem: '쨍하고 귀가 아파요', panel: 'filter',
    steps: (p) => [
      p.source === 'pluck' ? ['pluck.bright', add(-0.15)] : ['filter.cutoff', mul(0.65)],
      ['eq.high', add(-2)],
    ],
  },
  {
    id: 'faster', label: '첫소리 빠르게', problem: '누르고 소리가 늦게 나요', panel: 'ampEnv',
    steps: () => [['ampEnv.a', mul(0.4)], ['filterEnv.a', mul(0.5)]],
  },
  {
    id: 'softer', label: '첫소리 부드럽게', problem: '첫소리가 딱딱해요', panel: 'ampEnv',
    steps: () => [['ampEnv.a', (v) => Math.max(v * 2.5, 0.03)], ['click', mul(0.5)]],
  },
  {
    id: 'tighter', label: '꼬리 짧게', problem: '소리가 뭉개지고 길게 남아요', panel: 'reverb',
    steps: () => [['ampEnv.r', mul(0.6)], ['fx.reverb', mul(0.7)], ['fx.size', mul(0.8)], ['fx.delay', mul(0.6)]],
  },
  {
    id: 'wider', label: '공간 넓게', problem: '소리가 좁고 답답해요', panel: 'reverb',
    steps: () => [['fx.reverb', add(0.12)], ['fx.size', mul(1.3)], ['fx.width', add(0.2)]],
  },
  {
    id: 'cut', label: '앞으로 나오게', problem: '밴드 소리에 묻혀요', panel: 'eq',
    steps: () => [['eq.mid', add(3)], ['eq.midFreq', to(2000)], ['fx.comp', add(0.2)]],
  },
  {
    id: 'less-low', label: '저음 비우기', problem: '베이스·킥과 부딪혀요', panel: 'eq',
    steps: (p) => [['eq.low', add(p.category === 'bass' ? -2 : -4)]],
  },
  {
    id: 'thicker', label: '두껍게', problem: '소리가 얇아요', panel: 'osc0',
    steps: (p) => (p.source === 'synth'
      ? [['osc.0.unison', add(2)], ['osc.0.spread', (v) => Math.max(v + 6, 10)], ['fx.chorus', add(0.15)]]
      : [['fx.chorus', add(0.2)], ['fx.width', add(0.2)]]),
  },
  {
    id: 'alive', label: '살아 움직이게', problem: '밋밋하고 안 움직여요', panel: 'lfo',
    steps: (p) => [
      ...(p.lfo.depth < 0.05 ? [['lfo.target', to('filter')], ['lfo.shape', to('sine')], ['lfo.sync', to('off')], ['lfo.rate', to(0.25)], ['lfo.depth', to(0.2)]] : [['lfo.depth', mul(1.4)]]),
      ['drift', add(0.15)],
    ],
  },
];

const clampTo = (spec, v) => {
  if (spec.kind !== 'num') return v;
  const c = Math.min(spec.max, Math.max(spec.min, v));
  return spec.step ? Math.round(c / spec.step) * spec.step : c;
};

/**
 * 고민 하나를 음색에 적용. 반환: { patch, changes: [{ path, label, from, to, text }], panel, fix }
 * 이미 끝까지 간 값(예: 차단 주파수 최대)은 changes 에서 빠진다. 바뀐 게 없으면 changes 가 빈 배열.
 */
export function applyFix(patch, id) {
  const fix = FIXES.find((f) => f.id === id);
  if (!fix) throw new Error(`모르는 다듬기: ${id}`);
  let p = patch;
  for (const [path, fn] of fix.steps(patch)) {
    const spec = PARAMS[path];
    p = setPath(p, path, clampTo(spec, fn(getPath(p, path))));
  }
  p = normalizePatch(p);
  const changes = [];
  for (const [path] of fix.steps(patch)) {
    const from = getPath(patch, path);
    const now = getPath(p, path);
    if (from === now || (typeof from === 'number' && Math.abs(from - now) < 1e-9)) continue;
    const label = PARAMS[path].label;
    changes.push({ path, label, from, to: now, text: `${label} ${formatValue(path, from)} → ${formatValue(path, now)}` });
  }
  return { patch: p, changes, panel: fix.panel, fix };
}
