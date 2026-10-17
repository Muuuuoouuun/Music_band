"""풀은 마르고 — 화음 연습용 MP3 만들기 (build.py의 마디 데이터를 그대로 사용).

    python3 render_audio.py        ->  audio/*.mp3

- 전체.mp3          : 세 성부 + 피아노 코드 반주
- 높은화음.mp3 / 멜로디.mp3 / 낮은화음.mp3 : 그 성부만 크게, 나머지는 작게 (파트 연습용)
목소리는 '우~' 비슷한 합성음이고, 반주는 코드만 짚는 피아노 소리다.
"""
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

import build as b

SR = 44100
BPM = 72
RIT_FROM = 51        # 이 마디부터 점점 느리게 (끝날 때 rit.)
COUNT_IN = 4         # 시작 전 박자 세기(딸깍) 수

SEMI = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
CHORD_IV = {'': (0, 4, 7), 'm7': (0, 3, 7, 10), 'sus4': (0, 5, 7), 'm': (0, 3, 7)}


def midi(p):
    step, acc, octv = p
    return 12 * (octv + 1) + SEMI[step] + b.STEP_ALTER.get(acc, 0)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---- 시간축: 마디/박 -> 초 (rit. 반영) ----
def beat_len(measure_no, beat_in_measure):
    if measure_no < RIT_FROM:
        return 60 / BPM
    prog = (measure_no - RIT_FROM) + beat_in_measure / 4      # 0 .. 2
    return 60 / (BPM * max(0.55, 1 - 0.22 * prog))


def build_clock():
    starts = [0.0]
    for n in range(1, len(b.M) + 1):
        t = starts[-1]
        for k in range(16):  # 16분 단위로 적분
            t += beat_len(n, k / 4) / 4
        starts.append(t)
    return starts


CLOCK = build_clock()
OFFSET = COUNT_IN * 60 / BPM


def at(measure_idx, div_pos):
    """measure_idx: 0부터, div_pos: 마디 안의 위치(DIV 단위)."""
    n = measure_idx + 1
    t = CLOCK[measure_idx]
    beats = div_pos / b.DIV
    whole = int(beats * 4)
    for k in range(whole):
        t += beat_len(n, k / 4) / 4
    t += (beats * 4 - whole) * beat_len(n, whole / 4) / 4
    return OFFSET + t


def part_notes(idx):
    """붙임줄을 합친 (시작초, 끝초, midi) 목록."""
    notes = []
    carry = None
    for mi, m in enumerate(b.M):
        pos = 0
        for pitch, dur, tie in b.parse(m[idx]):
            s, e = at(mi, pos), at(mi, pos + dur)
            if pitch is not None:
                if carry is not None:
                    notes[carry] = (notes[carry][0], e, notes[carry][2])
                else:
                    notes.append((s, e, midi(pitch)))
                carry = len(notes) - 1 if tie else None
            pos += dur
    return notes


# ---- 소리 ----
def voice(f0, dur, seed):
    """'우~' 비슷한 목소리: 배음 + 비브라토 + 숨소리 조금."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib_depth = np.clip((t - 0.25) / 0.4, 0, 1) * 0.006
    f = f0 * (1 + vib_depth * np.sin(2 * np.pi * 5.2 * t + rng.uniform(0, 6)))
    phase = 2 * np.pi * np.cumsum(f) / SR
    sig = np.zeros(n)
    for h in range(1, 9):
        fh = f0 * h
        # '우' 모음 포먼트(약 350Hz, 800Hz) 근처를 살린다
        g = np.exp(-((fh - 350) / 260) ** 2) + 0.35 * np.exp(-((fh - 800) / 300) ** 2) + 0.04 / h
        sig += g * np.sin(h * phase + rng.uniform(0, 6))
    breath = rng.normal(0, 1, n)
    breath = np.convolve(breath, np.ones(30) / 30, mode='same') * 0.015
    sig = sig / 1.2 + breath
    a, r = min(0.08, dur / 3), min(0.12, dur / 3)
    env = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    env[:na] = np.linspace(0, 1, na) ** 1.5
    env[-nr:] *= np.linspace(1, 0, nr)
    return sig * env


def piano(f0, dur):
    n = int((dur + 0.6) * SR)
    t = np.arange(n) / SR
    sig = sum((0.6 ** (h - 1)) * np.sin(2 * np.pi * f0 * h * t * (1 + 0.0004 * h * h)) for h in range(1, 7))
    env = np.exp(-t * 1.6) * (1 - np.exp(-t * 300))
    rel = np.clip((dur + 0.6 - t) / 0.6, 0, 1)
    return sig * env * rel


def click(strong):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * (1600 if strong else 1100) * t) * np.exp(-t * 90)


def add(buf, sig, start):
    i = int(start * SR)
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[:j - i]


def chord_events():
    ev = []
    for mi, m in enumerate(b.M):
        for off, name in sorted(m[0]):
            ev.append((mi, off, name))
    out = []
    for k, (mi, off, name) in enumerate(ev):
        s = at(mi, off * b.DIV)
        if k + 1 < len(ev):
            e = at(ev[k + 1][0], ev[k + 1][1] * b.DIV)
        else:
            e = at(len(b.M) - 1, 48)
        out.append((s, e, name))
    return out


def chord_midis(name):
    bass = None
    if '/' in name:
        name, bass = name.split('/')
    root = SEMI[name[0]] - (1 if name[1:2] == 'b' else 0)
    kind = name[1 + (name[1:2] == 'b'):]
    tones = [60 + ((root + iv) % 12) for iv in CHORD_IV[kind]]   # C4 위 한 옥타브 안
    tones = [x - 12 if x > 67 else x for x in tones]
    low = SEMI[bass] if bass else root
    return 40 + (low - 4) % 12, tones   # 베이스는 E2~D#3 사이


def accompaniment(total):
    buf = np.zeros(total)
    for s, e, name in chord_events():
        bass, tones = chord_midis(name)
        add(buf, piano(hz(bass), e - s) * 0.5, s)
        # 2박마다 화음을 다시 짚는다
        t = s
        while t < e - 0.05:
            seg = min(e - t, 2 * 60 / BPM)
            for x in tones:
                add(buf, piano(hz(x), seg) * 0.22, t + 0.01)
            t += 2 * 60 / BPM
    return buf


def render(levels, acc_level):
    total = int((at(len(b.M) - 1, 48) + 3) * SR)
    mix = np.zeros((total, 2))
    pans = {1: -0.45, 2: 0.0, 4: 0.45}
    for idx, lvl in levels.items():
        if lvl == 0:
            continue
        buf = np.zeros(total)
        for k, (s, e, m) in enumerate(part_notes(idx)):
            add(buf, voice(hz(m), e - s + 0.03, seed=idx * 1000 + k), s)
        p = pans[idx]
        mix[:, 0] += buf * lvl * (1 - p) / 2 * 2
        mix[:, 1] += buf * lvl * (1 + p) / 2 * 2
    acc = accompaniment(total) * acc_level
    mix += acc[:, None]
    for k in range(COUNT_IN):
        add(mix[:, 0], click(k == 0) * 0.3, k * 60 / BPM)
        add(mix[:, 1], click(k == 0) * 0.3, k * 60 / BPM)
    # 간단한 잔향
    rev = np.zeros_like(mix)
    for d, g in ((0.031, 0.25), (0.047, 0.2), (0.071, 0.15), (0.11, 0.1), (0.17, 0.06)):
        n = int(d * SR)
        rev[n:] += mix[:-n] * g
    mix = mix + rev[:, ::-1] * 0.8
    mix /= np.abs(mix).max() / 0.89
    return mix


def save_mp3(mix, path):
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / 'a.wav'
        with wave.open(str(wav), 'wb') as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((mix * 32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-codec:a', 'libmp3lame',
                        '-b:a', '192k', str(path)], check=True)


if __name__ == '__main__':
    out = Path(__file__).parent / 'audio'
    out.mkdir(exist_ok=True)
    jobs = {
        '전체': ({1: 0.8, 2: 1.0, 4: 0.8}, 0.55),
        '높은화음': ({1: 1.0, 2: 0.35, 4: 0.25}, 0.4),
        '멜로디': ({1: 0.25, 2: 1.0, 4: 0.25}, 0.4),
        '낮은화음': ({1: 0.25, 2: 0.35, 4: 1.0}, 0.4),
    }
    for name, (lv, acc) in jobs.items():
        save_mp3(render(lv, acc), out / f'풀은마르고-{name}.mp3')
        print(name, 'ok')
