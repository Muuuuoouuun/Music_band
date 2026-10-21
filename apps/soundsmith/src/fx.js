// 악기 이펙트 블록 (브라우저 기본 Web Audio 노드만): 비트 줄이기, 페이저, 로터리 스피커(레슬리),
// 좌우 트레몰로, 로파이(테이프 흔들림·대역 좁히기·바이닐 잡음), 시머(옥타브 위로 번지는 잔향).
// 블록마다 { input, output, set(fx, now) } 이고, 악기가 처음 켤 때 만들어 사슬(InsertChain)에 끼운다.

const gainNode = (ctx, v = 1) => {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
};

const smooth = (param, v, now, tau = 0.03) => param.setTargetAtTime(v, now, tau);

/** from → 블록들 → to 를 순서대로 잇는다. 블록 목록이 바뀔 때만 다시 잇는다. */
export class InsertChain {
  constructor(from, to) {
    this.from = from;
    this.to = to;
    this.blocks = [];
    from.connect(to);
  }

  set(blocks) {
    if (blocks.length === this.blocks.length && blocks.every((b, i) => b === this.blocks[i])) return;
    this.from.disconnect();
    for (const b of this.blocks) b.output.disconnect();
    let at = this.from;
    for (const b of blocks) {
      at.connect(b.input);
      at = b.output;
    }
    at.connect(this.to);
    this.blocks = blocks;
  }
}

// ---------------------------------------------------------------------------

/** 비트 줄이기: 계단 모양 곡선 (4~15 bit). 16 이면 악기가 사슬에서 뺀다. */
export function makeBits(ctx) {
  const shaper = ctx.createWaveShaper();
  shaper.oversample = 'none';
  let bits = null;
  return {
    input: shaper,
    output: shaper,
    set(fx) {
      if (fx.bits === bits) return;
      bits = fx.bits;
      const n = 8192;
      const steps = 2 ** (bits - 1);
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.round(x * steps) / steps;
      }
      shaper.curve = curve;
    },
  };
}

/** 페이저: 올패스 4단을 LFO 로 쓸어 원음과 섞는다 (섞는 양 1 = 반반, 골이 가장 깊음). */
export function makePhaser(ctx) {
  const input = gainNode(ctx);
  const output = gainNode(ctx);
  const dry = gainNode(ctx, 1);
  const wet = gainNode(ctx, 0);
  const lfo = ctx.createOscillator();
  const depth = gainNode(ctx, 1500); // cent 단위로 detune 을 흔든다 = 주파수를 지수로 쓸기
  lfo.connect(depth);
  let at = input;
  for (const f of [520, 900, 1500, 2600]) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = f;
    ap.Q.value = 0.6;
    depth.connect(ap.detune);
    at.connect(ap);
    at = ap;
  }
  at.connect(wet).connect(output);
  input.connect(dry).connect(output);
  lfo.start();
  return {
    input,
    output,
    oscillators: [lfo],
    set(fx, now) {
      smooth(dry.gain, 1 - fx.phaser * 0.5, now);
      smooth(wet.gain, fx.phaser * 0.5, now);
      smooth(lfo.frequency, fx.phaserRate, now, 0.1);
    },
  };
}

/** 사인과 90° 앞선 코사인 오실레이터 한 쌍 (같은 빠르기로 움직여 위상이 고정된다). */
function rotorPair(ctx) {
  const sin = ctx.createOscillator();
  const cos = ctx.createOscillator();
  cos.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
  sin.start();
  cos.start();
  return { sin, cos };
}

// 레슬리 122 의 대략 값: 혼(고음)은 빨리 돌고 빨리 가속, 드럼(저음)은 느리게 따라온다.
export const ROTOR = {
  horn: { slow: 0.83, fast: 6.7, up: 0.35, down: 0.7 },
  drum: { slow: 0.67, fast: 5.8, up: 1.6, down: 2.4 },
};

/** 로터리 스피커: 800 Hz 로 나눠 혼·드럼마다 도플러(흔들리는 지연)·음량·좌우를 돌린다. fx.rotaryFast 로 가속·감속. */
export function makeRotary(ctx) {
  const input = gainNode(ctx);
  const output = gainNode(ctx);
  const dry = gainNode(ctx, 1);
  const wet = gainNode(ctx, 0);
  input.connect(dry).connect(output);
  const rotors = {};
  for (const [name, cfg] of Object.entries({
    horn: { type: 'highpass', delay: 0.0025, doppler: 0.0004, am: 0.5, pan: 0.8 },
    drum: { type: 'lowpass', delay: 0.003, doppler: 0.00018, am: 0.28, pan: 0.35 },
  })) {
    const split = ctx.createBiquadFilter();
    split.type = cfg.type;
    split.frequency.value = 800;
    split.Q.value = 0.55;
    const d = ctx.createDelay(0.02);
    d.delayTime.value = cfg.delay;
    const am = gainNode(ctx, 1 - cfg.am / 2);
    const pan = ctx.createStereoPanner();
    const { sin, cos } = rotorPair(ctx);
    sin.connect(gainNode(ctx, cfg.doppler)).connect(d.delayTime);
    sin.connect(gainNode(ctx, cfg.am / 2)).connect(am.gain);
    cos.connect(gainNode(ctx, cfg.pan)).connect(pan.pan);
    input.connect(split).connect(d).connect(am).connect(pan).connect(wet);
    rotors[name] = { sin, cos };
  }
  wet.connect(output);
  let fast = null;
  return {
    input,
    output,
    oscillators: Object.values(rotors).flatMap((r) => [r.sin, r.cos]),
    set(fx, now) {
      smooth(dry.gain, 1 - fx.rotary, now);
      smooth(wet.gain, fx.rotary, now);
      if (fast === fx.rotaryFast) return;
      const first = fast === null;
      fast = fx.rotaryFast;
      for (const [name, r] of Object.entries(rotors)) {
        const c = ROTOR[name];
        const target = fast ? c.fast : c.slow;
        for (const o of [r.sin, r.cos]) {
          if (first) o.frequency.value = target;
          else o.frequency.setTargetAtTime(target, now, fast ? c.up : c.down);
        }
      }
    },
  };
}

/** 좌우 트레몰로 (일렉피아노 서스케이스처럼 소리가 좌우로 오간다). */
export function makeAutoPan(ctx) {
  const pan = ctx.createStereoPanner();
  const lfo = ctx.createOscillator();
  const depth = gainNode(ctx, 0);
  lfo.connect(depth).connect(pan.pan);
  lfo.start();
  return {
    input: pan,
    output: pan,
    oscillators: [lfo],
    set(fx, now) {
      smooth(depth.gain, fx.trem * 0.95, now);
      smooth(lfo.frequency, fx.tremRate, now, 0.1);
    },
  };
}

const crackleCache = new WeakMap();
/** 바이닐 잡음 2초: 아주 작은 쉬익 소리 + 드문드문 튀는 소리. 같은 컨텍스트에서는 한 번만 만든다. */
function crackleBuffer(ctx) {
  if (crackleCache.has(ctx)) return crackleCache.get(ctx);
  const sr = ctx.sampleRate;
  const b = ctx.createBuffer(2, sr * 2, sr);
  let s = 23;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      lp += ((rnd() * 2 - 1) - lp) * 0.15;
      d[i] = lp * 0.12;
    }
    for (let k = 0; k < 18; k++) {
      const at = Math.floor(rnd() * (d.length - 200));
      const amp = (0.3 + rnd() * 0.7) * (rnd() < 0.5 ? -1 : 1);
      for (let i = 0; i < 120; i++) d[at + i] += amp * Math.exp(-i / 18) * (i % 2 ? -1 : 1);
    }
  }
  crackleCache.set(ctx, b);
  return b;
}

/** 로파이: 대역을 좁히고(낮은 쪽·높은 쪽 깎기), 테이프처럼 음정이 흔들리고, 연주하는 동안 바이닐 잡음이 깔린다. */
export function makeLofi(ctx) {
  const input = gainNode(ctx);
  const output = gainNode(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  const wobble = ctx.createDelay(0.05);
  wobble.delayTime.value = 0.012;
  const wow = ctx.createOscillator();
  wow.frequency.value = 0.55;
  const flutter = ctx.createOscillator();
  flutter.frequency.value = 6.3;
  const wowDepth = gainNode(ctx, 0);
  const flutterDepth = gainNode(ctx, 0);
  wow.connect(wowDepth).connect(wobble.delayTime);
  flutter.connect(flutterDepth).connect(wobble.delayTime);
  wow.start();
  flutter.start();
  input.connect(hp).connect(lp).connect(wobble).connect(output);
  const noise = ctx.createBufferSource();
  noise.buffer = crackleBuffer(ctx);
  noise.loop = true;
  const noiseGain = gainNode(ctx, 0);
  noise.connect(noiseGain).connect(output);
  noise.start();
  let amount = 0;
  return {
    input,
    output,
    oscillators: [wow, flutter, noise],
    set(fx, now) {
      amount = fx.lofi;
      smooth(hp.frequency, 20 + 160 * amount, now);
      smooth(lp.frequency, 16000 * (3500 / 16000) ** amount, now);
      smooth(wowDepth.gain, 0.0016 * amount, now);
      smooth(flutterDepth.gain, 0.00018 * amount, now);
    },
    /** 연주 중일 때만 잡음이 들리게 (악기가 소리 날 때 열고, 다 끝나면 천천히 닫는다) */
    gate(open, when) {
      noiseGain.gain.setTargetAtTime(open ? 0.35 * amount : 0, when, open ? 0.02 : 0.4);
    },
  };
}

// ---------------------------------------------------------------------------
// 음정 바꾸기 (도플러 방식): 지연 시간을 톱니 모양으로 계속 줄이면 음이 올라간다. 지연선 두 개를
// 반 주기 어긋나게 돌리고 겹치는 곳을 서로 엇갈려 줄였다 키운다 (Chris Wilson 의 Web Audio 예제와 같은 방식).
// ---------------------------------------------------------------------------

function rampBuffer(ctx, seconds, up) {
  const n = Math.round(seconds * ctx.sampleRate);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = up ? (n - i) / n : i / n;
  return b;
}

function fadeBuffer(ctx, seconds, fade) {
  const n = Math.round(seconds * ctx.sampleRate);
  const f = Math.round(fade * ctx.sampleRate);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = i < f ? Math.sqrt(i / f) : i >= n - f ? Math.sqrt(1 - (i - (n - f)) / f) : 1;
  return b;
}

/** ratio > 1 이면 올림 (2 = 한 옥타브 위). */
export function makePitchShifter(ctx, ratio = 2, { window = 0.1, fade = 0.05 } = {}) {
  const input = gainNode(ctx);
  const output = gainNode(ctx);
  const up = ratio >= 1;
  const span = window * Math.abs(ratio - 1);
  const ramp = rampBuffer(ctx, window, up);
  const fades = fadeBuffer(ctx, window, fade);
  const sources = [];
  const start = ctx.currentTime + 0.02;
  for (let k = 0; k < 2; k++) {
    const d = ctx.createDelay(1);
    const mod = ctx.createBufferSource();
    mod.buffer = ramp;
    mod.loop = true;
    const modGain = gainNode(ctx, span);
    mod.connect(modGain).connect(d.delayTime);
    const mix = gainNode(ctx, 0);
    const fadeSrc = ctx.createBufferSource();
    fadeSrc.buffer = fades;
    fadeSrc.loop = true;
    fadeSrc.connect(mix.gain);
    input.connect(d).connect(mix).connect(output);
    const offset = k * (window - fade);
    mod.start(start + offset);
    fadeSrc.start(start + offset);
    sources.push(mod, fadeSrc);
  }
  return { input, output, oscillators: sources };
}

/** 시머: 잔향을 한 옥타브 올려 다시 잔향에 넣는 고리. 넣을수록 위로 반짝이며 번진다. */
export function makeShimmer(ctx, irFor) {
  const input = gainNode(ctx, 0);
  const sum = gainNode(ctx, 1);
  const verb = ctx.createConvolver();
  verb.buffer = irFor(6);
  const output = gainNode(ctx, 0.9);
  const shift = makePitchShifter(ctx, 2);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 7000;
  const feedback = gainNode(ctx, 0.5);
  input.connect(sum).connect(verb).connect(output);
  verb.connect(shift.input);
  shift.output.connect(tone).connect(feedback).connect(sum);
  return {
    input,
    output,
    oscillators: shift.oscillators,
    set(fx, now) {
      smooth(input.gain, fx.shimmer * 0.7, now);
      smooth(feedback.gain, 0.35 + fx.shimmer * 0.25, now);
    },
  };
}

/** 드로바 9개(16′ 5⅓′ 8′ 4′ 2⅔′ 2′ 1⅗′ 1⅓′ 1′) → 16′ 를 기본음으로 한 배음 번호. */
export const DRAWBAR_HARMONICS = [1, 3, 2, 4, 6, 8, 10, 12, 16];
export const DRAWBAR_LABELS = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'];

/** 드로바 한 칸 = 약 3 dB. 0 은 소리 없음, 8 은 최대. */
export const drawbarGain = (n) => (n <= 0 ? 0 : 10 ** ((-3 * (8 - n)) / 20));

/** PeriodicWave 용 사인 성분 (16′ 기준 배음 1..16). 드로바를 많이 뺄수록 커지도록 정규화하지 않는다. */
export function drawbarSpectrum(bars, scale = 0.22) {
  const imag = new Float32Array(17);
  bars.forEach((n, i) => { imag[DRAWBAR_HARMONICS[i]] += drawbarGain(n) * scale; });
  return imag;
}
