// 세트리스트: 예배·공연 순서대로 곡마다 음색·조옮김·빠르기·메모를 담아 두고 한 번에 바꾼다.
// 음색은 그때의 사본을 담는다 (나중에 내 음색을 고쳐도 세트리스트의 소리는 그대로).
import { normalizePatch } from './patch.js';

export const MAX_SONGS = 60;

let seq = 0;
const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;
const int = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 곡 하나: { id, title, patch, transpose(-12..12), bpm(40..200 또는 null = 그대로), memo } */
export function normalizeSong(s = {}) {
  const src = s && typeof s === 'object' ? s : {};
  const patch = normalizePatch(src.patch);
  return {
    id: typeof src.id === 'string' && src.id ? src.id.slice(0, 40) : newId(),
    title: text(src.title, 60) || patch.name,
    patch,
    transpose: int(src.transpose, -12, 12, 0),
    bpm: src.bpm == null ? null : int(src.bpm, 40, 200, null),
    memo: text(src.memo, 300),
  };
}

export function normalizeSetlist(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter((s) => s && typeof s === 'object' && s.patch).slice(0, MAX_SONGS).map(normalizeSong).map((s) => {
    if (seen.has(s.id)) s.id = newId();
    seen.add(s.id);
    return s;
  });
}

/** i 번째 곡을 d 칸 옮긴 새 목록 (끝을 넘으면 그대로) */
export function moveSong(list, i, d) {
  const j = i + d;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** 조옮김을 노래 키 말로: C 를 누르면 어떤 음이 나는지 */
const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export function keyLabel(transpose) {
  if (!transpose) return '조옮김 없음';
  return `${transpose > 0 ? '+' : '−'}${Math.abs(transpose)} (C → ${KEYS[((transpose % 12) + 12) % 12]})`;
}
