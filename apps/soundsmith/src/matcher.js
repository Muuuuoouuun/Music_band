// 음원 따라 만들기의 '듣고 고치기': 만든 음색을 미리 연주(OfflineAudioContext)해서 원음과 같은 자로 재고,
// 톤 균형 차이를 맞춤 EQ 로 메우고, 원하면 몇 가지 값을 조금씩 바꿔 가며 더 닮은 쪽을 고른다.
import { renderNote } from './engine.js';
import { analyzeAudio, planPatch, similarity, matchTarget, fitGraphicEq, applyTone } from './analyze.js';
import { PARAMS, getPath, setPath, normalizePatch } from './patch.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const log2 = Math.log2;

/** 원음과 비슷한 조건(같은 음·길이·누르는 시간)으로 음색을 연주해 잰다. */
export async function renderFeatures(patch, ref, notes) {
  const e = ref.envelope;
  const seconds = clamp(ref.seconds, 1.2, 4.5);
  const held = ref.kind === 'tone' && e?.releaseMeasured ? e.noteEnd - e.onset - 0.15 : seconds * 0.85;
  const buf = await renderNote(patch, {
    notes,
    seconds,
    hold: clamp(held, 0.2, seconds - 0.05),
    dry: false,
  });
  return { features: analyzeAudio([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate), buffer: buf };
}

function withEq(patch, ref, cand, limit) {
  const diff = matchTarget(ref.bands, cand.bands, { limit });
  // 지금 맞춤 EQ 위에 남은 차이를 더해 다시 맞춘다
  const want = patch.eq.match.map((g, i) => g + diff[i]);
  return setPath(patch, 'eq.match', fitGraphicEq(want.map((v) => clamp(v, -limit, limit)), { max: limit + 2 }));
}

/**
 * 분석 결과(ref)로 음색을 만들고 맞춤 EQ 까지 맞춘다.
 * 반환: { patch, plan, score, parts, cand, buffer, steps }
 */
export async function matchSound(ref, presets, { name, onProgress = () => {} } = {}) {
  const plan = planPatch(ref, presets, { name });
  const limit = 9;
  onProgress('출발 음색 연주해 보는 중');
  let best = { patch: plan.patch, ...(await renderFeatures(plan.patch, ref, plan.render)) };
  best.sim = similarity(ref, best.features);
  // 화음·믹스: 값으로 고른 후보 셋을 실제로 연주해 견주고 가장 닮은 것에서 출발한다
  if (plan.mode === 'nearest') {
    for (const alt of plan.alternatives ?? []) {
      onProgress(`'${alt.from}' 견주는 중`);
      const r = await renderFeatures(alt.patch, ref, plan.render);
      const sim = similarity(ref, r.features);
      if (sim.score > best.sim.score) {
        best = { patch: alt.patch, ...r, sim };
        plan.from = alt.from;
      }
    }
    plan.notes.splice(1, 0, `그중 가장 닮은 '${plan.from}'에서 출발했어요`);
  }
  const steps = [{ label: plan.mode === 'resynth' ? '배음으로 다시 합성' : `'${plan.from}'에서 출발`, score: best.sim.score }];
  // 잔향: 원음과 만든 음색의 꼬리를 같은 자로 재서, 남는 크기 차이만큼 양을, 줄어드는 속도 차이만큼 길이를 고친다
  for (let round = 0; round < 2 && ref.space?.resid != null; round++) {
    const c = best.features.space;
    if (c?.resid == null || (Math.abs(ref.space.resid - c.resid) < 2 && Math.abs(log2(ref.space.rt60 / c.rt60)) < 0.25)) break;
    onProgress(`잔향 맞추는 중 (${round + 1}/2)`);
    const fx = best.patch.fx;
    const reverb = clamp(Math.max(0.03, fx.reverb) * 10 ** ((ref.space.resid - c.resid) / 20), 0, 1);
    const size = clamp(fx.size * clamp(ref.space.rt60 / c.rt60, 0.5, 2), 0.5, 8);
    const patch = normalizePatch({ ...best.patch, fx: { ...fx, reverb, size } });
    const r = await renderFeatures(patch, ref, plan.render);
    const sim = similarity(ref, r.features);
    if (sim.score < best.sim.score) break;
    best = { patch, ...r, sim };
    steps.push({ label: '잔향', score: sim.score });
  }
  for (let round = 0; round < 2; round++) {
    onProgress(`톤 균형 맞추는 중 (${round + 1}/2)`);
    const patch = withEq(best.patch, ref, best.features, limit);
    const r = await renderFeatures(patch, ref, plan.render);
    const sim = similarity(ref, r.features);
    if (sim.score < best.sim.score) break;
    best = { patch, ...r, sim };
    steps.push({ label: '맞춤 EQ', score: sim.score });
  }
  return { patch: best.patch, plan, score: best.sim.score, parts: best.sim.parts, cand: best.features, buffer: best.buffer, steps };
}

/** 조금씩 바꿔 볼 값들. 음색 종류에 따라 의미 있는 것만. */
function tweaks(patch) {
  const list = [];
  const mul = (path, f) => list.push({ path, label: PARAMS[path].label, apply: (v) => v * f });
  const add = (path, d) => list.push({ path, label: PARAMS[path].label, apply: (v) => v + d });
  if (patch.filter.cutoff < 17000) { mul('filter.cutoff', 2 ** 0.5); mul('filter.cutoff', 2 ** -0.5); }
  if (Math.abs(patch.filter.env) > 0.05) {
    add('filter.env', 0.5); add('filter.env', -0.5);
    mul('filterEnv.d', 1.6); mul('filterEnv.d', 0.6);
  }
  mul('ampEnv.a', 2); mul('ampEnv.a', 0.5);
  if (patch.ampEnv.s < 0.3) { mul('ampEnv.d', 1.5); mul('ampEnv.d', 0.66); }
  if (patch.source === 'synth') { add('noise', 0.08); add('noise', -0.08); }
  add('fx.width', 0.3); add('fx.width', -0.3);
  add('fx.reverb', 0.12); add('fx.reverb', -0.12);
  return list;
}

/** '더 비슷하게': 값을 하나씩 위아래로 움직여 닮은 정도가 오르면 받아들인다. 마지막에 맞춤 EQ 를 다시. */
export async function refineSound(ref, result, { onProgress = () => {}, rounds = 1 } = {}) {
  let best = { patch: result.patch, features: result.cand, buffer: result.buffer, sim: { score: result.score, parts: result.parts } };
  const steps = [...result.steps];
  const notes = result.plan.render;
  const limit = 9;
  for (let round = 0; round < rounds; round++) {
    const list = tweaks(best.patch);
    let improved = false;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      onProgress(`${t.label} 바꿔 보는 중 (${i + 1}/${list.length})`);
      const spec = PARAMS[t.path];
      const v = getPath(best.patch, t.path);
      const next = clamp(t.apply(v), spec.min, spec.max);
      if (Math.abs(next - v) < 1e-6) continue;
      const patch = normalizePatch(setPath(best.patch, t.path, next));
      const r = await renderFeatures(patch, ref, notes);
      const sim = similarity(ref, r.features);
      if (sim.score > best.sim.score) {
        best = { patch, ...r, sim };
        steps.push({ label: t.label, score: sim.score });
        improved = true;
      }
    }
    if (!improved) break;
  }
  onProgress('톤 균형 다시 맞추는 중');
  const patch = withEq(best.patch, ref, best.features, limit);
  const r = await renderFeatures(patch, ref, notes);
  const sim = similarity(ref, r.features);
  if (sim.score >= best.sim.score) {
    best = { patch, ...r, sim };
    steps.push({ label: '맞춤 EQ', score: sim.score });
  }
  return { ...result, patch: best.patch, score: best.sim.score, parts: best.sim.parts, cand: best.features, buffer: best.buffer, steps };
}

/** 지금 음색에 원음의 톤만 입히기: 지금 음색을 같은 음으로 연주해 재고, 차이를 맞춤 EQ 로. */
export async function toneOnto(patch, ref, notes) {
  const base = setPath(patch, 'eq.match', patch.eq.match.map(() => 0));
  const first = await renderFeatures(base, ref, notes);
  const eq = fitGraphicEq(matchTarget(ref.bands, first.features.bands, { limit: 9 }));
  const out = applyTone(base, ref, eq);
  const r = await renderFeatures(out, ref, notes);
  return { patch: out, before: similarity(ref, first.features).score, score: similarity(ref, r.features).score, cand: r.features };
}
