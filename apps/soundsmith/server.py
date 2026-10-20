"""음색 공방 로컬 도우미: 앱 파일을 보여 주고, 유튜브·음원 링크에서 소리를 받아 브라우저에 넘긴다.

    python3 server.py            # http://127.0.0.1:8010
    python3 server.py --port 8020

브라우저는 다른 사이트(유튜브)의 소리를 직접 받을 수 없어서, 이 도우미가 yt-dlp(있으면)나 ffmpeg 로
고른 구간만 받아 AAC(.m4a)로 바꿔 준다. 이 컴퓨터(127.0.0.1)에서만 열리고, 다른 사이트의 페이지가
몰래 부를 수 없도록 Origin·Host 를 확인한다. 받은 파일은 .cache/links 에 하루 동안 둔다.

    GET  /api/health  → {"link": true, "ytdlp": true, "ffmpeg": true}
    POST /api/fetch   {"url": "https://…", "start": 0, "duration": 120} → audio/mp4
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

APP_DIR = Path(__file__).resolve().parent
CACHE_DIR = APP_DIR / ".cache" / "links"
MAX_SECONDS = 600  # 한 번에 받는 길이 (10분)
MAX_BODY = 4096
COOKIES_FROM_BROWSER: str | None = None

try:  # 선택: 없으면 ffmpeg 로 바로 읽을 수 있는 음원 링크만 된다
    import yt_dlp  # type: ignore
except ImportError:  # pragma: no cover - 설치 여부에 따라
    yt_dlp = None


def ffmpeg_path() -> str | None:
    return shutil.which("ffmpeg")


class FetchError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def parse_request(body: bytes) -> tuple[str, float, float]:
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise FetchError("요청을 읽지 못했어요.") from e
    url = str(data.get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or len(url) > 2000 or any(c.isspace() for c in url):
        raise FetchError("http:// 나 https:// 로 시작하는 링크를 넣어 주세요.")
    try:
        start = max(0.0, float(data.get("start") or 0))
        duration = float(data.get("duration") or 180)
    except (TypeError, ValueError) as e:
        raise FetchError("구간(시작·길이)은 초 단위 숫자로 넣어 주세요.") from e
    if not 0 < duration <= MAX_SECONDS:
        raise FetchError(f"한 번에 {MAX_SECONDS // 60}분까지 받을 수 있어요.")
    return url, start, duration


def _download_ytdlp(url: str, start: float, duration: float, work: Path) -> tuple[Path, str, bool]:
    """yt-dlp 로 소리만 받는다. 고른 구간만 받기를 먼저 해 보고, 안 되면 전체를 받는다.
    반환: (파일, 제목, 구간만 받았는지)."""
    from yt_dlp.utils import DownloadError, download_range_func  # type: ignore

    err: Exception | None = None
    for section in (True, False):
        opts = {
            "format": "bestaudio/best",
            "outtmpl": str(work / "src.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "max_filesize": 300 * 1024 * 1024,
            "socket_timeout": 30,
        }
        runtimes = {name: {} for name in ("deno", "node", "bun") if shutil.which(name)}
        if runtimes:  # 유튜브는 JS 런타임이 있어야 형식을 다 볼 수 있다 (AirChoir 용 node 가 있으면 그걸로)
            opts["js_runtimes"] = runtimes
        if COOKIES_FROM_BROWSER:  # 로그인·봇 확인이 필요한 영상: --cookies-from-browser chrome
            opts["cookiesfrombrowser"] = (COOKIES_FROM_BROWSER,)
        if section:
            opts["download_ranges"] = download_range_func(None, [(start, start + duration)])
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
        except DownloadError as e:
            err = e
            info = None
        files = [f for f in work.glob("src.*") if f.suffix not in (".part", ".ytdl") and f.stat().st_size > 0]
        if info and files:
            # 구간 받기가 중간에 끊기는 사이트가 있다: 기대한 길이보다 많이 짧으면 전체 받기로 다시
            total = info.get("duration")
            want = min(duration, max(0.0, total - start)) if total else duration
            got = media_seconds(files[0])
            if not section or got is None or got >= want * 0.8:
                return files[0], str(info.get("title") or "링크 소리"), section
        for f in work.glob("src.*"):
            f.unlink(missing_ok=True)
    raise FetchError(f"링크에서 소리를 받지 못했어요. yt-dlp 를 최신으로 올려 보세요 (pip install -U yt-dlp). {err or ''}".strip(), 502)


def media_seconds(path: Path) -> float | None:
    exe = shutil.which("ffprobe")
    if not exe:
        return None
    out = subprocess.run([exe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


def _download_direct(url: str, work: Path) -> Path:
    """yt-dlp 가 없을 때: 음원 파일 링크를 그대로 받는다 (300MB 까지). ffmpeg 가 직접 읽게 하면
    이어 받기(Range)를 모르는 서버에서 중간에 끊기므로 먼저 파일로 받는다."""
    dst = work / "src.bin"
    req = urllib.request.Request(url, headers={"User-Agent": "Soundsmith/1"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r, dst.open("wb") as f:
            total = 0
            while chunk := r.read(1 << 16):
                total += len(chunk)
                if total > 300 * 1024 * 1024:
                    raise FetchError("파일이 너무 커요 (300MB 까지).", 413)
                f.write(chunk)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise FetchError(f"링크를 열지 못했어요: {getattr(e, 'reason', e)}", 502) from e
    return dst


def _encode(src: str, out: Path, start: float, duration: float, timeout: float = 240) -> None:
    exe = ffmpeg_path()
    if not exe:
        raise FetchError("ffmpeg 가 필요해요. https://ffmpeg.org 에서 설치해 주세요.", 501)
    cmd = [exe, "-y", "-loglevel", "error", "-nostdin"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", src, "-t", f"{duration:.3f}", "-vn", "-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "192k", str(out)]
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise FetchError("소리를 바꾸는 데 너무 오래 걸려요. 구간을 짧게 해 보세요.", 504) from e
    if done.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        last = (done.stderr or "").strip().splitlines()[-1:] or ["소리 트랙이 없을 수 있어요"]
        raise FetchError(f"소리로 바꾸지 못했어요: {last[0]}", 502)


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def fetch_audio(url: str, start: float, duration: float) -> tuple[Path, str]:
    """링크의 [start, start+duration] 구간을 .m4a 로. 같은 요청은 캐시에서 바로 돌려준다."""
    key = hashlib.sha1(f"{url}|{start:.2f}|{duration:.2f}".encode()).hexdigest()[:20]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = CACHE_DIR / f"{key}.m4a"
    meta = CACHE_DIR / f"{key}.json"
    with _locks_guard:
        lock = _locks.setdefault(key, threading.Lock())
    with lock:
        if out.exists() and meta.exists():
            return out, json.loads(meta.read_text("utf-8")).get("title", "링크 소리")
        with tempfile.TemporaryDirectory(dir=CACHE_DIR) as tmp:
            work = Path(tmp)
            part = work / "out.m4a"
            if yt_dlp is not None:
                src, title, sectioned = _download_ytdlp(url, start, duration, work)
                _encode(str(src), part, 0 if sectioned else start, duration)
            else:
                # yt-dlp 가 없으면 음원 파일 링크(.mp3·.wav·.m4a 등)만
                title = Path(urlparse(url).path).stem or "링크 소리"
                _encode(str(_download_direct(url, work)), part, start, duration)
            part.replace(out)
        meta.write_text(json.dumps({"title": title, "url": url}, ensure_ascii=False), "utf-8")
        return out, title


def clean_cache(max_age: float = 86400) -> None:
    if not CACHE_DIR.exists():
        return
    now = time.time()
    for f in CACHE_DIR.iterdir():
        if f.is_file() and now - f.stat().st_mtime > max_age:
            f.unlink(missing_ok=True)


class Handler(SimpleHTTPRequestHandler):
    server_version = "Soundsmith/1"

    def log_request(self, code="-", size="-"):  # 조용히: 실패한 요청만
        if str(code).startswith(("4", "5")):
            super().log_request(code, size)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _same_origin(self) -> bool:
        """이 컴퓨터의 이 도우미 주소에서 연 페이지만 부를 수 있다 (다른 사이트가 몰래 받기 요청 못 하게)."""
        port = self.server.server_address[1]
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host", "") not in allowed:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin in {f"http://{h}" for h in allowed}

    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            self._json(200, {"link": bool(ffmpeg_path()), "ytdlp": yt_dlp is not None, "ffmpeg": bool(ffmpeg_path())})
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/fetch":
            self._json(404, {"error": "없는 주소예요."})
            return
        if not self._same_origin():
            self._json(403, {"error": "이 컴퓨터에서 연 음색 공방에서만 쓸 수 있어요."})
            return
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            self._json(415, {"error": "JSON 으로 보내 주세요."})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"error": "요청이 너무 커요."})
            return
        try:
            url, start, duration = parse_request(self.rfile.read(length))
            path, title = fetch_audio(url, start, duration)
        except FetchError as e:
            self._json(e.status, {"error": str(e)})
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "audio/mp4")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Title", quote(title[:200]))
        self.end_headers()
        self.wfile.write(data)


def make_server(port: int = 8010, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), partial(Handler, directory=str(APP_DIR)))


def main() -> None:
    ap = argparse.ArgumentParser(description="음색 공방 로컬 도우미")
    ap.add_argument("--port", type=int, default=8010)
    ap.add_argument("--cookies-from-browser", metavar="BROWSER", help="유튜브가 봇 확인을 요구할 때 브라우저 쿠키 쓰기 (예: chrome)")
    args = ap.parse_args()
    global COOKIES_FROM_BROWSER
    COOKIES_FROM_BROWSER = args.cookies_from_browser
    clean_cache()
    httpd = make_server(args.port)
    tools = ", ".join(n for n, ok in (("yt-dlp", yt_dlp is not None), ("ffmpeg", bool(ffmpeg_path()))) if ok) or "없음"
    print(f"음색 공방: http://127.0.0.1:{args.port}  (링크 가져오기 도구: {tools})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
