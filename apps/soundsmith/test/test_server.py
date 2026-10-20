"""로컬 도우미 검사: 외부 인터넷 없이 이 컴퓨터 안의 합성 WAV 링크만 쓴다.

    python3 -m unittest discover -s test -p 'test_*.py'
"""

import http.client
import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import wave
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def write_tone(path: Path, seconds: float = 3.0, hz: float = 220.0, sr: int = 44100) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * hz * i / sr))) for i in range(int(sr * seconds)))
        w.writeframes(frames)


def serve(httpd):
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return t


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg 필요")
class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        write_tone(root / "tone.wav")
        cls.files = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
        serve(cls.files)
        cls.cache = mock.patch.object(server, "CACHE_DIR", root / "cache")
        cls.cache.start()
        cls.app = server.make_server(0)
        serve(cls.app)
        cls.port = cls.app.server_address[1]
        cls.link = f"http://127.0.0.1:{cls.files.server_address[1]}/tone.wav"

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()
        cls.files.shutdown()
        cls.cache.stop()
        cls.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=120)
        h = {"Host": f"127.0.0.1:{self.port}"}
        if body is not None:
            body = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        return r.status, dict(r.getheaders()), r.read()

    def duration(self, data: bytes) -> float:
        with tempfile.NamedTemporaryFile(suffix=".m4a") as f:
            f.write(data)
            f.flush()
            out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f.name],
                                 capture_output=True, text=True)
            return float(out.stdout.strip())

    def test_app_files_and_health(self):
        status, _, body = self.request("GET", "/index.html")
        self.assertEqual(status, 200)
        self.assertIn("음색 공방".encode(), body)
        status, _, body = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ffmpeg"])

    def test_fetch_section_with_ffmpeg_only(self):
        with mock.patch.object(server, "yt_dlp", None):
            status, headers, body = self.request("POST", "/api/fetch", {"url": self.link, "start": 0.5, "duration": 1.5})
        self.assertEqual(status, 200, body[:200])
        self.assertEqual(headers["Content-Type"], "audio/mp4")
        self.assertEqual(headers["X-Title"], "tone")
        self.assertAlmostEqual(self.duration(body), 1.5, delta=0.1)
        # 같은 요청은 캐시에서
        status2, _, body2 = self.request("POST", "/api/fetch", {"url": self.link, "start": 0.5, "duration": 1.5})
        self.assertEqual((status2, body2), (200, body))

    @unittest.skipUnless(server.yt_dlp is not None, "yt-dlp 필요")
    def test_fetch_with_ytdlp(self):
        status, _, body = self.request("POST", "/api/fetch", {"url": self.link, "start": 1, "duration": 1})
        self.assertEqual(status, 200, body[:300])
        self.assertAlmostEqual(self.duration(body), 1.0, delta=0.15)

    def test_rejects_bad_requests(self):
        for payload in ({"url": "file:///etc/passwd"}, {"url": "javascript:alert(1)"}, {"url": "https://a.b/x y"},
                        {"url": self.link, "duration": 9999}, {"url": self.link, "start": "abc"}):
            status, _, body = self.request("POST", "/api/fetch", payload)
            self.assertEqual(status, 400, payload)
            self.assertIn("error", json.loads(body))

    def test_other_sites_cannot_call(self):
        status, _, _ = self.request("POST", "/api/fetch", {"url": self.link}, {"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        status, _, _ = self.request("POST", "/api/fetch", {"url": self.link}, {"Host": "evil.example"})
        self.assertEqual(status, 403)
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("POST", "/api/fetch", body=b"url=x", headers={"Host": f"127.0.0.1:{self.port}", "Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(c.getresponse().status, 415)

    def test_unreachable_link_reports_error(self):
        with mock.patch.object(server, "yt_dlp", None):
            status, _, body = self.request("POST", "/api/fetch", {"url": f"http://127.0.0.1:{self.files.server_address[1]}/missing.wav", "duration": 1})
        self.assertGreaterEqual(status, 500)
        self.assertIn("error", json.loads(body))


if __name__ == "__main__":
    unittest.main()
