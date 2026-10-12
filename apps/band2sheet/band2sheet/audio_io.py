"""입력 처리: 유튜브 링크 다운로드(영상/오디오), 음성 추출, 로컬 오디오/영상 파일을 WAV 로 변환."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

URL_RE = re.compile(r"^https?://", re.I)


def is_url(text: str) -> bool:
    return bool(URL_RE.match(text.strip()))


# ---------------------------------------------------------------------------
# 링크 다듬기: 공유 문구에서 링크 꺼내기, 추적용 꼬리 떼기, 어느 사이트인지 알아보기
# ---------------------------------------------------------------------------

# 한글이 링크 바로 뒤에 붙어 와도("…/reel/abc에서") 링크만 꺼내도록 URL 에 쓰는 ASCII 문자만
_URL_IN_TEXT = re.compile(r"https?://[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+", re.I)
# 어느 사이트든 지워도 되는 공유·광고 추적 꼬리
_TRACKING = {"si", "igsh", "igshid", "exln", "fbclid", "gclid", "mibextid", "rdid", "share_url",
             "is_from_webapp", "sender_device", "share_app_id", "share_link_id", "_r", "_t", "xmt"}
_MEDIA_EXT = (".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".mp4", ".mov", ".m4v",
              ".webm", ".mkv")
# yt-dlp 가 로그인 정보(쿠키)를 읽을 수 있는 브라우저 (whale = 네이버 웨일)
COOKIE_BROWSERS = ("chrome", "edge", "safari", "firefox", "whale", "brave", "opera", "vivaldi",
                   "chromium")


@dataclass
class LinkInfo:
    url: str  # 정리한 링크 (받기에 씀)
    platform: str  # youtube | instagram | tiktok | facebook | x | soundcloud | vimeo | naver | file | other
    label: str  # 화면에 보일 이름 ("인스타그램 릴스")
    start: float | None = None  # 링크에 들어 있던 시작 위치 (?t=1m30s)
    login: bool = False  # 로그인이 필요할 때가 많은 사이트
    problem: str | None = None  # 받을 수 없는 링크면 그 이유
    changed: bool = False  # 붙여 넣은 글과 다른지 (공유 문구·추적 꼬리를 정리함)

    def to_dict(self) -> dict:
        return asdict(self)


# https:// 없이 복사한 주소 ("youtu.be/abc", "instagram.com/reel/abc")는 아는 사이트만 링크로 본다
_BARE_URL = re.compile(r"(?<![\w.@/])(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|instagram\.com|instagr\.am|"
                       r"tiktok\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|soundcloud\.com|vimeo\.com|"
                       r"tv\.naver\.com)/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+", re.I)


def extract_url(text: str) -> str | None:
    """붙여 넣은 글(앱 '공유' 문구 등)에서 첫 링크를 꺼낸다. 없으면 None."""
    m = _URL_IN_TEXT.search(text or "")
    if m:
        return m.group(0).rstrip(".,;:!?'\"")
    m = _BARE_URL.search(text or "")
    return "https://" + m.group(0).rstrip(".,;:!?'\"") if m else None


def _seconds(value: str) -> float | None:
    """'90', '90s', '1m30s', '1h2m3s', '1:30' -> 초."""
    value = (value or "").strip().lower()
    if re.fullmatch(r"\d+(\.\d+)?s?", value):
        return float(value.rstrip("s"))
    m = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", value)
    if m and any(m.groups()):
        h, mi, s = (int(x or 0) for x in m.groups())
        return float(h * 3600 + mi * 60 + s)
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{2})", value)
    if m:
        h, mi, s = (int(x or 0) for x in m.groups())
        return float(h * 3600 + mi * 60 + s)
    return None


def _host(netloc: str) -> str:
    host = netloc.lower().rsplit("@", 1)[-1].split(":")[0]
    for prefix in ("www.", "m.", "mobile."):
        if host.startswith(prefix):
            host = host[len(prefix):]
    return host


def link_info(text: str) -> LinkInfo | None:
    """붙여 넣은 글 -> 받을 링크와 사이트 정보. 링크가 없으면 None. (네트워크를 쓰지 않음)"""
    raw = extract_url(text)
    if raw is None:
        return None
    parts = urlsplit(raw)
    host = _host(parts.netloc)
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    query = parse_qsl(parts.query, keep_blank_values=True)
    fragment = parts.fragment
    start = None
    for k, v in query:
        if k in ("t", "start", "time_continue"):
            start = _seconds(v)
    if fragment.startswith("t="):
        start = _seconds(fragment[2:])

    def keep(*names: str) -> list[tuple[str, str]]:
        return [(k, v) for k, v in query if k in names]

    login, problem = False, None
    if host in ("youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"):
        platform = "youtube"
        label = "유튜브 뮤직" if host == "music.youtube.com" else "유튜브 쇼츠" if path.startswith("/shorts/") \
            else "유튜브 라이브" if path.startswith("/live/") else "유튜브"
        query = keep("v", "t", "start")
        fragment = ""
        if not any(k == "v" for k, _ in query) and (
                path in ("/", "/results", "/feed/subscriptions") or path.startswith(("/@", "/channel/", "/c/"))):
            problem = "영상 하나의 링크가 아니에요. 곡이 나오는 영상을 열고 그 주소(공유 → 링크 복사)를 넣어 주세요."
        elif path == "/playlist":
            problem = "재생목록 링크예요. 목록 안의 영상 하나를 열고 그 주소를 넣어 주세요."
    elif host in ("instagram.com", "instagr.am"):
        platform, login = "instagram", True
        path = re.sub(r"^/reels/(?!audio/)", "/reel/", path)
        label = "인스타그램 릴스" if "/reel/" in path else "인스타그램 스토리" if path.startswith("/stories/") \
            else "인스타그램 게시물" if "/p/" in path or "/tv/" in path else "인스타그램"
        query, fragment = [], ""  # 인스타그램 링크는 주소만으로 충분 (?igsh= 등은 공유 추적용)
        if path.startswith("/reels/audio/") or path.startswith("/reel/audio/"):
            problem = "인스타그램 '오디오(음원)' 페이지예요. 이 음원을 쓴 릴스를 열고 그 릴스 링크를 넣어 주세요."
        elif not re.search(r"/(reel|p|tv|stories|share)/", path):
            problem = "계정(프로필) 링크예요. 릴스나 게시물 하나를 열고 그 링크를 넣어 주세요."
    elif host.endswith("tiktok.com"):
        platform, label = "tiktok", "틱톡"
        query, fragment = [], ""
    elif host in ("facebook.com", "fb.watch", "fb.com"):
        platform, label, login = "facebook", "페이스북", True
        query = keep("v", "story_fbid", "id")
    elif host in ("twitter.com", "x.com"):
        platform, label, login = "x", "X(트위터)", True
        query = []
    elif host.endswith("soundcloud.com"):
        platform, label = "soundcloud", "사운드클라우드"
        query = [(k, v) for k, v in query if not k.startswith("utm_") and k not in ("si", "ref")]
    elif host.endswith("vimeo.com"):
        platform, label = "vimeo", "비메오"
    elif host in ("tv.naver.com", "chzzk.naver.com"):
        platform, label = "naver", "네이버TV" if host == "tv.naver.com" else "치지직"
    elif path.lower().endswith(_MEDIA_EXT):
        platform, label = "file", "파일 링크"
    else:
        platform, label = "other", host or "링크"
    query = [(k, v) for k, v in query if k not in _TRACKING and not k.startswith("utm_")]
    url = urlunsplit((parts.scheme.lower(), parts.netloc, path, urlencode(query), fragment))
    return LinkInfo(url=url, platform=platform, label=label, start=start, login=login, problem=problem,
                    changed=url != (text or "").strip())


def default_cookies() -> tuple[str | None, str | None]:
    """환경 변수로 정한 기본 로그인 정보: (쿠키 파일, 브라우저 이름)."""
    browser = (os.environ.get("BAND2SHEET_COOKIES_FROM_BROWSER") or "").strip().lower() or None
    return (os.environ.get("BAND2SHEET_COOKIES") or None,
            browser if browser in COOKIE_BROWSERS else None)


_ANSI = re.compile(r"\x1b\[[0-9;]*m")
CAPTURE_HINT = "또는 그 영상을 브라우저에서 틀어 두고 새 작업의 '이 컴퓨터 소리 듣기'로 바로 채보할 수 있어요."


def explain_download_error(err: object, cookies_used: bool = False) -> str:
    """yt-dlp 오류 -> 무엇을 하면 되는지 알려 주는 한국어 안내 (원래 메시지는 끝에 짧게)."""
    raw = _ANSI.sub("", str(err)).strip()
    raw = re.sub(r"^(ERROR:\s*)+", "", raw)
    # yt-dlp 명령줄 옵션 안내(--cookies …)는 앱에서는 쓸 수 없으니 뗀다
    short = re.split(r"(?i)[ .]*(?:if it is not, then )?use --(?:cookies|username)|\. See +https://", raw)[0].strip()
    if len(short) > 220:
        short = short[:220] + "…"
    low = raw.lower()
    if cookies_used:
        login_fix = ("고른 브라우저에서 그 사이트에 로그인되어 있는지 확인하세요. "
                     "브라우저를 완전히 닫고 다시 시도하면 될 때도 있어요.")
    else:
        login_fix = "받기 옵션의 '로그인 정보'에서 그 사이트에 로그인해 둔 브라우저를 골라 다시 시도하세요."
    if any(s in low for s in ("could not copy", "cookie database", "failed to decrypt", "could not find",
                              "cookieloaderror", "unsupported browser", "keyring")) and "cookie" in low:
        msg = ("브라우저 로그인 정보(쿠키)를 읽지 못했어요. 그 브라우저를 완전히 닫고 다시 시도하거나, "
               "다른 브라우저(Firefox 등)를 골라 보세요.")
    elif "not a bot" in low:
        msg = f"유튜브가 '봇이 아님 확인'을 요구해요. {login_fix} {CAPTURE_HINT}"
    elif "confirm your age" in low or "age-restricted" in low or "inappropriate for some users" in low:
        msg = f"연령 확인이 필요한 영상이에요. {login_fix}"
    elif "follow this account" in low or "private video" in low or "is private" in low:
        msg = f"비공개 영상(또는 팔로우해야 볼 수 있는 계정)이에요. {login_fix} {CAPTURE_HINT}"
    elif "rate-limit" in low or "rate limit" in low or "too many requests" in low or "http error 429" in low:
        msg = (f"짧은 시간에 너무 많이 받아서 사이트가 잠시 막았어요. 몇 분 뒤 다시 시도하거나, "
               f"{login_fix} {CAPTURE_HINT}")
    elif any(s in low for s in ("login", "log in", "logged-in", "sign in", "registered users",
                                "empty media response", "restricted video", "authentication")):
        msg = f"이 링크는 로그인해야 받을 수 있어요. {login_fix} {CAPTURE_HINT}"
    elif "no video in this post" in low or "no video formats found" in low:
        msg = "영상이 없는 게시물(사진)이에요. 소리가 있는 릴스·영상 링크를 넣어 주세요."
    elif "unsupported url" in low:
        msg = "받을 수 없는 종류의 링크예요. 영상 하나를 연 화면의 주소(공유 → 링크 복사)인지 확인하세요."
    elif any(s in low for s in ("your country", "geo restrict", "geo-restrict", "your location")):
        msg = "이 지역에서는 볼 수 없는 영상이에요."
    elif "requested format is not available" in low or "unable to extract" in low or "signature" in low:
        msg = f"사이트가 바뀌어 받는 방법이 맞지 않아요. {YTDLP_HINT}"
    elif any(s in low for s in ("video unavailable", "has been removed", "no longer available", "not available",
                                "does not exist", "http error 404", "page not found", "deleted")):
        msg = ("영상을 찾을 수 없어요. 삭제됐거나 비공개로 바뀌었을 수 있어요. "
               "링크가 브라우저에서 열리는지 확인하세요.")
    elif any(s in low for s in ("timed out", "name resolution", "getaddrinfo", "network is unreachable",
                                "connection reset", "connection refused", "failed to resolve", "ssl:",
                                "certificate verify",
                                "unable to connect", "proxy", "tunnel connection", "remote end closed",
                                "connection aborted", "max retries")):
        msg = ("인터넷 연결(프록시·방화벽 포함) 문제로 그 사이트에 접속하지 못했어요. 연결을 확인하고 다시 시도하세요. "
               "브라우저에서는 열리는데 여기서만 안 되면 그 영상을 틀어 두고 "
               "새 작업의 '이 컴퓨터 소리 듣기'로 들려주세요.")
    else:
        msg = f"링크에서 소리를 받지 못했어요. {YTDLP_HINT}"
    return f"{msg}\n(자세히: {short})" if short else msg


def safe_name(text: str, limit: int = 80) -> str:
    text = re.sub(r"[\\/:*?\"<>|\s]+", "_", text).strip("._")
    return text[:limit] or "song"


def require_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg 가 필요합니다. https://ffmpeg.org 에서 설치해 PATH 에 추가하세요.")
    return exe


YTDLP_HINT = "yt-dlp 를 최신으로 올려 보세요: pip install -U yt-dlp"


def _ytdlp():
    try:
        import yt_dlp
    except ImportError as e:  # pragma: no cover - 설치 안내
        raise RuntimeError("유튜브 다운로드에는 yt-dlp 가 필요합니다: pip install yt-dlp") from e
    return yt_dlp


def _section(start: float | None, duration: float | None) -> tuple[float, float] | None:
    """--start/--duration -> 받을 구간 (초). 없으면 None (전체)."""
    if not start and not duration:
        return None
    s = float(start or 0.0)
    return s, (s + float(duration)) if duration else float("inf")


def _ytdlp_opts(out_dir: Path, stem: str, progress: Callable[[float, str], None] | None,
                cookies: str | None, cookies_from_browser: str | None,
                first_label: str = "영상", section: tuple[float, float] | None = None) -> dict:
    opts: dict = {
        "outtmpl": str(out_dir / f"{stem}.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "concurrent_fragment_downloads": 4,  # DASH 조각 병렬 받기
    }
    if section:
        from yt_dlp.utils import download_range_func

        # 필요한 구간만 받기 (긴 실황에서 한 곡만 쓸 때 다운로드량이 크게 줄어듦)
        opts["download_ranges"] = download_range_func(None, [section])
    if cookies:
        opts["cookiefile"] = str(Path(cookies).expanduser())
    if cookies_from_browser:
        browser = cookies_from_browser.strip().lower()
        if browser not in COOKIE_BROWSERS:
            raise ValueError(f"로그인 정보를 읽을 수 없는 브라우저입니다: {cookies_from_browser} "
                             f"(가능: {', '.join(COOKIE_BROWSERS)})")
        opts["cookiesfrombrowser"] = (browser,)
    if progress:
        state = {"n": 0, "file": None}

        def hook(d: dict) -> None:
            # 영상+음성 따로 받는 형식이면 파일 두 개를 차례로 받는다.
            if d.get("filename") != state["file"]:
                state["file"] = d.get("filename")
                state["n"] += 1
            what = first_label if state["n"] == 1 else "음성 트랙"
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                frac = min(1.0, d.get("downloaded_bytes", 0) / total) if total else 0.0
                mb = d.get("downloaded_bytes", 0) / 1048576
                progress(frac, f"{what} 받는 중 {frac * 100:.0f}% ({mb:.1f} MB)")
            elif d.get("status") == "finished":
                progress(1.0, f"{what} 받기 완료")

        opts["progress_hooks"] = [hook]
    return opts


def _downloaded_path(info: dict, out_dir: Path, stem: str) -> Path:
    for d in info.get("requested_downloads") or []:
        f = d.get("filepath")
        if f and Path(f).exists():
            return Path(f)
    candidates = sorted(p for p in out_dir.glob(f"{stem}.*") if p.suffix not in (".part", ".ytdl"))
    if not candidates:
        raise RuntimeError("다운로드한 파일을 찾지 못했습니다.")
    return candidates[0]


_GENERIC_TITLE = re.compile(r"^((video|post|reel|clip)( by \S+)?|video \d+|tiktok video.*|instagram|"
                            r"facebook|youtube|untitled|\d+)$", re.I)


def link_title(info: dict) -> str:
    """받은 영상의 이름. 곡 정보(가수 - 곡) > 영상 제목 > 게시글 첫 줄 > 올린 사람.

    인스타그램 릴스는 제목이 'Video by 아이디' 뿐이라 게시글(캡션) 첫 줄을 쓴다 (해시태그는 뺌).
    """
    track = (info.get("track") or "").strip()
    artist = (info.get("artist") or ", ".join(info.get("artists") or []) or "").strip()
    if track and artist:
        return f"{artist} - {track}"
    title = re.sub(r"\s+", " ", info.get("title") or "").strip()
    if title and not _GENERIC_TITLE.match(title):
        return title
    for line in (info.get("description") or "").splitlines():
        line = re.sub(r"[#@][^\s#@]+", "", line)  # 해시태그·멘션
        line = re.sub(r"\s+", " ", line).strip(" .·-|")
        if len(line) >= 2:
            return line if len(line) <= 60 else line[:59].rstrip() + "…"
    who = info.get("uploader") or info.get("channel") or info.get("uploader_id")
    if who:
        li = link_info(info.get("webpage_url") or "")
        return f"{who} {li.label if li and li.platform != 'other' else '영상'}"
    return title or "링크"


def _meta(info: dict, url: str) -> dict:
    li = link_info(info.get("webpage_url") or url)
    return {
        "title": link_title(info),
        "url": info.get("webpage_url") or url,
        "id": info.get("id"),
        "uploader": info.get("uploader") or info.get("channel") or info.get("uploader_id"),
        "duration": info.get("duration"),
        "width": info.get("width"),
        "height": info.get("height"),
        "platform": li.platform if li else None,
        "platform_label": li.label if li else None,
        "thumbnail": info.get("thumbnail"),
        "track": info.get("track"),
        "artist": info.get("artist"),
    }


def _extract(yt_dlp, url: str, opts: dict, progress: Callable[[float, str], None] | None) -> dict:
    """yt-dlp 실행. 고른 브라우저의 로그인 정보를 못 읽으면 로그인 없이 한 번 더 시도한다
    (공개 영상이면 그대로 받아지고, 아니면 '로그인 정보를 못 읽음' 안내가 나간다)."""
    cookie_error = None
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=True)
    except yt_dlp.utils.YoutubeDLError as e:
        cookies_err = getattr(getattr(yt_dlp, "cookies", None), "CookieLoadError", ())
        if not (opts.get("cookiesfrombrowser") and (isinstance(e, cookies_err) or "cookie" in str(e).lower()
                                                    and "could not" in str(e).lower())):
            raise
        cookie_error = e
    if progress:
        progress(0.0, "브라우저 로그인 정보를 읽지 못해 로그인 없이 받는 중")
    opts = {k: v for k, v in opts.items() if k != "cookiesfrombrowser"}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=True)
    except yt_dlp.utils.YoutubeDLError as e:
        raise yt_dlp.utils.DownloadError(f"{e} (cookie: {cookie_error})") from e


def download_video(url: str, out_dir: Path, max_height: int = 1080, stem: str = "video",
                   progress: Callable[[float, str], None] | None = None,
                   cookies: str | None = None,
                   cookies_from_browser: str | None = None) -> tuple[Path, dict]:
    """yt-dlp 로 영상(화면+소리)을 MP4 로 내려받는다. 반환: (영상 파일, 영상 정보)."""
    yt_dlp = _ytdlp()
    require_ffmpeg()  # 화면/소리 합치기에 필요
    out_dir.mkdir(parents=True, exist_ok=True)
    if not cookies and not cookies_from_browser:
        cookies, cookies_from_browser = default_cookies()
    opts = _ytdlp_opts(out_dir, stem, progress, cookies, cookies_from_browser)
    h = int(max_height)
    # MP4(H.264+AAC) 우선 -> 어디서나 재생. 없으면 아무 형식이나 받아 MP4 컨테이너로 합친다.
    opts["format"] = (f"bv*[height<=?{h}][ext=mp4]+ba[ext=m4a]/b[height<=?{h}][ext=mp4]/"
                      f"bv*[height<=?{h}]+ba/b[height<=?{h}]/bv*+ba/b")
    opts["merge_output_format"] = "mp4"
    try:
        info = _extract(yt_dlp, url, opts, progress)
    except yt_dlp.utils.YoutubeDLError as e:
        raise RuntimeError(explain_download_error(e, bool(cookies or cookies_from_browser))) from e
    return _downloaded_path(info, out_dir, stem), _meta(info, url)


def download_audio(url: str, out_dir: Path, stem: str = "source",
                   progress: Callable[[float, str], None] | None = None,
                   cookies: str | None = None, cookies_from_browser: str | None = None,
                   prefer_ext: str | None = None, start: float | None = None,
                   duration: float | None = None) -> tuple[Path, dict]:
    """yt-dlp 로 소리만 내려받는다 (영상보다 훨씬 작고 빠름). 반환: (오디오 파일, 영상 정보).

    start/duration 을 주면 그 구간만 받는다 (meta["section"] 에 기록). 구간 받기가 안 되는
    사이트면 전체를 받고 meta["section"] 은 None — 이때는 호출한 쪽에서 잘라야 한다.
    prefer_ext="m4a" 면 AAC 스트림을 골라 다시 인코딩하지 않고 저장할 수 있게 한다.
    """
    yt_dlp = _ytdlp()
    out_dir.mkdir(parents=True, exist_ok=True)
    if not cookies and not cookies_from_browser:
        cookies, cookies_from_browser = default_cookies()
    section = _section(start, duration)
    fmt = (f"bestaudio[ext={prefer_ext}]/" if prefer_ext else "") + "bestaudio/best"
    err = None
    for sec in ([section, None] if section else [None]):
        opts = _ytdlp_opts(out_dir, stem, progress, cookies, cookies_from_browser,
                           first_label="음성", section=sec)
        opts["format"] = fmt
        try:
            info = _extract(yt_dlp, url, opts, progress)
            path = _downloaded_path(info, out_dir, stem)
            if sec and not _has_audio(path):
                raise RuntimeError("구간 받기 결과가 비어 있음")
        except (yt_dlp.utils.YoutubeDLError, RuntimeError) as e:
            if err is None or not isinstance(e, RuntimeError):
                err = e  # 처음 실패한 이유(로그인 필요 등)를 알린다
            for f in out_dir.glob(f"{stem}.*"):  # 실패한 구간 파일 지우고 전체 받기로 재시도
                f.unlink(missing_ok=True)
            if _hopeless(e):
                break  # 로그인·삭제 같은 문제는 전체 받기로 바꿔도 같다
            continue
        section_info = [sec[0], None if sec[1] == float("inf") else sec[1]] if sec else None
        return path, dict(_meta(info, url), section=section_info)
    raise RuntimeError(explain_download_error(err, bool(cookies or cookies_from_browser))) from err


_HOPELESS = ("login", "log in", "logged-in", "sign in", "registered users", "not a bot", "private",
             "unsupported url", "video unavailable", "has been removed", "no video in this post",
             "rate-limit", "too many requests", "your country", "empty media response", "follow this account")


def _hopeless(err: Exception) -> bool:
    """구간 받기와 상관없는 오류 (전체 받기로 다시 해도 같은 결과)."""
    low = str(err).lower()
    return any(s in low for s in _HOPELESS)


def probe_audio_codec(path: Path) -> str | None:
    exe = shutil.which("ffprobe")
    if not exe:
        return None
    out = subprocess.run([exe, "-v", "error", "-select_streams", "a:0", "-show_entries",
                          "stream=codec_name", "-of", "default=nw=1:nk=1", str(path)],
                         capture_output=True, text=True)
    return out.stdout.strip() or None


def _has_audio(path: Path) -> bool:
    if not path.exists() or path.stat().st_size == 0:
        return False
    return probe_audio_codec(path) is not None if shutil.which("ffprobe") else True


AUDIO_CODECS = {
    # 확장자: ffmpeg 인코딩 옵션
    "wav": ["-c:a", "pcm_s16le"],
    "flac": ["-c:a", "flac"],
    "mp3": ["-c:a", "libmp3lame", "-q:a", "0"],
    "m4a": ["-c:a", "aac", "-b:a", "256k"],
}


def extract_audio(src: Path, dst: Path, sr: int = 44100, start: float | None = None,
                  duration: float | None = None) -> Path:
    """영상/음원 파일에서 소리만 뽑아 dst 확장자(wav/flac/mp3/m4a) 형식으로 저장한다."""
    fmt = dst.suffix.lower().lstrip(".")
    if fmt not in AUDIO_CODECS:
        raise ValueError(f"지원하지 않는 음성 형식입니다: {fmt} (가능: {', '.join(AUDIO_CODECS)})")
    if not Path(src).exists():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {src}")
    ffmpeg = require_ffmpeg()
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [ffmpeg, "-y", "-loglevel", "error"]
    if start:
        cmd += ["-ss", str(start)]
    cmd += ["-i", str(src)]
    if duration:
        cmd += ["-t", str(duration)]
    if fmt == "m4a" and probe_audio_codec(src) == "aac":
        # 이미 AAC 면 다시 인코딩하지 않고 그대로 복사 (빠르고 음질 손실 없음)
        cmd += ["-vn", "-c:a", "copy", str(dst)]
    else:
        cmd += ["-vn", "-ac", "2", "-ar", str(sr), *AUDIO_CODECS[fmt], str(dst)]
    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode != 0:
        msg = (done.stderr or "").strip().splitlines()
        if fmt == "mp3" and any("libmp3lame" in m or "Unknown encoder" in m for m in msg):
            raise RuntimeError("이 ffmpeg 에는 MP3 인코더가 없습니다. wav/m4a 로 받아 주세요.")
        raise RuntimeError("음성 추출에 실패했습니다: " + (msg[-1] if msg else f"ffmpeg 오류 {done.returncode}"))
    if not dst.exists() or dst.stat().st_size == 0:
        raise RuntimeError("음성 추출 결과가 비어 있습니다 (소리 트랙이 없는 영상일 수 있어요).")
    return dst


@dataclass
class FetchResult:
    title: str
    audio: Path
    video: Path | None = None
    meta: dict = field(default_factory=dict)


def fetch(source: str, out_dir: Path, audio_format: str = "wav", keep_video: bool = False,
          max_height: int = 1080, start: float | None = None, duration: float | None = None,
          progress: Callable[[float, str], None] | None = None, cookies: str | None = None,
          cookies_from_browser: str | None = None) -> FetchResult:
    """유튜브 링크(또는 영상 파일) -> 음성만 다운로드(기본, keep_video 면 영상도) -> 음성 추출.

    결과: out_dir/<제목>.<audio_format> (음성), (keep_video) out_dir/<제목>.mp4, out_dir/info.json
    음성만 받을 때 start/duration 을 주면 그 구간만 내려받는다.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    fmt = audio_format.lower().lstrip(".")
    if fmt not in AUDIO_CODECS:
        raise ValueError(f"지원하지 않는 음성 형식입니다: {fmt} (가능: {', '.join(AUDIO_CODECS)})")
    report = progress or (lambda f, m: None)
    if is_url(source):
        tmp = out_dir / ".download"
        if keep_video:
            raw, meta = download_video(source, tmp, max_height, progress=report, cookies=cookies,
                                       cookies_from_browser=cookies_from_browser)
        else:
            raw, meta = download_audio(source, tmp, progress=report, cookies=cookies,
                                       cookies_from_browser=cookies_from_browser,
                                       prefer_ext="m4a" if fmt == "m4a" else None,
                                       start=start, duration=duration)
    else:
        raw = Path(source).expanduser()
        if not raw.exists():
            raise FileNotFoundError(f"파일을 찾을 수 없습니다: {raw}")
        meta, tmp = {"title": raw.stem, "file": str(raw)}, None
    name = safe_name(meta["title"])
    video = None
    if is_url(source) and keep_video:
        video = out_dir / f"{name}{raw.suffix.lower()}"
        video.unlink(missing_ok=True)  # 같은 영상을 다시 받을 때 (Windows 는 덮어쓰기 이동 불가)
        shutil.move(str(raw), video)
        raw = video
    report(1.0, "음성 추출 중")
    cut = not meta.get("section")  # 구간만 받았으면 이미 잘려 있음
    audio = extract_audio(raw, out_dir / f"{name}.{fmt}", start=start if cut else None,
                          duration=duration if cut else None)
    if tmp is not None:
        shutil.rmtree(tmp, ignore_errors=True)
    meta = dict(meta, start=start, duration_cut=duration, video=video.name if video else None,
                audio=audio.name)
    (out_dir / "info.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return FetchResult(title=meta["title"], audio=audio, video=video, meta=meta)


def to_wav(src: Path, dst: Path, sr: int = 44100, start: float | None = None,
           duration: float | None = None) -> Path:
    """ffmpeg 로 임의의 오디오/영상 파일을 스테레오 WAV 로 변환 (구간 자르기 지원)."""
    ffmpeg = require_ffmpeg()
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [ffmpeg, "-y", "-loglevel", "error"]
    if start:
        cmd += ["-ss", str(start)]
    cmd += ["-i", str(src)]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += ["-vn", "-ac", "2", "-ar", str(sr), "-c:a", "pcm_s16le", str(dst)]
    subprocess.run(cmd, check=True)
    return dst


def tidy_recording(path: Path, margin: float = 0.3, min_sound: float = 0.12) -> dict:
    """직접 녹음한 소리 다듬기 (제자리 저장): 앞뒤 조용한 부분 자르기 + 작게 녹음됐으면 키우기.

    녹음 버튼을 누르고 연주를 시작하기 전·끝낸 뒤의 빈 소리가 빈 마디가 되지 않게 한다.
    '소리'의 기준은 방 잡음보다 12 dB 위(그래도 곡에서 큰 부분보다 26 dB 아래까지는 소리로 본다)이고,
    min_sound(초)보다 짧은 소리(마우스 클릭, 책상 두드림)는 연주의 시작·끝으로 보지 않는다.
    """
    import numpy as np
    import soundfile as sf

    audio, sr = sf.read(str(path), always_2d=True)
    n = len(audio)
    out = {"trim_start": 0.0, "trim_end": 0.0, "gain_db": 0.0, "duration": round(n / sr, 2)}
    hop = max(1, int(sr * 0.02))
    frames = n // hop
    if frames < 10:
        return out
    mono = audio.mean(axis=1)
    rms = np.sqrt(np.mean(mono[: frames * hop].reshape(frames, hop) ** 2, axis=1))
    ref = float(np.percentile(rms, 95))
    if ref < 1e-5:  # 아무 소리도 없는 녹음
        return out
    floor = float(np.percentile(rms, 10))
    thr = max(ref * 10 ** (-40 / 20), min(floor * 4.0, ref * 10 ** (-26 / 20)))
    run = max(1, int(round(min_sound * sr / hop)))
    loud = rms > thr
    # run 프레임 이상 이어진 소리만 (짧은 클릭 제외)
    steady = np.convolve(loud.astype(float), np.ones(run), mode="valid") >= run - 0.5
    idx = np.flatnonzero(steady)
    if not idx.size:
        return out
    a = max(0, int(idx[0]) * hop - int(margin * sr))
    b = min(n, (int(idx[-1]) + run) * hop + int(margin * sr))
    if b - a < sr:  # 1초도 안 남으면 자르지 않음
        a, b = 0, n
    clip = audio[a:b]
    peak = float(np.abs(clip).max())
    gain = 1.0
    if 1e-4 < peak < 0.5:  # 작게 녹음된 소리는 -1 dBFS 까지 (크게는 바꾸지 않음)
        gain = min(0.89 / peak, 30.0)
        clip = clip * gain
    if (a, b) == (0, n) and gain == 1.0:
        return out
    sf.write(str(path), clip, sr, subtype="PCM_16")
    out.update(trim_start=round(a / sr, 2), trim_end=round((n - b) / sr, 2),
               gain_db=round(20 * float(np.log10(gain)), 1), duration=round(len(clip) / sr, 2))
    return out


def prepare_input(source: str, work_dir: Path, start: float | None = None,
                  duration: float | None = None) -> tuple[Path, str]:
    """유튜브 URL 또는 파일 경로를 받아 작업 폴더에 mix.wav 를 만든다. 반환: (wav, 제목)."""
    work_dir.mkdir(parents=True, exist_ok=True)
    mix = work_dir / "mix.wav"
    if is_url(source):
        raw, meta = download_audio(source, work_dir / "download", start=start, duration=duration)
        title = meta["title"]
        if meta.get("section"):  # 구간만 받았으면 다시 자르지 않음
            start = duration = None
    else:
        raw = Path(source).expanduser()
        if not raw.exists():
            raise FileNotFoundError(f"파일을 찾을 수 없습니다: {raw}")
        title = raw.stem
    to_wav(raw, mix, start=start, duration=duration)
    return mix, title
