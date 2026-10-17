"""내 진정 사모하는 (F.I.A 버전) — 보컬 분리 음원과 새 화음 음원 만들기.

    python render_audio.py --stems <Demucs 스템 폴더> --lead lead.wav --chorus chorus.wav [--out audio]

준비물 (band2sheet 로 만든 것):
  --stems   band2sheet run 결과의 stems/ (drums·bass·guitar·piano·other.wav)
  --lead    stems/vocals.wav 를 Mel-RoFormer Karaoke 로 나눈 메인 보컬
  --chorus  같은 분리의 나머지(코러스)

화음은 악보(arrangement.py)의 윗화음·아랫화음 음을 목표로, 메인 보컬을 PSOLA 로 옮겨 만든다.
그래서 음원 속 화음과 악보가 같은 음이다. 인도자가 악보 멜로디와 다르게 부른 곳(애드리브)과
README 분할표에서 화음이 없는 구간은 소리를 내지 않는다.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.ndimage import uniform_filter1d

import arrangement as A

HERE = Path(__file__).resolve().parent
SR = 44100
OCTAVE = 12  # 영상의 남성 인도자는 악보보다 한 옥타브 아래로 부른다


def eighth_grid() -> np.ndarray:
    b = np.array(json.loads((HERE / "beats.json").read_text(encoding="utf-8"))["beats"])
    return np.sort(np.r_[b, (b[:-1] + b[1:]) / 2])


def targets(e: np.ndarray) -> list[tuple[float, float, int, int | None, int | None]]:
    """(시작, 끝, 멜로디, 윗화음, 아랫화음) — 영상 시간축의 8분음표 칸마다. 분할표에 없는 파트는 None."""
    out = []
    prev_next = None
    for name, t, nxt in A.TIMELINE:
        i0 = int(np.argmin(np.abs(e - t)))
        ev = A.eighths(A.phrase_bars(name, nxt))
        cells = list(enumerate(ev))
        if prev_next != name:  # 앞 프레이즈가 못갖춘 음을 갖고 있지 않으면 여기서 붙인다
            pv = A.eighths([dict(notes=A.PICKUP_C if name == "c" else A.PICKUP_AB)])
            cells = [(k - len(pv), v) for k, v in enumerate(pv)] + cells
        parts = A.PARTS.get(t, ())
        for k, (mel, hi, lo) in cells:
            if mel is None or i0 + k + 1 >= len(e):
                continue
            out.append((e[i0 + k], e[i0 + k + 1], mel - OCTAVE,
                        hi - OCTAVE if hi is not None and "hi" in parts else None,
                        lo - OCTAVE if lo is not None and "lo" in parts else None))
        prev_next = nxt
    return out


def pitch_track(lead: np.ndarray, cache: Path):
    from band2sheet.vocalfx import ANALYSIS_SR, PitchTrack, track_pitch

    if cache.exists():
        z = np.load(cache)
        return PitchTrack(z["times"], z["midi"])
    import librosa

    tr = track_pitch(librosa.resample(lead, orig_sr=SR, target_sr=ANALYSIS_SR), ANALYSIS_SR)
    np.savez(cache, times=tr.times, midi=tr.midi)
    return tr


def harmony_voice(lead: np.ndarray, track, cells, which: int, seed: int) -> np.ndarray:
    """which = 3(윗화음) / 4(아랫화음). 악보 음 - 부르려던 음(비브라토 걸러낸 곡선) 만큼 옮긴다."""
    from band2sheet.vocalfx import _reference, psola_shift

    ref = _reference(track)
    shift = np.zeros(len(ref))
    gate = np.zeros(len(ref))
    ft = track.times
    for t0, t1, mel, *hl in cells:
        target = hl[which - 3]
        if target is None:
            continue
        m = (ft >= t0) & (ft < t1) & ~np.isnan(ref)
        # 악보 멜로디에서 1.5 반음 넘게 벗어나면(애드리브·옥타브 올림) 화음을 붙이지 않는다
        m &= np.abs(ref - mel) <= 1.5
        shift[m] = target - ref[m]
        gate[m] = 1.0
    # 칸 사이 빈틈은 앞 값으로 이어 PSOLA 가 엉뚱한 이동량을 보간하지 않게
    last = 0.0
    for i in range(len(shift)):
        if gate[i]:
            last = shift[i]
        else:
            shift[i] = last
    y = psola_shift(lead, SR, track, shift, voiced_only=True, jitter_cents=5.0, seed=seed)
    g = uniform_filter1d(np.interp(np.arange(len(y)) / SR, ft, gate), size=int(0.03 * SR))
    return y * g


def mp3(y: np.ndarray, path: Path, kbps: int = 128) -> Path:
    wav = path.with_suffix(".wav")
    sf.write(wav, np.clip(y, -1, 1), SR)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-b:a", f"{kbps}k", str(path)], check=True)
    wav.unlink()
    print("  ", path.name)
    return path


def main():
    from band2sheet.remix import _master
    from band2sheet.vocalfx import add_reverb, delay, pan

    ap = argparse.ArgumentParser()
    ap.add_argument("--stems", type=Path, required=True)
    ap.add_argument("--lead", type=Path, required=True)
    ap.add_argument("--chorus", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=HERE / "audio")
    ap.add_argument("--work", type=Path, default=None, help="음높이 캐시 폴더 (기본: --out)")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    def load(p):
        y, sr = sf.read(p, always_2d=True)
        assert sr == SR, (p, sr)
        return y

    mr = sum(load(a.stems / f"{s}.wav") for s in ("drums", "bass", "guitar", "piano", "other"))
    lead2, chorus = load(a.lead), load(a.chorus)
    n = min(len(mr), len(lead2), len(chorus))
    mr, lead2, chorus = mr[:n], lead2[:n], chorus[:n]
    lead = lead2.mean(axis=1)

    print("음높이 분석 · 화음 만드는 중")
    track = pitch_track(lead, (a.work or a.out) / "lead_track.npz")
    cells = targets(eighth_grid())
    hi = harmony_voice(lead, track, cells, 3, seed=1)
    lo = harmony_voice(lead, track, cells, 4, seed=2)

    def stereo_voice(x, pos, d):
        return add_reverb(pan(delay(x, SR, d), pos), SR, wet=0.25, seconds=1.8)

    hi_s, lo_s = stereo_voice(hi, -0.4, 0.018), stereo_voice(lo, 0.4, 0.027)
    lead_s = add_reverb(pan(lead, 0.0), SR, wet=0.12, seconds=1.6)

    print("파일 쓰는 중")
    mp3(lead2, a.out / "01_main-vocal.mp3")
    mp3(chorus, a.out / "02_chorus-original.mp3")
    mp3(mr, a.out / "03_MR-no-vocals.mp3", 160)
    for x, name in ((hi_s, "04_new-harmony-high.mp3"), (lo_s, "05_new-harmony-low.mp3")):
        mp3(x * (0.7 / (np.abs(x).max() or 1.0)), a.out / name)  # 화음 없는 구간이 많아 피크로 맞춤
    h = 0.55  # 화음 음량 (리드 대비)
    mp3(_master(mr + lead_s + h * (hi_s + lo_s)), a.out / "06_mix-MR+lead+new-harmony.mp3", 160)
    mp3(_master(mr * 0.8 + lead_s * 0.5 + hi_s * 1.0 + lo_s * 0.25), a.out / "07_practice-high.mp3", 160)
    mp3(_master(mr * 0.8 + lead_s * 0.5 + hi_s * 0.25 + lo_s * 1.0), a.out / "08_practice-low.mp3", 160)
    mp3(_master(mr + 0.7 * chorus), a.out / "09_practice-lead-MR+chorus.mp3", 160)


if __name__ == "__main__":
    main()
