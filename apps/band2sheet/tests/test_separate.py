import importlib.util

import numpy as np
import pytest
import soundfile as sf

from band2sheet.separate import stem_level_db

needs_demucs = pytest.mark.skipif(importlib.util.find_spec("demucs") is None, reason="demucs 미설치")


def test_stem_level_db():
    mix = np.ones(100)
    assert abs(stem_level_db(mix * 0.1, mix) - (-20.0)) < 1e-6


@needs_demucs
@pytest.mark.slow
def test_separate_with_random_model(tmp_path, monkeypatch):
    """가중치 다운로드 없이(무작위 초기화 모델) Demucs 호출 흐름과 출력 파일을 확인."""
    import demucs.pretrained
    from demucs.htdemucs import HTDemucs

    from band2sheet import separate as sep

    sources = ["drums", "bass", "other", "vocals", "guitar", "piano"]
    monkeypatch.setattr(demucs.pretrained, "get_model",
                        lambda name: HTDemucs(sources=sources))
    sr = 44100
    t = np.arange(sr * 2) / sr
    sf.write(tmp_path / "mix.wav", np.stack([np.sin(2 * np.pi * 220 * t)] * 2, axis=1) * 0.3, sr)
    paths = sep.separate(tmp_path / "mix.wav", tmp_path / "stems", device="cpu")
    assert set(paths) == set(sources)
    audio, rate = sf.read(paths["vocals"])
    assert rate == sr and audio.shape[1] == 2 and abs(len(audio) - sr * 2) < 10


needs_torch = pytest.mark.skipif(importlib.util.find_spec("torch") is None, reason="torch 미설치")


def _mirror(tmp_path, payload: bytes, name_hash: str | None = None):
    """file:// 로 흉내 낸 예비 받을 곳과, 내용의 SHA-256 앞 8자리를 이름에 단 가중치 파일."""
    import hashlib

    h = name_hash or hashlib.sha256(payload).hexdigest()[:8]
    name = f"abcd1234-{h}.th"
    mirror = tmp_path / "mirror"
    mirror.mkdir()
    (mirror / name).write_bytes(payload)
    return name, mirror.as_uri() + "/"


@needs_torch
def test_demucs_weights_come_from_the_mirror_when_hash_matches(tmp_path, monkeypatch):
    from band2sheet import separate as sep

    name, url = _mirror(tmp_path, b"weights")
    monkeypatch.setenv("TORCH_HOME", str(tmp_path / "torch"))
    monkeypatch.setenv("BAND2SHEET_DEMUCS_MIRROR", url)
    monkeypatch.setattr(sep, "_demucs_weight_files", lambda model: [name])
    logs = []
    got = sep.fetch_demucs_weights("htdemucs", logs.append)
    assert [p.name for p in got] == [name]
    assert got[0].read_bytes() == b"weights" and got[0].parent.name == "checkpoints"
    assert not list(got[0].parent.glob("*.part"))
    assert sep.fetch_demucs_weights("htdemucs") == []  # 이미 있고 해시가 맞으면 다시 받지 않음


@needs_torch
def test_demucs_mirror_rejects_a_file_whose_hash_differs(tmp_path, monkeypatch):
    from band2sheet import separate as sep

    name, url = _mirror(tmp_path, b"tampered", name_hash="00000000")
    monkeypatch.setenv("TORCH_HOME", str(tmp_path / "torch"))
    monkeypatch.setenv("BAND2SHEET_DEMUCS_MIRROR", url)
    monkeypatch.setattr(sep, "_demucs_weight_files", lambda model: [name])
    logs = []
    assert sep.fetch_demucs_weights("htdemucs", logs.append) == []
    ckpt = tmp_path / "torch" / "hub" / "checkpoints"
    assert not (ckpt / name).exists() and not list(ckpt.glob("*.part"))
    assert any("해시" in m for m in logs)


@needs_demucs
def test_demucs_model_load_retries_after_mirror_fetch(monkeypatch):
    import demucs.pretrained

    from band2sheet import separate as sep

    calls = []

    def flaky(name):
        calls.append(name)
        if len(calls) == 1:
            raise RuntimeError("blocked")
        return "model"

    monkeypatch.setattr(demucs.pretrained, "get_model", flaky)
    monkeypatch.setattr(sep, "fetch_demucs_weights", lambda name, log=None: ["x.th"])
    assert sep.load_demucs_model("htdemucs") == "model" and calls == ["htdemucs", "htdemucs"]
    # 예비 받을 곳에서도 받은 것이 없으면 처음 오류를 그대로 알린다
    calls.clear()
    monkeypatch.setattr(sep, "fetch_demucs_weights", lambda name, log=None: [])
    with pytest.raises(RuntimeError, match="blocked"):
        sep.load_demucs_model("htdemucs")


def test_demucs_mirror_env_can_disable_or_replace(monkeypatch):
    from band2sheet import separate as sep

    monkeypatch.setenv("BAND2SHEET_DEMUCS_MIRROR", "")
    assert sep._demucs_mirrors() == []
    monkeypatch.setenv("BAND2SHEET_DEMUCS_MIRROR", "https://a.example/x, https://b.example/y/")
    assert sep._demucs_mirrors() == ["https://a.example/x/", "https://b.example/y/"]
    monkeypatch.delenv("BAND2SHEET_DEMUCS_MIRROR")
    assert sep._demucs_mirrors() == list(sep.DEMUCS_MIRRORS)
