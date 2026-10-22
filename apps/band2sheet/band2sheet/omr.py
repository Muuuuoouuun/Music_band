"""악보 이미지(사진·스캔·PDF) -> MusicXML: 광학 악보 인식(OMR).

oemer(MIT, https://github.com/BreezeWhite/oemer)를 바깥 명령으로 부른다. oemer 는 오래된
onnxruntime·numpy 를 요구해서 이 앱의 분리 엔진과 한 가상환경에 같이 두기 어렵다
(최신 onnxruntime 에서는 모델을 불러오지 못함). 그래서 MuseScore 처럼 따로 설치한 명령을 쓴다:

    python3.11 -m venv ~/.oemer
    ~/.oemer/bin/pip install oemer "onnxruntime<1.18" "numpy<2" "opencv-python-headless<4.11"
    export BAND2SHEET_OEMER=~/.oemer/bin/oemer        # 또는 PATH 에 oemer 가 있으면 그대로

oemer 는 오선·음표·쉼표·조표·박자표를 읽고, **코드 이름과 가사 글자는 읽지 않는다**.
그래서 결과는 멜로디 초안이고, 코드는 음표로 추정한다 (앱에서 코드·가사를 고쳐 쓴다).
PDF 는 pdftoppm(poppler)으로 쪽마다 그림으로 바꾼 뒤 인식해 이어 붙인다.
"""

from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Callable

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".pdf"}
PAGE_TIMEOUT = 60 * 40  # CPU 에서 한 쪽에 10분 안팎 — 넉넉히

Log = Callable[[str], None]


def is_image(path: str | Path) -> bool:
    return Path(str(path)).suffix.lower() in IMAGE_EXT


def oemer_command() -> list[str] | None:
    """oemer 실행 명령 (BAND2SHEET_OEMER, 없으면 PATH). 없으면 None."""
    env = os.environ.get("BAND2SHEET_OEMER", "").strip()
    if env:
        parts = shlex.split(env)
        exe = shutil.which(parts[0]) or (parts[0] if Path(parts[0]).exists() else None)
        return [exe, *parts[1:]] if exe else None
    exe = shutil.which("oemer")
    return [exe] if exe else None


def available() -> bool:
    return oemer_command() is not None


def supported_extensions() -> set[str]:
    """지금 받을 수 있는 악보 이미지 형식 (PDF 는 pdftoppm 이 있어야)."""
    if not available():
        return set()
    return IMAGE_EXT if shutil.which("pdftoppm") else IMAGE_EXT - {".pdf"}


def _pages(src: Path, work: Path) -> list[Path]:
    if src.suffix.lower() != ".pdf":
        return [src]
    exe = shutil.which("pdftoppm")
    if not exe:
        raise RuntimeError("PDF 악보를 읽으려면 pdftoppm(poppler)이 필요합니다. 그림(PNG·JPG)으로 올려 주세요.")
    pages_dir = work / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([exe, "-r", "200", "-png", str(src), str(pages_dir / "page")], check=True,
                   capture_output=True, timeout=300)
    pages = sorted(pages_dir.glob("page*.png"))
    if not pages:
        raise RuntimeError("PDF 에서 쪽을 찾지 못했습니다.")
    return pages


def _recognize_page(cmd: list[str], img: Path, out: Path) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    try:
        r = subprocess.run([*cmd, str(img), "-o", str(out)], capture_output=True, text=True,
                           timeout=PAGE_TIMEOUT)
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"악보 인식이 {PAGE_TIMEOUT // 60}분 안에 끝나지 않았습니다.") from e
    found = sorted(out.glob("*.musicxml"))
    if r.returncode != 0 or not found:
        tail = (r.stderr or r.stdout or "").strip().splitlines()[-1:] or ["알 수 없는 오류"]
        raise RuntimeError(f"악보 그림을 읽지 못했습니다: {tail[0][:200]}")
    return found[0]


def _as_melody(xml: Path) -> Path:
    """oemer 는 한 줄짜리 멜로디 악보도 늘 'Piano' 파트로 쓴다. 오선이 하나뿐이면 멜로디로 이름을 바꿔
    악보 파일 불러오기가 보컬(리드시트)로 받게 한다. 큰보표(2단) 피아노 악보는 그대로 둔다."""
    text = xml.read_text(encoding="utf-8")
    staves = re.findall(r"<staves>\s*(\d+)\s*</staves>", text)
    if all(n == "1" for n in staves):
        text = re.sub(r"<(part-name|instrument-name)>\s*Piano\s*</\1>", r"<\1>Melody</\1>", text)
        xml.write_text(text, encoding="utf-8")
    return xml


def _join_pages(xmls: list[Path], dst: Path) -> Path:
    """쪽마다 나온 MusicXML 의 첫 파트를 이어 붙여 한 곡으로."""
    if len(xmls) == 1:
        shutil.copyfile(xmls[0], dst)
        return dst
    from music21 import converter, stream

    first = converter.parse(str(xmls[0]))
    part = first.parts[0]
    number = len(part.getElementsByClass(stream.Measure))
    for xml in xmls[1:]:
        for m in converter.parse(str(xml)).parts[0].getElementsByClass(stream.Measure):
            number += 1
            m.number = number
            part.append(m)
    first.write("musicxml", fp=str(dst))
    return dst


def recognize(src: str | Path, work: Path, log: Log = print,
              progress: Callable[[float, str], None] | None = None) -> Path:
    """악보 이미지/PDF -> work/omr.musicxml."""
    cmd = oemer_command()
    if cmd is None:
        raise RuntimeError("악보 이미지 인식(oemer)이 설치되어 있지 않습니다. "
                           "MIDI·MusicXML 로 올리거나 oemer 를 설치해 BAND2SHEET_OEMER 로 알려 주세요.")
    src = Path(src)
    work.mkdir(parents=True, exist_ok=True)
    pages = _pages(src, work)
    xmls = []
    for i, page in enumerate(pages):
        msg = f"① 악보 그림 읽는 중 (oemer, {i + 1}/{len(pages)}쪽) — 한 쪽에 몇 분 걸립니다"
        log(msg)
        if progress:
            progress(0.05 + 0.85 * i / len(pages), msg)
        xmls.append(_as_melody(_recognize_page(cmd, page, work / f"omr_{i + 1}")))
    log(f"   - 악보 그림 {len(pages)}쪽을 읽었습니다 (코드·가사 글자는 읽지 않아 코드는 음표로 추정)")
    return _join_pages(xmls, work / "omr.musicxml")
