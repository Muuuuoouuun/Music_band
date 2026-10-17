"""우리 주 하나님 — 화음 연습용 MP3 만들기 (build.py 의 마디 데이터를 그대로 사용).

    python3 render_audio.py        ->  audio/*.mp3

라이브 영상(6:41)에서 확인한 순서 그대로 펼친다 (전주 생략, 시작 전 딸깍 4번):
    A → A'1 → B → (1st) → A'2 → B → B → (2nd) → C×4 → C'×3
누가 언제 부르는지는 README 의 분할표를 따른다.

- 전체.mp3                      : 세 성부 + 피아노 코드
- 윗화음.mp3 / 멜로디.mp3 / 아랫화음.mp3 : 그 성부만 크게, 나머지는 작게
목소리는 합성음이라 음 높이·박자 확인용이다.
"""
from __future__ import annotations

import copy
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
from music21 import harmony, pitch

import build as b

SR = 44100
BEAT = 60 / b.BPM
COUNT_IN = 4
OUT = Path(__file__).resolve().parent / "audio"
ALL = ("hi", "mel", "lo")


def with_pickup(spec, mel, hi, lo):
    """마지막 박 쉼표 자리에 다음 후렴의 '거—' 를 넣은 마디 (B→B, C'→C' 바로 이어 부를 때)."""
    n = copy.deepcopy(spec)
    n["mel"] = n["mel"][:-1] + [(mel[0], .5, "거"), (mel[1], .5, "")]
    n["hi"] = n["hi"][:-1] + list(hi)
    n["lo"] = n["lo"][:-1] + list(lo)
    return n


def swap_verse2(spec):
    """2절 '오셔서 다스리소서': 리드가 원곡 악보의 위 음을 부르므로 멜로디·아랫화음 줄을 바꾼다."""
    n = copy.deepcopy(spec)

    def above(lo, p):
        return lo not in (None, b.R) and p != b.R and pitch.Pitch(lo.rstrip("~")).ps > pitch.Pitch(p.rstrip("~")).ps

    pairs = [((p, d, t), lo) for (p, d, t), lo in zip(n["mel"], n["lo"])]
    n["mel"] = [(lo if above(lo, p) else p, d, t) for (p, d, t), lo in pairs]
    n["lo"] = [p if above(lo, p) else lo for (p, _, _), lo in pairs]
    return n


def last_time_chords(spec, chords):
    n = copy.deepcopy(spec)
    n["chords"] = chords
    return n


def roadmap():
    """(마디, 부르는 성부) 목록."""
    seq = []

    def add(measures, parts):
        seq.extend((m, parts) for m in measures)

    add(b.A[:-1], ("mel",))
    add(b.A[-1:], ("mel",))
    # A'1: 멜로디 유니즌, '주의 말씀 이루시리' 부터 아랫화음
    add(b.A2[:5], ("mel",))
    add(b.A2[5:8], ("mel", "lo"))
    add(b.A2[8:], ("mel", "lo"))
    add(b.B, ("mel", "lo"))                      # B 1회: 멜로디 + 아랫화음
    add([b.B_END1], ALL)
    add(b.A2[:5], ALL)                            # A'2: 3성부
    add([swap_verse2(m) for m in b.A2[5:8]], ALL)
    add(b.A2[8:], ALL)
    add(b.B[:-1], ALL)                            # B 2회 → 3회 바로 이어서
    add([with_pickup(b.B[-1], ("B4", "A#4"), ("D#5", "C#5"), ("F#4", "F#4"))], ALL)
    add(b.B, ALL)
    add([b.B_END2], ALL)
    add(b.C, ("mel",))                            # C ×4: 유니즌 → +아랫화음 → 3성부 ×2
    add(b.C, ("mel", "lo"))
    add(b.C, ALL)
    last = [last_time_chords(b.C[0], [(0, "G#m7"), (3, "A#m7")]),
            last_time_chords(b.C[1], [(0, "B")])] + b.C[2:]
    add(last, ALL)
    add([b.C2_PICKUP], ALL)
    for k in range(3):                            # C' ×3 (마지막 회만 끝마디)
        body = b.C2 if k == 2 else b.C2[:-1] + [
            with_pickup(b.C2[-1], ("C#5", "B#4"), ("E#5", "D#5"), ("G#4", "G#4"))]
        add(body, ALL)
    return seq


def events():
    """성부별 (시작초, 길이초, midi) 와 코드 (시작초, 길이초, [midi])."""
    notes = {r: [] for r in ALL}
    chords = []
    t0 = COUNT_IN * BEAT
    seq = roadmap()
    total_beats = sum(sum(d for _, d, _ in m["mel"]) for m, _ in seq)
    rit_from = total_beats - 8  # 마지막 두 마디 rit.

    def sec(beat):
        if beat <= rit_from:
            return t0 + beat * BEAT
        x = beat - rit_from
        return t0 + rit_from * BEAT + BEAT * (x + 0.06 * x * x)

    pos = 0.0
    carry = {r: None for r in ALL}
    pending_chord = None
    for spec, parts in seq:
        for off, name in spec["chords"]:
            if pending_chord:
                chords.append((pending_chord[0], sec(pos + off) - pending_chord[0], pending_chord[1]))
            pending_chord = (sec(pos + off), chord_midis(name))
        for role in ALL:
            line = [p for p, _, _ in spec["mel"]] if role == "mel" else spec[role]
            beat = pos
            for i, (_, d, _) in enumerate(spec["mel"]):
                p = None if line is None else line[i]
                if p in (None, b.R) or role not in parts:
                    carry[role] = None
                    beat += d
                    continue
                tied = p.endswith("~")
                m = pitch.Pitch(p.rstrip("~")).midi
                if carry[role] is not None:
                    s, _, cm = notes[role][carry[role]]
                    notes[role][carry[role]] = (s, sec(beat + d) - s, cm)
                else:
                    notes[role].append((sec(beat), sec(beat + d) - sec(beat), m))
                carry[role] = len(notes[role]) - 1 if tied else None
                beat += d
        pos += sum(d for _, d, _ in spec["mel"])
    if pending_chord:
        chords.append((pending_chord[0], sec(pos) - pending_chord[0] + 1.5, pending_chord[1]))
    return notes, chords, sec(pos) + 2.5


def chord_midis(name):
    """베이스(C2~B2) + 코드음(F3~E4 안)."""
    cs = harmony.ChordSymbol(name.replace("B2/", "Badd9/").replace("C#/F", "C#/E#"))
    pcs = sorted({p.midi % 12 for p in cs.pitches})
    return [36 + cs.bass().midi % 12] + [60 + pc if pc < 5 else 48 + pc for pc in pcs]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def voice(dur, m, seed):
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.3 * t + rng.uniform(0, 6)) * np.clip((t - 0.15) / 0.3, 0, 1)
    phase = 2 * np.pi * np.cumsum(hz(m) * vib) / SR
    sig = sum((0.9 ** k) / k * np.sin(k * phase) for k in range(1, 9))
    env = np.minimum(1, t / 0.05) * np.minimum(1, (dur - t) / 0.08).clip(0, 1)
    return sig * env * 0.18


def piano(dur, ms):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in ms:
        f = hz(m)
        out += sum(np.sin(2 * np.pi * f * k * t) * (0.5 ** k) for k in (1, 2, 3)) * np.exp(-t * 1.6)
    env = np.minimum(1, t / 0.005) * np.minimum(1, (dur - t) / 0.05).clip(0, 1)
    return out * env * 0.05


def click(n_total):
    out = np.zeros(n_total)
    for k in range(COUNT_IN):
        s = int(k * BEAT * SR)
        t = np.arange(int(0.03 * SR)) / SR
        out[s:s + len(t)] += np.sin(2 * np.pi * (1500 if k == 0 else 1000) * t) * np.exp(-t * 120) * 0.4
    return out


def mix(focus, notes, chords, length):
    n = int(length * SR)
    L, Rc = np.zeros(n), np.zeros(n)
    pan = {"hi": (0.8, 0.45), "mel": (0.7, 0.7), "lo": (0.45, 0.8)}
    for role, evs in notes.items():
        g = 1.0 if focus in (None, role) else 0.28
        if focus is None:
            g = 0.8
        for i, (s, d, m) in enumerate(evs):
            seg = voice(d, m, i * 3 + ALL.index(role)) * g
            a = int(s * SR)
            L[a:a + len(seg)] += seg * pan[role][0]
            Rc[a:a + len(seg)] += seg * pan[role][1]
    for s, d, ms in chords:
        seg = piano(d, ms)
        a = int(s * SR)
        L[a:a + len(seg)] += seg
        Rc[a:a + len(seg)] += seg
    c = click(n)
    L += c
    Rc += c
    out = np.stack([L, Rc], 1)
    peak = np.abs(out).max()
    return out / peak * 0.89 if peak > 0 else out


def write_mp3(data, path):
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((data * 32767).astype("<i2").tobytes())
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name, "-b:a", "128k", str(path)], check=True)


def main():
    OUT.mkdir(exist_ok=True)
    notes, chords, length = events()
    for focus, name in ((None, "전체"), ("hi", "윗화음"), ("mel", "멜로디"), ("lo", "아랫화음")):
        write_mp3(mix(focus, notes, chords, length), OUT / f"우리주하나님-{name}.mp3")
    print(f"ok: audio/ ({int(length // 60)}분 {length % 60:.0f}초, ♩={b.BPM})")


if __name__ == "__main__":
    main()
