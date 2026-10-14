"""입력 다듬기: 링크(공유 문구·추적 꼬리·사이트), 받기 실패 안내, 들려주기 녹음 다듬기, 한 악기 녹음 분석."""

from __future__ import annotations

import importlib.util
import io

import numpy as np
import pytest
import soundfile as sf

from band2sheet import audio_io
from band2sheet.audio_io import explain_download_error, link_info, link_title, tidy_recording

# ---------------------------------------------------------------------------
# 링크
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("text, url, platform, label", [
    # 인스타그램 앱에서 복사한 릴스 링크 (추적용 꼬리 ?exln= / ?igsh=)
    ("https://www.instagram.com/reel/DeXtiD_S4FJ/?exln=MXdnNDQ3bnR4Yjh3ZQ==",
     "https://www.instagram.com/reel/DeXtiD_S4FJ/", "instagram", "인스타그램 릴스"),
    # 공유 문구를 통째로, 링크 바로 뒤에 한글이 붙어 와도 링크만
    ("이 릴스 봐봐! https://www.instagram.com/reels/DeXtiD_S4FJ/?igsh=MWQ1ZGUxMzBkMA==에서 퍼옴",
     "https://www.instagram.com/reel/DeXtiD_S4FJ/", "instagram", "인스타그램 릴스"),
    ("https://youtu.be/dQw4w9WgXcQ?si=abcDEF", "https://youtu.be/dQw4w9WgXcQ", "youtube", "유튜브"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&index=3&pp=x",
     "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "유튜브"),
    ("https://youtube.com/shorts/abcdefghijk?feature=share", "https://youtube.com/shorts/abcdefghijk",
     "youtube", "유튜브 쇼츠"),
    ("https://music.youtube.com/watch?v=abc&si=1", "https://music.youtube.com/watch?v=abc", "youtube",
     "유튜브 뮤직"),
    ("https://www.tiktok.com/@u/video/7300000000000000000?is_from_webapp=1&sender_device=pc",
     "https://www.tiktok.com/@u/video/7300000000000000000", "tiktok", "틱톡"),
    ("https://example.com/song.mp3?utm_source=x&token=abc", "https://example.com/song.mp3?token=abc",
     "file", "파일 링크"),
])
def test_link_is_cleaned_and_recognized(text, url, platform, label):
    info = link_info(text)
    assert (info.url, info.platform, info.label, info.problem) == (url, platform, label, None)
    assert info.changed == (url != text)


def test_link_start_time_and_login_hint():
    assert link_info("https://youtu.be/x?t=95").start == 95
    assert link_info("https://www.youtube.com/watch?v=x&t=1m30s").start == 90
    assert link_info("https://www.youtube.com/watch?v=x").start is None
    assert link_info("https://www.instagram.com/reel/abc/").login
    assert not link_info("https://youtu.be/x").login


@pytest.mark.parametrize("text, problem", [
    ("https://www.instagram.com/reels/audio/123456789/", "오디오"),
    ("https://www.instagram.com/someone/", "프로필"),
    ("https://www.youtube.com/playlist?list=PL123", "재생목록"),
    ("https://www.youtube.com/@channel", "영상 하나"),
])
def test_links_that_cannot_be_transcribed_explain_why(text, problem):
    assert problem in link_info(text).problem


def test_text_without_link():
    assert link_info("그냥 글") is None
    assert link_info("") is None
    assert link_info("메일 주소 me@youtube.com/x 는 링크가 아님") is None


def test_link_copied_without_scheme():
    assert link_info("youtu.be/dQw4w9WgXcQ?si=a").url == "https://youtu.be/dQw4w9WgXcQ"
    assert link_info("이거 www.instagram.com/reel/abc/?igsh=1 봐").url == "https://www.instagram.com/reel/abc/"
    assert link_info("example.com/song") is None  # 모르는 사이트는 주소처럼 보여도 링크로 보지 않음


@pytest.mark.parametrize("error, expect", [
    ("ERROR: [Instagram] X: Instagram sent an empty media response. Check if this post is accessible in your "
     "browser without being logged-in. If it is not, then use --cookies-from-browser or --cookies for the "
     "authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ", "로그인"),
    ("ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies",
     "봇이 아님"),
    ("ERROR: [Instagram] x: This content is only available for registered users who follow this account",
     "비공개"),
    ("ERROR: [youtube] x: Video unavailable", "찾을 수 없어요"),
    ("ERROR: Unsupported URL: https://example.com", "받을 수 없는 종류"),
    ("ERROR: [Instagram] x: There is no video in this post", "사진"),
    ("ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271",
     "쿠키"),
    ("ERROR: [generic] Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name "
     "resolution>", "인터넷 연결"),
    ("ERROR: [Instagram] x: Unable to download webpage: ('Unable to connect to proxy', "
     "OSError('Tunnel connection failed: 403 Forbidden'))", "프록시"),
    ("ERROR: [youtube] x: Requested format is not available. Use --list-formats", "사이트가 바뀌어"),
    ("ERROR: something new", "yt-dlp"),
])
def test_download_errors_say_what_to_do(error, expect):
    msg = explain_download_error(error)
    assert expect in msg
    assert "--cookies" not in msg  # 명령줄 옵션 안내는 앱에서 쓸 수 없다


def test_login_error_suggests_listening_instead():
    msg = explain_download_error("ERROR: login required")
    assert "로그인 정보" in msg and "이 컴퓨터 소리 듣기" in msg
    assert "로그인되어 있는지" in explain_download_error("ERROR: login required", cookies_used=True)


def test_link_title_prefers_song_then_caption():
    reel = {"title": "Video by worship_team", "uploader": "worship_team",
            "webpage_url": "https://www.instagram.com/reel/x/",
            "description": "주일 찬양 연습 🎹 #worship #piano\n둘째 줄"}
    assert link_title(reel) == "주일 찬양 연습 🎹"
    assert link_title(dict(reel, description="#only #tags")) == "worship_team 인스타그램 릴스"
    assert link_title({"title": "IU 'Love wins all' MV", "track": "Love wins all", "artist": "IU"}) == \
        "IU - Love wins all"
    assert link_title({"title": "그 곡 라이브"}) == "그 곡 라이브"


class _FakeYDL:
    """yt-dlp 대신: 정해 둔 순서대로 실패/성공한다."""
    script: list = []
    seen: list = []

    def __init__(self, opts):
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def extract_info(self, url, download=True):
        type(self).seen.append(dict(self.opts))
        step = type(self).script.pop(0)
        if isinstance(step, Exception):
            raise step
        out = self.opts["outtmpl"].replace("%(ext)s", "m4a")
        open(out, "wb").write(b"x")
        return {"title": "Video by someone", "description": "캡션 첫 줄", "webpage_url": url,
                "requested_downloads": [{"filepath": out}]}


@pytest.fixture
def fake_ytdlp(monkeypatch):
    yt_dlp = pytest.importorskip("yt_dlp")
    monkeypatch.setattr(yt_dlp, "YoutubeDL", _FakeYDL)
    monkeypatch.setattr(audio_io, "_has_audio", lambda path: True)
    monkeypatch.delenv("BAND2SHEET_COOKIES", raising=False)
    monkeypatch.delenv("BAND2SHEET_COOKIES_FROM_BROWSER", raising=False)
    _FakeYDL.seen = []
    return yt_dlp


def test_login_failure_is_not_retried_as_full_download(fake_ytdlp, tmp_path):
    _FakeYDL.script = [fake_ytdlp.utils.DownloadError("ERROR: [Instagram] x: login required")]
    with pytest.raises(RuntimeError, match="로그인해야"):
        audio_io.download_audio("https://www.instagram.com/reel/x/", tmp_path, start=10, duration=20)
    assert len(_FakeYDL.seen) == 1  # 구간 받기 실패 -> 전체 받기로 다시 해도 같은 결과라 한 번만


def test_unreadable_browser_cookies_fall_back_to_no_login(fake_ytdlp, tmp_path):
    from yt_dlp.cookies import CookieLoadError

    _FakeYDL.script = [CookieLoadError("could not copy Chrome cookie database"), "ok"]
    path, meta = audio_io.download_audio("https://www.instagram.com/reel/x/", tmp_path,
                                         cookies_from_browser="chrome")
    assert path.exists() and meta["title"] == "캡션 첫 줄"
    assert meta["platform"] == "instagram"
    assert _FakeYDL.seen[0]["cookiesfrombrowser"] == ("chrome",)
    assert "cookiesfrombrowser" not in _FakeYDL.seen[1]


def test_cookie_browser_from_environment(fake_ytdlp, tmp_path, monkeypatch):
    monkeypatch.setenv("BAND2SHEET_COOKIES_FROM_BROWSER", "Firefox")
    _FakeYDL.script = ["ok"]
    audio_io.download_audio("https://www.instagram.com/reel/x/", tmp_path)
    assert _FakeYDL.seen[0]["cookiesfrombrowser"] == ("firefox",)
    with pytest.raises(ValueError, match="브라우저"):
        audio_io.download_audio("https://x.invalid/v", tmp_path, cookies_from_browser="netscape")


# ---------------------------------------------------------------------------
# 들려주기 녹음 다듬기
# ---------------------------------------------------------------------------

SR = 22050


def _tone(sec: float, amp: float, f: float = 330.0) -> np.ndarray:
    t = np.arange(int(sec * SR)) / SR
    return amp * np.sin(2 * np.pi * f * t)


def test_tidy_recording_trims_silence_ignores_click_and_raises_level(tmp_path):
    rng = np.random.default_rng(0)
    x = np.concatenate([np.zeros(int(1.5 * SR)), _tone(3.0, 0.05), np.zeros(int(2.0 * SR))])
    x += rng.normal(0, 0.0005, len(x))  # 방 잡음
    x[int(0.2 * SR):int(0.2 * SR) + 100] += 0.08  # 녹음 버튼 클릭
    wav = tmp_path / "rec.wav"
    sf.write(wav, x, SR)
    info = tidy_recording(wav)
    y, _ = sf.read(wav)
    assert 1.1 <= info["trim_start"] <= 1.3  # 1.5초 - 여유 0.3초 (클릭은 시작으로 보지 않음)
    assert 1.6 <= info["trim_end"] <= 1.8
    assert info["gain_db"] > 20 and 0.8 < np.abs(y).max() < 0.95
    assert abs(len(y) / SR - info["duration"]) < 0.01


def test_tidy_recording_leaves_full_recordings_alone(tmp_path):
    wav = tmp_path / "full.wav"
    sf.write(wav, _tone(4.0, 0.7), SR)
    before = wav.read_bytes()
    assert tidy_recording(wav) == {"trim_start": 0.0, "trim_end": 0.0, "gain_db": 0.0, "duration": 4.0}
    assert wav.read_bytes() == before
    silent = tmp_path / "silent.wav"
    sf.write(silent, np.zeros(SR * 2), SR)
    assert tidy_recording(silent)["trim_start"] == 0.0


# ---------------------------------------------------------------------------
# 한 악기(목소리)만 든 녹음: 분리 없이 채보 + 멜로디로 코드
# ---------------------------------------------------------------------------


def test_humming_recording_gets_tempo_key_and_chords_without_separation(tmp_path):
    from band2sheet.pipeline import AnalyzeOptions, analyze, project_chords
    from tests.vocal_songs import SONGS, make_song

    song = make_song(seed=303, **SONGS[3])  # Am | F | C | G | Am | Dm | E | Am, 100 BPM
    rec = np.concatenate([np.zeros(int(1.6 * 44100)), song.audio * 0.15, np.zeros(2 * 44100)])
    wav = tmp_path / "humming.wav"
    sf.write(wav, rec, 44100)
    logs = []
    p = analyze(str(wav), tmp_path / "job", AnalyzeOptions(solo="vocals", tidy=True), log=logs.append)
    assert list(p.stems) == ["vocals"] and p.engines["chords"] == "melody"
    assert any("분리 건너뜀" in m for m in logs) and any("녹음 다듬기" in m for m in logs)
    assert p.key.short_name == "Am" and abs(p.tempo_bpm - 100) < 4
    names = [c.name(p.key) for c in project_chords(p)]
    assert names[:4] == ["Am", "F", "C", "G"], names
    assert p.time_signature == "4/4"


def test_silent_solo_recording_explains_instead_of_empty_sheet(tmp_path):
    from band2sheet.pipeline import AnalyzeOptions, analyze

    wav = tmp_path / "quiet.wav"
    sf.write(wav, np.random.default_rng(1).normal(0, 0.001, 44100 * 3), 44100)
    with pytest.raises(RuntimeError, match="음을 찾지 못했어요"):
        analyze(str(wav), tmp_path / "job", AnalyzeOptions(solo="vocals"), log=lambda m: None)


# ---------------------------------------------------------------------------
# 앱: 링크 미리 확인, 작업 옵션
# ---------------------------------------------------------------------------

needs_app = pytest.mark.skipif(importlib.util.find_spec("fastapi") is None, reason="fastapi 미설치")


@needs_app
def test_app_link_check_and_job_options(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    import band2sheet.app.jobs as jobs
    from band2sheet.app.server import create_app

    seen = []

    def fake_analyze(source, out_dir, opts, log, progress):
        seen.append(opts)
        raise RuntimeError("분석 단계 도달")

    monkeypatch.setattr(jobs, "analyze", fake_analyze)
    app = create_app(tmp_path / "data")
    client = TestClient(app, client=("127.0.0.1", 50000))  # 이 컴퓨터에서 연 화면
    other = TestClient(app, client=("192.168.0.23", 50000))  # 같은 와이파이의 휴대폰
    r = client.get("/api/link", params={"text": "보세요 https://www.instagram.com/reel/abc/?igsh=x"})
    assert r.json()["url"] == "https://www.instagram.com/reel/abc/" and r.json()["label"] == "인스타그램 릴스"
    assert client.get("/api/link", params={"text": "링크 없음"}).json()["url"] is None
    info = client.get("/api/info").json()
    assert "chrome" in info["cookie_browsers"] and "whale" in info["cookie_browsers"]
    assert info["local"] is True and other.get("/api/info").json()["local"] is False
    # 다른 기기는 이 컴퓨터 브라우저의 로그인 정보로 받을 수 없다 (로그인 없이는 됨)
    r = other.post("/api/jobs/url", json={"url": "https://www.instagram.com/reel/abc/",
                                          "options": {"cookies_from_browser": "chrome"}})
    assert r.status_code == 403 and "이 컴퓨터" in r.json()["detail"]

    # 받을 수 없는 링크·잘못된 옵션은 작업을 만들기 전에 알려 준다
    r = client.post("/api/jobs/url", json={"url": "https://www.instagram.com/reels/audio/1/", "options": {}})
    assert r.status_code == 400 and "오디오" in r.json()["detail"]
    r = client.post("/api/jobs/url", json={"url": "https://youtu.be/x", "options": {"cookies_from_browser": "ie"}})
    assert r.status_code == 400
    r = client.post("/api/jobs", files={"file": ("a.webm", io.BytesIO(b"x"))},
                    data={"options": '{"source_kind": "drums"}'})
    assert r.status_code == 400

    # 들려주기 녹음 업로드: 노래·허밍 -> 분리 없이(solo) + 녹음 다듬기(tidy)
    r = client.post("/api/jobs", files={"file": ("recording-20261012-1403.webm", io.BytesIO(b"x"))},
                    data={"options": '{"source_kind": "voice", "capture": "mic", "title": "녹음 10월 12일 14:03"}'})
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]
    for _ in range(100):
        if client.get(f"/api/jobs/{job_id}").json()["status"] == "error":
            break
        import time
        time.sleep(0.05)
    assert seen[-1].solo == "vocals" and seen[-1].tidy is True
    brief = next(j for j in client.get("/api/jobs").json() if j["id"] == job_id)
    assert brief["capture"] == "mic" and brief["title"] == "녹음 10월 12일 14:03" and brief["platform"] is None


@needs_app
def test_app_url_job_cleans_share_text(tmp_path, monkeypatch):
    import band2sheet.app.jobs as jobs
    from band2sheet.app.jobs import JobManager

    manager = JobManager(tmp_path)
    manager.pool.shutdown(wait=True)
    submitted = []
    monkeypatch.setattr(manager, "pool", type("P", (), {"submit": lambda self, fn, *a: submitted.append(a)})())
    job = manager.create_from_url("이 릴스 https://www.instagram.com/reel/DeXtiD_S4FJ/?exln=MXdn 봐줘",
                                  {"cookies_from_browser": "whale"})
    assert job.url == "https://www.instagram.com/reel/DeXtiD_S4FJ/" and submitted
    from band2sheet.app.server import _brief
    assert _brief(job)["platform"] == "instagram"
    with pytest.raises(ValueError):
        manager.create_from_url("링크가 아닌 글", {})
    assert jobs.SOURCE_KINDS == ("auto", "voice", "piano", "guitar")
