// 캔버스 그림: 엔벨로프, 필터 곡선, 파형 아이콘, 오실로스코프, 샘플 파형·루프 표시, 루퍼 롤, 튜닝 막대.
// 색은 모두 style.css 의 토큰에서 읽는다.
import { envLevel, releaseLevel } from './patch.js';

const tokens = {};
export function color(name) {
  if (!tokens[name]) tokens[name] = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || '#888';
  return tokens[name];
}

/** 화면 크기에 맞춰 캔버스 해상도를 맞추고 2D 컨텍스트와 CSS 픽셀 크기를 돌려준다. */
export function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth || canvas.width));
  const hgt = Math.max(1, Math.round(canvas.clientHeight || canvas.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, hgt);
  return { g, w, h: hgt };
}

function grid(g, w, h, cols, rows) {
  g.strokeStyle = color('grid');
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < cols; i++) { const x = Math.round((i * w) / cols) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
  for (let j = 1; j < rows; j++) { const y = Math.round((j * h) / rows) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
  g.stroke();
}

export function drawWaveIcon(canvas, cycle) {
  const { g, w, h } = fit(canvas);
  g.strokeStyle = 'currentColor';
  g.strokeStyle = getComputedStyle(canvas).color;
  g.lineWidth = 1.6;
  g.beginPath();
  cycle.forEach((v, i) => {
    const x = (i / (cycle.length - 1)) * (w - 4) + 2;
    const y = h / 2 - v * (h / 2 - 3);
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  });
  g.stroke();
}

/** ADSR 모양: 누르고 hold 초 동안 + 놓은 뒤 릴리즈. 가로축은 실제 시간. */
export function drawEnvelope(canvas, env, accent = 'brass') {
  const { g, w, h } = fit(canvas);
  const hold = Math.max(0.3, env.a + env.d * 0.8);
  const total = hold + env.r * 1.1;
  const pad = 6;
  const steps = 160;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    const v = t <= hold ? envLevel(env, t) : releaseLevel(env, hold, t - hold);
    pts.push([pad + (t / total) * (w - 2 * pad), h - pad - v * (h - 2 * pad)]);
  }
  grid(g, w, h, 4, 2);
  const xHold = pad + (hold / total) * (w - 2 * pad);
  g.strokeStyle = color('line-strong');
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(xHold + 0.5, pad);
  g.lineTo(xHold + 0.5, h - pad);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = color(`${accent}-wash`);
  g.beginPath();
  g.moveTo(pts[0][0], h - pad);
  pts.forEach(([x, y]) => g.lineTo(x, y));
  g.lineTo(pts.at(-1)[0], h - pad);
  g.closePath();
  g.fill();
  g.strokeStyle = color(accent);
  g.lineWidth = 2;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.fillStyle = color('muted');
  g.font = `11px ${color('font-data')}`;
  g.fillText('놓음', Math.min(w - 30, xHold + 4), pad + 10);
  g.fillText(`${total.toFixed(1)}s`, w - 34, h - pad - 3);
}

const respCtx = typeof OfflineAudioContext !== 'undefined' ? new OfflineAudioContext(1, 128, 44100) : null;
const respFilter = respCtx?.createBiquadFilter();

/** 필터 주파수 응답 (20Hz~20kHz 로그 눈금, ±24dB). */
export function drawFilter(canvas, filter) {
  const { g, w, h } = fit(canvas);
  grid(g, w, h, 3, 4);
  if (!respFilter) return;
  respFilter.type = filter.type;
  respFilter.frequency.value = filter.cutoff;
  respFilter.Q.value = filter.q;
  const n = 200;
  const freqs = new Float32Array(n);
  for (let i = 0; i < n; i++) freqs[i] = 20 * 1000 ** (i / (n - 1));
  const mag = new Float32Array(n);
  const ph = new Float32Array(n);
  respFilter.getFrequencyResponse(freqs, mag, ph);
  const yOf = (db) => h / 2 - (Math.max(-24, Math.min(24, db)) / 24) * (h / 2 - 4);
  g.fillStyle = color('signal-wash');
  g.strokeStyle = color('signal');
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = yOf(20 * Math.log10(mag[i] || 1e-6));
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill();
  const xc = (Math.log(filter.cutoff / 20) / Math.log(1000)) * w;
  g.strokeStyle = color('brass');
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(xc, 0);
  g.lineTo(xc, h);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = color('muted');
  g.font = `11px ${color('font-data')}`;
  ['100', '1k', '10k'].forEach((t, i) => g.fillText(t, ((Math.log([100, 1000, 10000][i] / 20) / Math.log(1000)) * w) + 3, h - 4));
}

export function drawScope(canvas, analyser, buf) {
  const { g, w, h } = fit(canvas);
  g.strokeStyle = color('grid');
  g.beginPath();
  g.moveTo(0, h / 2 + 0.5);
  g.lineTo(w, h / 2 + 0.5);
  g.stroke();
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(buf);
  // 위로 올라가는 0 지점에 맞춰 그려 파형이 멈춰 보이게
  let start = 0;
  for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { start = i; break; }
  const span = Math.min(buf.length - start, 1024);
  let peak = 0;
  g.strokeStyle = color('signal');
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < span; i++) {
    const v = buf[start + i];
    peak = Math.max(peak, Math.abs(v));
    const x = (i / (span - 1)) * w;
    const y = h / 2 - v * (h / 2 - 2) * 1.6;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
  return peak;
}

/** 샘플 파형 + 시작/끝/루프 표시. view: { from, to } 샘플 범위. markers: [{ at, label, kind }] */
export function drawSample(canvas, pk, { markers = [], loop = null, region = null, view }) {
  const { g, w, h } = fit(canvas);
  const span = view.to - view.from;
  const xOf = (s) => ((s - view.from) / span) * w;
  if (region) {
    g.fillStyle = color('sunken');
    g.fillRect(0, 0, Math.max(0, xOf(region.start)), h);
    g.fillRect(xOf(region.end), 0, w - xOf(region.end), h);
  }
  if (loop) {
    g.fillStyle = color('brass-wash');
    g.fillRect(xOf(loop.start), 0, xOf(loop.end) - xOf(loop.start), h);
  }
  g.strokeStyle = color('grid');
  g.beginPath();
  g.moveTo(0, h / 2 + 0.5);
  g.lineTo(w, h / 2 + 0.5);
  g.stroke();
  const buckets = pk.length / 2;
  g.fillStyle = color('fg');
  for (let b = 0; b < buckets; b++) {
    const x = (b / buckets) * w;
    const y1 = h / 2 - pk[b * 2 + 1] * (h / 2 - 4);
    const y2 = h / 2 - pk[b * 2] * (h / 2 - 4);
    g.fillRect(x, y1, Math.max(1, w / buckets - 0.3), Math.max(1, y2 - y1));
  }
  g.font = `11px ${color('font-data')}`;
  for (const m of markers) {
    const x = Math.round(xOf(m.at)) + 0.5;
    g.strokeStyle = color(m.kind === 'loop' ? 'brass' : 'muted');
    g.lineWidth = m.active ? 2.5 : 1.5;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
    g.fillStyle = color(m.kind === 'loop' ? 'brass' : 'muted');
    const tw = g.measureText(m.label).width + 8;
    const tx = Math.min(Math.max(0, x - tw / 2), w - tw);
    g.fillRect(tx, m.kind === 'loop' ? 0 : h - 16, tw, 16);
    g.fillStyle = color('brass-ink');
    g.fillText(m.label, tx + 4, m.kind === 'loop' ? 12 : h - 4);
  }
}

/** 이음새: 루프 끝 직전과 루프 시작 직후를 이어 그려 튀는지 본다. */
export function drawSeam(canvas, data, loopStart, loopEnd, sr) {
  const { g, w, h } = fit(canvas);
  const n = Math.round(sr * 0.012);
  const before = data.subarray(Math.max(0, loopEnd - n), loopEnd);
  const after = data.subarray(loopStart, Math.min(data.length, loopStart + n));
  const all = [...before, ...after];
  let peak = 0;
  for (const v of all) peak = Math.max(peak, Math.abs(v));
  const scale = (h / 2 - 4) / (peak || 1);
  g.strokeStyle = color('grid');
  g.beginPath();
  g.moveTo(0, h / 2 + 0.5);
  g.lineTo(w, h / 2 + 0.5);
  g.stroke();
  const mid = (before.length / all.length) * w;
  g.strokeStyle = color('brass');
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(mid, 0);
  g.lineTo(mid, h);
  g.stroke();
  g.setLineDash([]);
  g.lineWidth = 1.8;
  g.strokeStyle = color('signal');
  g.beginPath();
  all.forEach((v, i) => {
    const x = (i / (all.length - 1)) * w;
    const y = h / 2 - v * scale;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  });
  g.stroke();
  g.fillStyle = color('muted');
  g.font = `11px ${color('font-data')}`;
  g.fillText('루프 끝', 4, 12);
  g.fillText('→ 루프 시작', Math.min(w - 70, mid + 4), 12);
}

/** 루퍼 한 트랙: 가로 = 루프 박, 세로 = 음높이. */
export function drawRoll(canvas, notes, beats, beatsPerBar, playhead, accent, recording) {
  const { g, w, h } = fit(canvas);
  for (let b = 0; b <= beats; b++) {
    const x = Math.round((b / beats) * w) + 0.5;
    g.strokeStyle = color(b % beatsPerBar === 0 ? 'line-strong' : 'grid');
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  if (notes.length) {
    const lo = Math.min(...notes.map((n) => n.midi)) - 1;
    const hi = Math.max(...notes.map((n) => n.midi)) + 1;
    const rows = Math.max(6, hi - lo);
    const rh = Math.max(4, (h - 4) / rows);
    g.fillStyle = color(accent);
    for (const n of notes) {
      const x = (n.t / beats) * w;
      const ww = Math.max(2, (Math.min(n.dur, beats - n.t) / beats) * w - 1);
      const y = 2 + ((hi - n.midi) / rows) * (h - 4) - rh / 2;
      g.globalAlpha = 0.45 + 0.55 * n.velocity;
      g.fillRect(x, y, ww, Math.max(2, rh - 1));
      if (n.t + n.dur > beats) g.fillRect(0, y, ((n.t + n.dur - beats) / beats) * w, Math.max(2, rh - 1));
    }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = color('faint');
    g.font = `12px ${color('font-body')}`;
    g.fillText(recording ? '녹음 중 — 건반을 치세요' : '비어 있음', 8, h / 2 + 4);
  }
  if (playhead != null) {
    const x = (playhead / beats) * w;
    g.strokeStyle = color(recording ? 'rec' : 'signal');
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
}

/** 음마다 평균율에서 벗어난 cent 막대 (±range). */
export function drawTuningBars(canvas, cents, names, range = 30, activePc = null) {
  const { g, w, h } = fit(canvas);
  const top = 14;
  const bottom = h - 18;
  const mid = (top + bottom) / 2;
  const yOf = (c) => mid - (Math.max(-range, Math.min(range, c)) / range) * ((bottom - top) / 2);
  g.strokeStyle = color('grid');
  g.font = `11px ${color('font-data')}`;
  g.fillStyle = color('faint');
  for (const c of [-range, -range / 2, 0, range / 2, range]) {
    const y = Math.round(yOf(c)) + 0.5;
    g.beginPath();
    g.moveTo(28, y);
    g.lineTo(w, y);
    g.stroke();
    g.fillText(`${c > 0 ? '+' : ''}${c}`, 0, y + 4);
  }
  const col = (w - 32) / 12;
  cents.forEach((c, i) => {
    const x = 32 + i * col + col * 0.18;
    const bw = col * 0.64;
    const y0 = yOf(0);
    const y1 = yOf(c);
    g.fillStyle = color(i === activePc ? 'signal' : c >= 0 ? 'brass' : 'sky');
    g.fillRect(x, Math.min(y0, y1), bw, Math.max(2, Math.abs(y1 - y0)));
    g.fillStyle = color('muted');
    g.fillText(names[i], x + bw / 2 - g.measureText(names[i]).width / 2, h - 4);
  });
  return { left: 32, col, yToCents: (y) => ((mid - y) / ((bottom - top) / 2)) * range };
}

export function drawNeedle(canvas, cents) {
  const { g, w, h } = fit(canvas);
  const cx = w / 2;
  const cy = h - 8;
  const r = Math.min(w / 2 - 10, h - 20);
  g.lineWidth = 2;
  for (let c = -50; c <= 50; c += 10) {
    const a = (-90 + c * 1.2) * (Math.PI / 180);
    const inner = c === 0 ? r - 16 : r - 8;
    g.strokeStyle = color(c === 0 ? 'signal' : 'line-strong');
    g.beginPath();
    g.moveTo(cx + inner * Math.cos(a), cy + inner * Math.sin(a));
    g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    g.stroke();
  }
  if (cents == null) return;
  const c = Math.max(-50, Math.min(50, cents));
  const a = (-90 + c * 1.2) * (Math.PI / 180);
  g.strokeStyle = color(Math.abs(c) < 5 ? 'signal' : Math.abs(c) < 15 ? 'warn' : 'rec');
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + (r - 4) * Math.cos(a), cy + (r - 4) * Math.sin(a));
  g.stroke();
}
