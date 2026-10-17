"""우리 주 하나님 (심형진) — 3성부 보컬 화성 악보 만들기.

첨부 리드시트(B장조, 마지막 C#장조 전조)를 옮겨 적고 윗화음·아랫화음을 붙인다.
화성은 멜로디와 같은 리듬(호모포니)으로 움직이도록 음 하나에 음 하나씩 대응시킨다.

    python build.py            # musicxml, pdf, midi 생성 (music21, verovio, chromium 필요)
"""
from __future__ import annotations

import copy
import subprocess
import sys
from pathlib import Path

from music21 import bar, clef, expressions, harmony, key, layout, metadata, meter, note, spanner, stream, tempo, tie

OUT = Path(__file__).resolve().parent
NAME = "lord-our-god"
BPM = 70  # 연습용 기본 빠르기. 원곡 영상 음원은 받지 못해 실제 템포는 확인하지 않음

# 마디 하나 = (코드 [(박 위치, 이름)], 멜로디 [(음, 길이, 가사)], 윗화음 [음], 아랫화음 [음])
# 가사: 문자열 하나(1절만) 또는 (1절, 2절). "" 는 앞 글자를 끄는 음. 음 이름 끝 "~" 는 다음 음과 붙임줄.
# 화성이 None 이면 그 마디는 쉼(멜로디 솔로).
R = "r"


def m(chords, mel, hi=None, lo=None, **kw):
    return dict(chords=chords, mel=mel, hi=hi, lo=lo, **kw)


# ---------------------------------------------------------------- A (인도자 솔로)
A = [
    m([], [("D#4", .5, "우"), ("D#4", .5, "리")], pickup=True),
    m([(0, "B"), (3, "C#m7")], [("D#4", 2, "주"), ("D#4", 1, "하"), ("C#4", .75, "나"), ("F#4", .25, "")]),
    m([(0, "B7/D#")], [("F#4", 2, "님"), (R, .5, ""), ("B3", .5, "큰"), ("B4", .5, "영"), ("A#4", .5, "광")]),
    m([(0, "E")], [("G#4", 2, "과"), ("F#4", 1, "존"), ("D#4", .75, "귀"), ("F#4", .25, "")]),
    m([(0, "B/D#")], [("F#4", 2, "를"), (R, 1, ""), ("B4", .5, "받"), ("A#4", .5, "기")]),
    m([(0, "E")], [("G#4", 2, "에"), ("F#4", 1, "합"), ("D#4", .75, "당"), ("F#4", .25, "하")]),
    m([(0, "B/D#")], [("F#4", 2, "신"), (R, .5, ""), ("D#4", .5, "지"), ("D#4", .5, "금"), ("B3", .5, "여")]),
    m([(0, "E")], [("E4", 1, "기"), ("D#4", 1, "계"), ("C#4", 1, "신"), ("C#4", .5, "하"), ("B3", .5, "나")]),
    m([(0, "F#sus4"), (2, "F#")], [("C#4", 2, "님"), (R, 1, ""), ("D#4", .5, "온"), ("D#4", .5, "천")],
      hi=[None, None, "F#4", "F#4"], lo=[None, None, "B3", "B3"]),
]

# ---------------------------------------------------------------- A' (1절 / 2절)
A2 = [
    m([(0, "B"), (3, "C#m7")],
      [("D#4", 2, ("지", "재")), ("D#4", 1, ("만", "하")), ("C#4", .75, ("물", "실")), ("F#4", .25, "")],
      ["F#4", "F#4", "E4", "G#4"], ["B3", "B3", "G#3", "D#4"], repeat_start=True),
    m([(0, "B7/D#")],
      [("F#4", 2, ("을", "때")), (R, .5, ""), ("B3", .5, ("지", "모")), ("B4", .5, ("으", "든")), ("A#4", .5, ("시", "만"))],
      ["A4", R, "D#4", "D#5", "C#5"], ["D#4", R, "B3", "F#4", "F#4"]),
    m([(0, "E")],
      [("G#4", 2, ("고", "물")), ("F#4", 1, ("다", "경")), ("F#4", .5, ("스", "배")), ("D#4", .25, ("리", "하")), ("F#4", .25, "")],
      ["B4", "B4", "B4", "B4", "B4"], ["E4", "D#4", "D#4", "B3", "D#4"]),
    m([(0, "B2/D#")],
      [("F#4", 2, ("는", "리")), (R, .5, ""), ("B3", .5, ("큰", "어")), ("B4", .5, ("권", "둠")), ("A#4", .5, ("능", "권"))],
      ["B4", R, "D#4", "D#5", "C#5"], ["D#4", R, "B3", "F#4", "F#4"]),
    m([(0, "E")],
      [("G#4", 2, ("과", "세")), ("F#4", 1, ("능", "물")), ("F#4", .5, ("력", "러")), ("D#4", .25, ("으", "가")), ("F#4", .25, "")],
      ["B4", "B4", "B4", "B4", "B4"], ["E4", "D#4", "D#4", "B3", "D#4"]),
    # 여기부터 3마디: 원곡 악보에 적힌 2성(F#-G#-B-A#-B)을 아랫화음이 멜로디 위에서 부른다
    m([(0, "B2/D#")],
      [("F#4", 2, ("로", "네")), (R, .5, ""), ("D#4", .5, ("주", "오")), ("D#4", .5, ("의", "셔")), ("B3", .5, ("말", "서"))],
      ["B4", R, "B4", "B4", "B4"], ["D#4", R, "F#4", "F#4", "F#4"]),
    m([(0, "E/G#"), (2, "F#")],
      [("E4", 1, ("씀", "다")), ("D#4", 1, ("이", "스")), ("C#4", 1.5, ("루", "리")), ("B3", .5, ("시", "소"))],
      ["B4", "D#5", "C#5", "D#5"], ["G#4", "B4", "A#4", "B4"]),
    m([(0, "B")], [("B3", 3, ("리", "서")), (R, 1, "")], ["D#5", R], ["B4", R]),
    m([(3, "B/D#")], [(R, 3, ""), ("B4", .5, "거"), ("A#4", .5, "")], [R, "D#5", "C#5"], [R, "F#4", "F#4"]),
]

# ---------------------------------------------------------------- B (후렴)
B = [
    m([(0, "E")],
      [("G#4", 1.5, "룩"), ("F#4", .5, "거"), ("F#4", 1, "룩"), ("G#4", .75, "하"), ("F#4", .25, "")],
      ["B4", "B4", "B4", "B4", "B4"], ["E4", "D#4", "D#4", "E4", "D#4"]),
    m([(0, "B/D#")],
      [("F#4", 2, "다"), (R, 1, ""), ("B4", .5, "거"), ("A#4", .5, "룩")],
      ["B4", R, "D#5", "C#5"], ["D#4", R, "F#4", "F#4"]),
    m([(0, "E"), (3, "F#")],
      [("G#4", 1.5, "하"), ("G#4", .5, "다"), ("G#4", 1, "주"), ("A#4", .75, "하"), ("B4", .25, "나")],
      ["B4", "B4", "B4", "C#5", "D#5"], ["E4", "E4", "E4", "F#4", "G#4"]),
    m([(0, "G#m7"), (3, "B/D#")],
      [("B4", 2, "님"), (R, .5, ""), ("C#5", .5, "곧"), ("B4", .5, "전"), ("A#4", .5, "능")],
      ["D#5", R, "E5", "D#5", "C#5"], ["G#4", R, "G#4", "F#4", "F#4"]),
    m([(0, "E")],
      [("G#4", 2, "하"), ("F#4", 1, "신"), ("D#4", .75, "이"), ("F#4", .25, "")],
      ["B4", "B4", "B4", "B4"], ["E4", "D#4", "B3", "D#4"]),
    m([(0, "B/D#")],
      [("F#4", 2, "여"), (R, .5, ""), ("F#4", .5, "하"), ("F#4", .5, "나"), ("F#4", .5, "님")],
      ["B4", R, "B4", "B4", "B4"], ["D#4", R, "D#4", "D#4", "D#4"]),
    m([(0, "E/G#"), (2, "F#")],
      [("G#4", 1, "나"), ("B4", 1, "라"), ("A#4", 1.5, "임"), ("B4~", .5, "하")],
      ["B4", "E5", "C#5", "D#5~"], ["E4", "G#4", "F#4", "F#4~"]),
    m([(0, "B")],
      [("B4", .5, ""), ("B4~", 1.5, "네"), ("B4", 1, ""), (R, 1, "")],
      ["D#5", "D#5~", "D#5", R], ["F#4", "F#4~", "F#4", R]),
]
B_END1 = m([(0, "Bsus4")], [(R, 3, ""), ("D#4", .5, "주"), ("D#4", .5, "임")], [R, "F#4", "F#4"], [R, "B3", "B3"],
           volta=1, repeat_end=True)
B_END2 = m([(0, "Bsus4")], [(R, 4, "")], [R], [R], volta=2)

# ---------------------------------------------------------------- C (브릿지, ×4)
C = [
    m([(0, "B")],
      [(R, .5, ""), ("B4", .25, "어"), ("B4~", .25, "제"), ("B4", .5, ""), ("B4", .5, "도"), ("B4", 1, "계"),
       ("A#4", .5, "셨"), ("B4", .5, "고")],
      [R, "D#5", "D#5~", "D#5", "D#5", "D#5", "C#5", "D#5"],
      [R, "F#4", "F#4~", "F#4", "F#4", "F#4", "F#4", "F#4"], repeat_start=True),
    m([(0, "G#m7")],
      [(R, .5, ""), ("B4", .25, "오"), ("B4~", .25, "늘"), ("B4", .5, ""), ("B4", .5, "도"), ("C#5", .5, "계"),
       ("B4", .5, ""), ("A#4", .5, "시"), ("B4", .5, "며")],
      [R, "D#5", "D#5~", "D#5", "D#5", "E5", "D#5", "C#5", "D#5"],
      [R, "G#4", "G#4~", "G#4", "G#4", "G#4", "G#4", "F#4", "F#4"]),
    m([(0, "E")],
      [(R, .5, ""), ("B4", .5, "이"), ("B4", .5, "제"), ("B4", .5, "곧"), ("B4", .5, "오"), ("B4", .5, "실"),
       ("A#4", .5, "우"), ("B4", .5, "리")],
      [R, "E5", "E5", "E5", "E5", "E5", "C#5", "D#5"],
      [R, "G#4", "G#4", "G#4", "G#4", "G#4", "F#4", "F#4"]),
    m([(0, "F#")], [("A#4", 3, "왕"), (R, 1, "")], ["C#5", R], ["F#4", R], repeat_end=True),
]


def transpose_up_m2(measures):
    """B장조 후렴 -> C#장조 후렴 (온음 위). 코드는 원곡 악보 표기대로 따로 적는다."""
    from music21 import pitch

    def tp(p):
        if p in (None, R):
            return p
        tie = p.endswith("~")
        q = pitch.Pitch(p.rstrip("~")).transpose("M2")
        name = q.nameWithOctave.replace("-", "b")
        return name + ("~" if tie else "")

    out = []
    for meas in measures:
        n = copy.deepcopy(meas)
        n["mel"] = [(tp(p), d, t) for p, d, t in n["mel"]]
        n["hi"] = [tp(p) for p in n["hi"]]
        n["lo"] = [tp(p) for p in n["lo"]]
        out.append(n)
    return out


C2_CHORDS = [[(0, "F#")], [(0, "C#/F")], [(0, "F#"), (3, "G#")], [(0, "A#m7"), (3, "C#/F")],
             [(0, "F#")], [(0, "C#/F")], [(0, "F#/A#"), (2, "G#")], [(0, "C#")]]
C2_PICKUP = m([], [("C#5", .5, "거"), ("B#4", .5, "")], ["E#5", "D#5"], ["G#4", "G#4"], pickup=True, key=7)
C2 = transpose_up_m2(B)
for meas, ch in zip(C2, C2_CHORDS):
    meas["chords"] = ch
C2[-1]["final"] = True

# 악보에 적을 진행 안내 (마디 번호는 이 악보 기준)
NOTES = {
    0: "A: 인도자 솔로",
    9: "A'1(1절) 유니즌 · A'2(2절) 3성부",
    14: "1절도 '주의 말씀'부터 화음",
    18: "B: 1회 Lead+Low → 이후 3성부",
    26: "→ A'2(2절)",
    28: "C ×4",
    32: "C' ×3 (C# 전조): 3성부",
}
# 마지막 회차 코드 바꿈 (박 위치, 내용)
LAST_TIME = {28: [(1, "(last: G#m7)"), (3, "(A#m7)")], 29: [(1, "(last: B)")]}

SECTIONS = [("A", A), ("A'", A2), ("B", B + [B_END1, B_END2]), ("C", C), ("C'", [C2_PICKUP] + C2)]


def make_note(p, d, tie_from_prev):
    if p in (R, None):
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


def add_lyric(n, lyr):
    if isinstance(n, note.Rest) or not lyr:
        return
    if isinstance(lyr, tuple):
        for i, t in enumerate(lyr, 1):
            if t:
                n.addLyric(t, lyricNumber=i)
    else:
        n.addLyric(lyr, lyricNumber=1)


def chord_symbol(name):
    """원곡 표기를 살린다: B2/D# 는 B/D# 에 '2' 표시, C#/F 는 C#/E# 로 적는다."""
    cs = harmony.ChordSymbol(name.replace("B2/", "B/").replace("C#/F", "C#/E#"))
    if "2/" in name:
        cs.chordKindStr = "2"
    cs.writeAsChord = False
    cs.duration.quarterLength = 0
    return cs


def build_part(role):
    part = stream.Part()
    part.partName = {"hi": "윗화음 High", "mel": "멜로디 Lead", "lo": "아랫화음 Low"}[role]
    part.partAbbreviation = {"hi": "High", "mel": "Lead", "lo": "Low"}[role]
    tie_prev = False
    num = 0
    brackets = {}
    for sec_name, measures in SECTIONS:
        for i, spec in enumerate(measures):
            meas = stream.Measure(number=num)
            # 음표를 먼저 정해진 박 위치에 넣는다 (코드 기호를 먼저 넣으면 append 위치가 밀림)
            line = spec[role] if role != "mel" else [p for p, _, _ in spec["mel"]]
            if line is None:
                total = sum(d for _, d, _ in spec["mel"])
                r = note.Rest(quarterLength=total)
                r.fullMeasure = not spec.get("pickup")
                meas.insert(0, r)
            else:
                assert len(line) == len(spec["mel"]), (sec_name, i, role)
                off = 0.0
                for p, (_, d, lyr) in zip(line, spec["mel"]):
                    n, tie_prev = make_note(p, d, tie_prev)
                    add_lyric(n, lyr)
                    meas.insert(off, n)
                    off += d
            if num == 0:
                meas.insert(0, clef.TrebleClef())
                meas.insert(0, key.KeySignature(5))
                meas.insert(0, meter.TimeSignature("4/4"))
                if role == "mel":
                    meas.insert(0, tempo.MetronomeMark(number=BPM))
            if spec.get("key"):
                meas.insert(0, key.KeySignature(spec["key"]))
            if role == "hi":
                if i == (1 if sec_name in ("A", "C'") else 0):
                    meas.insert(0, expressions.RehearsalMark(sec_name))
                for off, name in spec["chords"]:
                    meas.insert(off, chord_symbol(name))
                if num in NOTES:
                    te = expressions.TextExpression(NOTES[num])
                    te.style.fontSize = 8
                    te.placement = "above"
                    meas.insert(0, te)
                for beat, text in LAST_TIME.get(num, []):
                    te = expressions.TextExpression(text)
                    te.style.fontSize = 7
                    te.style.fontStyle = "italic"
                    te.placement = "above"
                    meas.insert(beat, te)
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
            num += 1
    for v, meas in brackets.items():
        rb = spanner.RepeatBracket(meas, number=v)
        part.insert(0, rb)
    return part


def build_score():
    sc = stream.Score()
    sc.metadata = metadata.Metadata()
    sc.metadata.title = "우리 주 하나님 — 3성부 화성"
    sc.metadata.composer = "Words & Music 심형진 · 화성 편곡"
    for role in ("hi", "mel", "lo"):
        sc.insert(0, build_part(role))
    sc.insert(0, layout.StaffGroup(list(sc.parts), symbol="bracket"))
    return sc


def render_pdf(xml_path: Path, pdf_path: Path):
    import verovio

    tk = verovio.toolkit()
    tk.setOptions({
        "pageWidth": 2100, "pageHeight": 2970, "scale": 40, "pageMarginLeft": 80, "pageMarginRight": 80,
        "pageMarginTop": 80, "pageMarginBottom": 80, "lyricSize": 3.6, "header": "auto", "footer": "none",
        "breaks": "auto", "spacingSystem": 10, "justifyVertically": False, "font": "Leipzig",
    })
    tk.loadFile(str(xml_path))
    pages = [tk.renderToSVG(i) for i in range(1, tk.getPageCount() + 1)]
    html = OUT / f"{NAME}.html"
    body = "".join(f'<div class="page">{svg}</div>' for svg in pages)
    html.write_text(
        "<!doctype html><meta charset=utf-8><style>@page{size:A4;margin:0}body{margin:0}"
        ".page{width:210mm;height:297mm;page-break-after:always;overflow:hidden}"
        ".page svg{width:100%;height:auto}text{font-family:'NanumGothic','Nanum Gothic',serif}</style>" + body,
        encoding="utf-8")
    chrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    subprocess.run([chrome, "--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}", html.as_uri()], check=True, capture_output=True)
    html.unlink()
    return len(pages)


def write_midis(sc):
    mid = OUT / "midi"
    mid.mkdir(exist_ok=True)
    full = sc.expandRepeats() if hasattr(sc, "expandRepeats") else sc
    full.write("midi", fp=mid / "all-parts.mid")
    for p, fname in zip(full.parts, ("high", "lead", "low")):
        s = stream.Score([copy.deepcopy(p)])
        s.write("midi", fp=mid / f"{fname}.mid")


def main():
    sc = build_score()
    xml = OUT / f"{NAME}.musicxml"
    sc.write("musicxml", fp=xml)
    pages = render_pdf(xml, OUT / f"{NAME}.pdf")
    write_midis(sc)
    print(f"ok: {xml.name}, {NAME}.pdf ({pages}p), midi/")


if __name__ == "__main__":
    sys.exit(main())
