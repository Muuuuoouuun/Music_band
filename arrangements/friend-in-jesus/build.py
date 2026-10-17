"""내 진정 사모하는 (찬송가 88장, F.I.A 버전) — 3성부 보컬 화성 악보 만들기.

    python build.py            # musicxml, pdf, midi 생성 (music21, verovio, Chromium 필요)

멜로디·화성 데이터는 arrangement.py. 가사는 넣지 않고 구간 이름과 진행 안내만 적는다.
"""
from __future__ import annotations

import copy
import re
import subprocess
import sys
from pathlib import Path

from music21 import bar, clef, expressions, harmony, key, layout, metadata, meter, note, spanner, stream, tempo, tie

import arrangement as A

OUT = Path(__file__).resolve().parent
NAME = "friend-in-jesus"
R = A.R

PICKUP = dict(notes=A.PICKUP_AB, chords=[(0, "C")], pickup=True)
VERSE = copy.deepcopy(A.VERSE)
REFRAIN = copy.deepcopy(A.REFRAIN)
VERSE[0]["mark"] = "절 (a+b)"
REFRAIN[0]["mark"] = "후렴 (c+b)"
REFRAIN[0]["repeat_start"] = True
# 후렴 끝 마디: 1번 괄호 = 후렴 다시 (F–B♭ 못갖춘), 2번 괄호 = 간주·끝 (F 끌기)
END1 = dict(notes=A.END_TO_C, chords=[(0, "F")], volta=1, repeat_end=True)
END2 = dict(notes=A.END_HOLD, chords=[(0, "F")], volta=2, final=True)
REFRAIN[-1] = END1
MEASURES = [PICKUP] + VERSE + REFRAIN + [END2]

# 악보 위에 적는 안내 (마디 번호 = 이 악보 기준, 0 = 못갖춘마디)
NOTES = {
    0: "전체 진행·파트 배치는 README 분할표",
    5: "2·3절: 여기(b)부터 아랫화음",
    8: "→ 후렴",
    16: "후렴 다시",
    17: "간주·끝 (절로: 맨 앞 못갖춘부터)",
}
ROLES = {"hi": ("윗화음 High", "High", 1), "mel": ("멜로디 Lead", "Lead", 0), "lo": ("아랫화음 Low", "Low", 2)}


def make_note(p, d, tie_from_prev):
    if p == R:
        return note.Rest(quarterLength=d), False
    tie_next = p.endswith("~")
    n = note.Note(p.rstrip("~"), quarterLength=d)
    if tie_next and tie_from_prev:
        n.tie = tie.Tie("continue")
    elif tie_next:
        n.tie = tie.Tie("start")
    elif tie_from_prev:
        n.tie = tie.Tie("stop")
    return n, tie_next


def chord_symbol(name):
    cs = harmony.ChordSymbol(re.sub(r"(^|/)([A-G])b", r"\1\2-", name))  # music21 은 플랫을 '-' 로 적는다
    cs.writeAsChord = False
    cs.duration.quarterLength = 0
    return cs


def text(s, size=8, italic=False):
    te = expressions.TextExpression(s)
    te.style.fontSize = size
    if italic:
        te.style.fontStyle = "italic"
    te.placement = "above"
    return te


def build_part(role):
    name, abbr, _ = ROLES[role]
    part = stream.Part()
    part.partName, part.partAbbreviation = name, abbr
    tie_prev = False
    brackets = {}
    for num, spec in enumerate(MEASURES):
        meas = stream.Measure(number=num)
        off = 0.0
        for d, *ps in spec["notes"]:
            n, tie_prev = make_note(ps[("mel", "hi", "lo").index(role)], d, tie_prev)
            meas.insert(off, n)
            off += d
        if num == 0:
            meas.insert(0, clef.TrebleClef())
            meas.insert(0, key.KeySignature(A.KEY_FIFTHS))
            meas.insert(0, meter.TimeSignature("4/4"))
            if role == "hi":
                meas.insert(0, tempo.MetronomeMark(number=A.BPM))
        if role == "hi":
            if spec.get("mark"):
                meas.insert(0, expressions.RehearsalMark(spec["mark"]))
            for o, c in spec["chords"]:
                meas.insert(o, chord_symbol(c))
            if num in NOTES:
                meas.insert(0, text(NOTES[num], 7, italic=True))
        if spec.get("pickup"):
            meas.paddingLeft = 4 - meas.duration.quarterLength
        if spec.get("repeat_start"):
            meas.leftBarline = bar.Repeat(direction="start")
        if spec.get("repeat_end"):
            meas.rightBarline = bar.Repeat(direction="end")
        if spec.get("final"):
            meas.rightBarline = bar.Barline("final")
        if spec.get("volta"):
            brackets[spec["volta"]] = meas
        part.append(meas)
    for v, meas in brackets.items():
        part.insert(0, spanner.RepeatBracket(meas, number=v))
    return part


def build_score():
    sc = stream.Score()
    sc.metadata = metadata.Metadata()
    sc.metadata.title = "내 진정 사모하는 (찬송가 88장 · F.I.A ver.) — 3성부 화성"
    sc.metadata.composer = "곡 W. S. Hays · 멜로디 채보 F.I.A LIVE WORSHIP 영상 · 화성 편곡"
    for role in ("hi", "mel", "lo"):
        sc.insert(0, build_part(role))
    sc.insert(0, layout.StaffGroup(list(sc.parts), symbol="bracket"))
    return sc


def render_pdf(xml_path: Path, pdf_path: Path):
    import verovio

    tk = verovio.toolkit()
    tk.setOptions({
        "pageWidth": 2100, "pageHeight": 2970, "scale": 36, "pageMarginLeft": 80, "pageMarginRight": 80,
        "pageMarginTop": 80, "pageMarginBottom": 80, "header": "auto", "footer": "none",
        "breaks": "auto", "spacingSystem": 12, "justifyVertically": False, "font": "Leipzig",
    })
    tk.loadFile(str(xml_path))
    pages = [tk.renderToSVG(i) for i in range(1, tk.getPageCount() + 1)]
    html = OUT / f"{NAME}.html"
    body = "".join(f'<div class="page">{svg}</div>' for svg in pages)
    html.write_text(
        "<!doctype html><meta charset=utf-8><style>@page{size:A4;margin:0}body{margin:0}"
        ".page{width:210mm;height:297mm;page-break-after:always;overflow:hidden}"
        ".page svg{width:100%;height:auto}text{font-family:'Noto Sans CJK KR','NanumGothic',sans-serif}</style>"
        + body, encoding="utf-8")
    chrome = next(Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome"))
    subprocess.run([str(chrome), "--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}", html.as_uri()], check=True, capture_output=True)
    html.unlink()
    return len(pages)


def write_midis(sc):
    mid = OUT / "midi"
    mid.mkdir(exist_ok=True)
    full = sc.expandRepeats()
    full.write("midi", fp=mid / "all-parts.mid")
    for p, fname in zip(full.parts, ("high", "lead", "low")):
        stream.Score([copy.deepcopy(p)]).write("midi", fp=mid / f"{fname}.mid")


def main():
    sc = build_score()
    xml = OUT / f"{NAME}.musicxml"
    sc.write("musicxml", fp=xml)
    pages = render_pdf(xml, OUT / f"{NAME}.pdf")
    write_midis(sc)
    print(f"ok: {xml.name}, {NAME}.pdf ({pages}p), midi/")


if __name__ == "__main__":
    sys.exit(main())
