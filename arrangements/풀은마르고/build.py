"""풀은 마르고 — 3성부 화음 악보(MusicXML) 생성.

원본 악보는 G장조로 인쇄돼 있고 손글씨 코드는 F장조라서, 모든 음을 F장조(장2도 아래)로 옮겨 적었다.
성부: 높은 화음(악보의 파란 표시), 멜로디, 낮은 화음(주황 표시).
표시가 없는 구간은 그 성부를 쉰다(원본 표시를 따름).

    python3 build.py   ->  풀은마르고-화음.musicxml
"""
from pathlib import Path

DIV = 12  # 4분음표 = 12
DUR = {'w': 48, 'hd': 36, 'h': 24, 'qd': 18, 'q': 12, 'e': 6, 's': 3, 't': 8}
TYPE = {48: ('whole', 0), 36: ('half', 1), 24: ('half', 0), 18: ('quarter', 1), 12: ('quarter', 0),
        8: ('quarter', 0), 6: ('eighth', 0), 3: ('16th', 0)}
STEP_ALTER = {'b': -1, '#': 1}


def parse(bar):
    """'F4q E4h~ r/h' 처럼 '음이름옥타브+길이' 토큰. '~'는 다음 음과 붙임줄."""
    out = []
    for tok in bar.split():
        tie = tok.endswith('~')
        tok = tok.rstrip('~')
        if tok.startswith('r'):
            out.append((None, DUR[tok[1:]], tie))
            continue
        i = 1
        acc = ''
        if tok[1] in 'b#':
            acc = tok[1]
            i = 2
        pitch = (tok[0], acc, int(tok[i]))
        out.append((pitch, DUR[tok[i + 1:]], tie))
    assert sum(d for _, d, _ in out) == 48, (bar, sum(d for _, d, _ in out))
    return out


REST = 'rw'

# ---------------- 마디 데이터 (F장조) ----------------
# 각 항목: (코드들[(박 위치 0~3.5, 이름)], 높은화음, 멜로디, 가사(공백구분), 낮은화음, 연습기호/메모)
M = []


def bar(chords, hi, mel, lyr, lo, mark=None):
    M.append((chords, hi, mel, lyr, lo, mark))


# A (1절) — 높은·낮은 화음 모두
def a_section(first, hi_on, lo_on, mark):
    end_mel = 'F4t F4t F4t F4q C4e C4e' if first else 'F4t F4t F4t F4q G4e F4e'
    end_hi = 'A4t A4t A4t A4q F4e F4e' if first else 'A4t A4t A4t A4q Bb4e A4e'
    end_lo = 'D4t D4t D4t D4q A3e A3e' if first else 'D4t D4t D4t D4q D4e D4e'
    rows = [
        ([(0, 'F')], 'rq A4q A4h', 'rq F4q E4h', '풀 은', 'rq C4q C4h'),
        ([], 'rq A4q G4q A4q', 'rq F4q E4q F4q', '마 르 고', 'rq C4q C4q C4q'),
        ([(0, 'Dm7')], 'rq A4q A4h', 'rq F4q E4h', '꽃 은', 'rq D4q C4h'),
        ([], 'rq A4q G4q A4q', 'rq F4q E4q F4q', '시 드 나', 'rq D4q C4q D4q'),
        ([(0, 'Bb')], 'rq Bb4q G4h', 'rq F4q E4h', '주 의', 'rq D4q C4h'),
        ([], end_hi, end_mel, '말 씀 은 영 원 해', end_lo),
        ([(0, 'F')], REST, REST, '', REST),
        ([], REST, REST, '', REST),
    ]
    for k, (c, hi, mel, lyr, lo) in enumerate(rows):
        bar(c, hi if hi_on[k // 4] else REST, mel, lyr, lo if lo_on[k // 4] else REST,
            mark if k == 0 else None)


# 원본 표시: A 첫 줄은 위·아래 둘 다, 둘째 줄은 위·아래 둘 다
a_section(True, (True, True), (True, True), 'A')
# A 반복: 첫 줄은 표시 없음(제창), 둘째 줄은 낮은 화음만
a_section(False, (False, False), (False, True), 'A (반복)')

# A'
q1_hi = 'F4q F4e G4e~ G4e G4e~ G4e A4e~'
q1_mel = 'D4q D4e E4e~ E4e E4e~ E4e F4e~'
q1_lo = 'Bb3q Bb3e C4e~ C4e C4e~ C4e D4e~'
q2_hi = 'A4q A4e Bb4e~ Bb4e Bb4e~ Bb4e C5e~'
q2_mel = 'F4q F4e G4e~ G4e G4e~ G4e A4e~'
q2_lo = 'D4q D4e E4e~ E4e E4e~ E4e F4e~'
BC = [(0, 'Bb'), (2, 'C')]
# 1) 주의 말씀을 믿는 자 — 둘 다
bar(BC, q1_hi, q1_mel, '주 의 말 씀 을', q1_lo, "A'")
bar([(0, 'Dm7')], 'A4h rh', 'F4h rh', '', 'D4h rh')
bar([(0, 'Dm7'), (2, 'C'), (3.5, 'Gm7')], 'A4h Bb4qd F4e', 'F4h G4qd D4e', '믿 는 자', 'D4h E4qd Bb3e')
bar([], REST, REST, '', REST)
# 2) 그의 구원을 얻으리 — 둘 다
bar(BC, q2_hi, q2_mel, '그 의 구 원 을', q2_lo)
bar([(0, 'Dm7')], 'C5h rh', 'A4h rh', '', 'F4h rh')
bar([(0, 'Gm7'), (2, 'F'), (3.5, 'Eb')], 'D5h C5qd Bb4e~', 'Bb4h A4qd G4e~', '얻 으 리', 'G4h F4qd Eb4e~')
bar([], 'Bb4s A4s F4e Eb4h rq', 'G4s F4s D4e C4h rq', '', 'Eb4s D4s Bb3e G3h rq')
# 3) 주의 말씀을 행하는 자 — 낮은 화음만
bar(BC, REST, q1_mel, '주 의 말 씀 을', q1_lo)
bar([(0, 'Dm7')], REST, 'F4h rh', '', 'D4h rh')
bar([(0, 'Dm7'), (2, 'C'), (3, 'Gm7')], REST, 'F4h G4q G4e D4e', '행 하 는 자', 'D4h E4q D4e Bb3e')
bar([], REST, REST, '', REST)
# 4) 그의 능력을 보게 되리라 — 둘 다
bar(BC, q2_hi, q2_mel, '그 의 능 력 을', q2_lo)
bar([(0, 'Dm7')], 'C5h rq C5e C5e', 'A4h rq A4e A4e', '보 게', 'F4h rq F4e F4e')
bar([(0, 'Eb')], 'C5h C5qd C5e~', 'A4h A4qd F4e~', '되 리 라', 'F4h F4qd C4e~')
bar([(0, 'Csus4')], 'C5hd rq', 'F4hd rq', '', 'C4hd rq')
bar([(0, 'C')], REST, REST, '', REST)

# B
b_mel_2 = 'Bb4t Bb4t Bb4t A4q F4e F4e~'
b_hi_2 = 'D5t D5t D5t C5q A4e A4e~'
b_hi_2c = 'D5t D5t D5t C5q A4e C5e~'  # 다음 마디 C5 지속음으로 이어짐
# 1) 주의 말씀은 영원해 — 높은 화음만
bar([(0, 'F')], 'A4h F5h', 'F4h C5h', '주 의', REST, 'B')
bar([], b_hi_2, b_mel_2, '말 씀 은 영 원 해', REST)
bar([(0, 'Dm7')], 'A4h rh', 'F4h rh', '', REST)
bar([], REST, REST, '', REST)
# 2) — 높은 화음만
bar([(0, 'Bb')], 'Bb4h F5h', 'F4h C5h', '주 의', REST)
bar([], b_hi_2c, b_mel_2, '말 씀 은 영 원 해', REST)
bar([(0, 'Csus4')], 'C5h~ C5e C5e C5e C5e~', 'F4h~ F4e G4e A4e G4e~', '', REST)
bar([(0, 'C')], 'C5h rh', 'G4h rh', '', REST)
# 3) — 높은 화음만
bar([(0, 'F')], 'A4h F5h', 'F4h C5h', '주 의', REST)
bar([], b_hi_2, b_mel_2, '말 씀 은 영 원 해', REST)
bar([(0, 'Dm7')], 'A4h rh', 'F4h rh', '', REST)
bar([], REST, REST, '', REST)
# 4) — 둘 다, 끝날 때 rit.
bar([(0, 'Bb')], 'Bb4h F5h', 'F4h C5h', '주 의', 'D4h F4h')
bar([], b_hi_2c, b_mel_2, '말 씀 은 영 원 해', 'F4t F4t F4t F4q C4e C4e~')
bar([(0, 'C')], 'C5h~ C5e C5e C5e C5e~', 'F4h~ F4e G4e A4e G4e~', '', 'C4h~ C4e E4e F4e E4e~')
bar([], 'C5h A4q G4e A4e~', 'G4h F4q E4e F4e~', '영 원 해', 'E4h D4q C4e D4e~')
bar([(0, 'Dm7')], 'A4h~ A4e Bb4e C5e C5e~', 'F4h~ F4e G4e A4e G4e~', '', 'D4h~ D4e E4e F4e E4e~')
bar([(0, 'C/E')], 'C5q re A4q G4e A4q', 'G4q re F4q E4e F4q', '영 원 해', 'E4q re D4q C4e C4q', 'rit.')

# Inter
for k in range(4):
    bar([(0, 'F')] if k in (0, 2) else [], REST, REST, '', REST, 'Inter' if k == 0 else None)

# ---------------- MusicXML 출력 ----------------
KIND = {'': 'major', 'm7': 'minor-seventh', 'sus4': 'suspended-fourth', 'm': 'minor'}


def harmony_xml(name, offset):
    bass = None
    if '/' in name:
        name, bass = name.split('/')
    root = name[0]
    alter = -1 if name[1:2] == 'b' else 0
    kind = name[1 + (alter != 0):]
    x = f'<harmony><root><root-step>{root}</root-step>'
    if alter:
        x += '<root-alter>-1</root-alter>'
    x += f'</root><kind text="{kind}">{KIND[kind]}</kind>'
    if bass:
        x += f'<bass><bass-step>{bass}</bass-step></bass>'
    if offset:
        x += f'<offset>{int(offset * DIV)}</offset>'
    return x + '</harmony>'


def note_xml(pitch, dur, tie_start, tie_stop, lyric=None, measure_rest=False, tuplet=None):
    x = '<note>'
    if pitch is None:
        x += '<rest measure="yes"/>' if measure_rest else '<rest/>'
    else:
        step, acc, octv = pitch
        x += f'<pitch><step>{step}</step>'
        if acc:
            x += f'<alter>{STEP_ALTER[acc]}</alter>'
        x += f'<octave>{octv}</octave></pitch>'
    x += f'<duration>{dur}</duration>'
    if tie_stop:
        x += '<tie type="stop"/>'
    if tie_start:
        x += '<tie type="start"/>'
    x += '<voice>1</voice>'
    if not measure_rest:
        t, dots = TYPE[dur]
        x += f'<type>{t}</type>' + '<dot/>' * dots
    if dur == 8:
        x += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
    nots = f'<tuplet type="{tuplet}" bracket="yes"/>' if tuplet else ''
    if tie_stop:
        nots += '<tied type="stop"/>'
    if tie_start:
        nots += '<tied type="start"/>'
    if nots:
        x += f'<notations>{nots}</notations>'
    if lyric:
        x += f'<lyric><syllabic>single</syllabic><text>{lyric}</text></lyric>'
    return x + '</note>'


PARTS = [('P1', '높은 화음', 1), ('P2', '멜로디', 2), ('P3', '낮은 화음', 4)]


def part_xml(pid, idx):
    out = [f'<part id="{pid}">']
    tie_carry = False
    for n, (chords, hi, mel, lyr, lo, mark) in enumerate(M, 1):
        src = (hi, mel, None, None, lo)[idx]
        notes = parse(src)
        x = f'<measure number="{n}">'
        if n == 1:
            x += (f'<attributes><divisions>{DIV}</divisions><key><fifths>-1</fifths></key>'
                  '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>'
                  '</attributes>')
            if idx == 0:
                x += ('<direction placement="above"><direction-type><words>전주 없이 바로 시작'
                      '</words></direction-type></direction>')
        if mark and idx == 1:
            x += (f'<direction placement="above"><direction-type><words font-weight="bold">{mark}'
                  '</words></direction-type></direction>')
        lyrics = lyr.split() if idx == 1 else []
        li = 0
        # 코드는 멜로디 줄에만 붙인다
        chord_list = sorted(chords) if idx == 1 else []
        pos = 0
        trip = 0
        for pitch, dur, tie in notes:
            tup = None
            if dur == 8:
                tup = ('start', None, 'stop')[trip % 3]
                trip += 1
            while chord_list and chord_list[0][0] * DIV <= pos:
                c_off, c_name = chord_list.pop(0)
                x += harmony_xml(c_name, (c_off * DIV - pos) / DIV)
            ly = None
            if pitch is not None and not tie_carry and li < len(lyrics):
                ly = lyrics[li]
                li += 1
            whole_rest = pitch is None and dur == 48
            x += note_xml(pitch, dur, tie, tie_carry and pitch is not None, ly, whole_rest, tup)
            tie_carry = tie
            pos += dur
        for c_off, c_name in chord_list:  # 남은 코드(쉼표 마디 등)
            x += harmony_xml(c_name, 0)
        x += '</measure>'
        out.append(x)
    out.append('</part>')
    return ''.join(out)


def check_ties():
    for idx in (1, 2, 4):
        flat = [n for m in M for n in parse(m[idx])]
        for (p, _, tie), (q, _, _) in zip(flat, flat[1:]):
            assert not tie or p == q, (idx, p, q)


def build():
    check_ties()
    head = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" '
            '"http://www.musicxml.org/dtds/partwise.dtd">\n'
            '<score-partwise version="3.1"><work><work-title>풀은 마르고 (3성부 화음)</work-title></work>'
            '<part-list>')
    for pid, name, _ in PARTS:
        head += f'<score-part id="{pid}"><part-name>{name}</part-name></score-part>'
    head += '</part-list>'
    body = part_xml('P1', 0) + part_xml('P2', 1) + part_xml('P3', 4)
    return head + body + '</score-partwise>\n'


if __name__ == '__main__':
    here = Path(__file__).parent
    (here / '풀은마르고-화음.musicxml').write_text(build(), encoding='utf-8')
    print(len(M), 'measures')
