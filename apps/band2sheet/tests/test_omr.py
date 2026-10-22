"""악보 이미지(OMR) 입력: oemer 를 흉내 내는 가짜 명령으로 경로·오류·여러 쪽 PDF·앱 연결을 확인."""

import shutil
import stat
import sys
import textwrap
from pathlib import Path

import pytest

from band2sheet import omr


def _melody_xml(path: Path, pitches=("G4", "A4", "B4", "C5", "D5", "C5", "B4", "A4")) -> Path:
    """oemer 가 쓰는 모양: 오선 하나짜리 멜로디도 파트 이름은 'Piano'."""
    from music21 import instrument, key, meter, note, stream

    part = stream.Part()
    part.insert(0, instrument.Piano())
    part.append(key.Key("G"))
    part.append(meter.TimeSignature("4/4"))
    for p in pitches:
        part.append(note.Note(p, quarterLength=1.0))
    score = stream.Score([part])
    score.write("musicxml", fp=str(path))
    return path


def _fake_oemer(tmp_path: Path, xml: Path | None, fail: str = "") -> Path:
    """oemer 처럼 `<img> -o <dir>` 을 받아 <dir>/<그림 이름>.musicxml 을 쓰는 실행 파일."""
    calls = tmp_path / "calls.txt"
    script = tmp_path / "fake_oemer"
    script.write_text(textwrap.dedent(f"""\
        #!{sys.executable}
        import shutil, sys
        from pathlib import Path
        img, out = Path(sys.argv[1]), Path(sys.argv[sys.argv.index("-o") + 1])
        with open({str(calls)!r}, "a") as f:
            f.write(img.name + "\\n")
        if {fail!r}:
            print({fail!r}, file=sys.stderr)
            sys.exit(1)
        assert out.is_dir(), "oemer 는 출력 폴더가 미리 있어야 함"
        shutil.copyfile({str(xml)!r}, out / (img.stem + ".musicxml"))
        """))
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return script


@pytest.fixture()
def no_oemer(monkeypatch, tmp_path):
    monkeypatch.setenv("BAND2SHEET_OEMER", str(tmp_path / "없는" / "oemer"))


@pytest.fixture()
def fake_oemer(monkeypatch, tmp_path):
    xml = _melody_xml(tmp_path / "page.musicxml")
    script = _fake_oemer(tmp_path, xml)
    monkeypatch.setenv("BAND2SHEET_OEMER", str(script))
    return tmp_path / "calls.txt"


def _image(tmp_path: Path, name="hymn.png") -> Path:
    p = tmp_path / name
    p.write_bytes(b"\x89PNG\r\n\x1a\n")  # 가짜 oemer 는 내용을 읽지 않는다
    return p


def test_without_oemer_images_are_not_accepted(no_oemer):
    from band2sheet.app.jobs import allowed_extensions

    assert not omr.available()
    assert omr.supported_extensions() == set()
    assert not ({".png", ".jpg", ".pdf"} & allowed_extensions())
    with pytest.raises(RuntimeError, match="oemer"):
        omr.recognize("x.png", Path("unused"))


def test_job_rejects_image_without_oemer(no_oemer, tmp_path):
    from band2sheet.app.jobs import JobManager

    with pytest.raises(ValueError, match="oemer"):
        JobManager(tmp_path / "data").create("hymn.jpg", __import__("io").BytesIO(b"x"), {})


def test_analyze_sheet_image(fake_oemer, tmp_path):
    from band2sheet.pipeline import analyze

    project = analyze(str(_image(tmp_path)), tmp_path / "out", log=lambda m: None)
    assert list(project.tracks) == ["vocals"]  # 'Piano' 라고 적힌 한 줄 악보도 멜로디(리드시트)로
    melody = project.tracks["vocals"].notes
    assert [n.pitch for n in melody] == [67, 69, 71, 72, 74, 72, 71, 69]
    assert project.key.name.startswith("G")
    assert project.title == "hymn"
    assert "oemer" in project.engines["input"]
    # 악보 사진은 코드 이름을 못 읽으니, 멜로디에 조 안의 3화음을 붙인다 (sus4 같은 엉뚱한 코드 없이)
    assert project.engines["chords"].startswith("멜로디에 붙인 코드")
    g_major = {7: "", 9: "m", 11: "m", 0: "", 2: "", 4: "m"}
    assert project.chords and all(g_major.get(root) == q for _, _, root, q, _ in project.chords)
    assert (tmp_path / "out" / "project.json").exists()
    assert fake_oemer.read_text().split() == ["hymn.png"]


def test_oemer_failure_is_reported(monkeypatch, tmp_path):
    script = _fake_oemer(tmp_path, None, fail="ConvTranspose pads error")
    monkeypatch.setenv("BAND2SHEET_OEMER", str(script))
    with pytest.raises(RuntimeError, match="악보 그림을 읽지 못했습니다: ConvTranspose pads error"):
        omr.recognize(_image(tmp_path), tmp_path / "work", log=lambda m: None)


def test_grand_staff_piano_stays_piano(tmp_path):
    xml = tmp_path / "piano.musicxml"
    xml.write_text("<score-partwise><part-list><score-part id='P1'><part-name>Piano</part-name></score-part>"
                   "</part-list><part id='P1'><measure number='1'><attributes><staves>2</staves></attributes>"
                   "</measure></part></score-partwise>", encoding="utf-8")
    assert "<part-name>Piano</part-name>" in omr._as_melody(xml).read_text(encoding="utf-8")


def test_join_pages_renumbers_measures(tmp_path):
    from music21 import converter, stream

    a = _melody_xml(tmp_path / "a.musicxml")
    b = _melody_xml(tmp_path / "b.musicxml", ("E5", "D5", "C5", "B4"))
    out = omr._join_pages([a, b], tmp_path / "joined.musicxml")
    part = converter.parse(str(out)).parts[0]
    measures = list(part.getElementsByClass(stream.Measure))
    assert [m.number for m in measures] == [1, 2, 3]
    assert len(part.flatten().notes) == 12


@pytest.mark.skipif(shutil.which("pdftoppm") is None, reason="pdftoppm(poppler) 없음")
def test_pdf_pages_are_recognized_in_order(fake_oemer, tmp_path):
    cairosvg = pytest.importorskip("cairosvg")
    pypdf = pytest.importorskip("pypdf")
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="white"/></svg>'
    writer = pypdf.PdfWriter()
    for i in range(2):
        page = tmp_path / f"p{i}.pdf"
        cairosvg.svg2pdf(bytestring=svg, write_to=str(page))
        writer.append(str(page))
    pdf = tmp_path / "hymn.pdf"
    with open(pdf, "wb") as f:
        writer.write(f)
    xml = omr.recognize(pdf, tmp_path / "work", log=lambda m: None)
    assert fake_oemer.read_text().split() == ["page-1.png", "page-2.png"]
    from music21 import converter

    assert len(converter.parse(str(xml)).parts[0].flatten().notes) == 16


def test_app_accepts_images_when_oemer_is_installed(fake_oemer, tmp_path):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from band2sheet.app.server import create_app
    from tests.test_app import _wait

    client = TestClient(create_app(tmp_path / "data"))
    info = client.get("/api/info").json()
    assert info["omr"] is True
    assert {".png", ".jpg", ".jpeg", ".pdf"} <= set(info["extensions"])
    r = client.post("/api/jobs", files={"file": ("찬송.jpg", b"\xff\xd8\xff")},
                    data={"options": '{"title": "찬송 사진"}'})
    assert r.status_code == 200, r.text
    job = _wait(client, r.json()["id"])
    assert job["status"] == "done", job.get("error")
    assert job["title"] == "찬송 사진"
    assert any("oemer" in line for line in job["log"])
