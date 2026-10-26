from dataclasses import dataclass
from itertools import cycle
from math import ceil
from struct import pack
from typing import NamedTuple
lazy from collections.abc import Iterator

from audio.theory import BAR, spell
from audio.voices import VOICES, Drum
lazy from audio.score import Score

PPQ = 480
DRUM_CHANNEL = 9
TICKS_PER_BAR = BAR * PPQ
NOTATION = {
    2880: ("half", 1),
    1920: ("whole", 0),
    1440: ("quarter", 1),
    960: ("half", 0),
    720: ("eighth", 1),
    480: ("quarter", 0),
    360: ("16th", 1),
    240: ("eighth", 0),
    180: ("32nd", 1),
    120: ("16th", 0),
    60: ("32nd", 0),
}
GRID = min(NOTATION)


class Event(NamedTuple):
    start: int
    length: int
    pitch: int
    vel: int


@dataclass(frozen=True, slots=True)
class Piece:
    start: int
    length: int
    pitch: int
    tie_start: bool
    tie_stop: bool


def is_drum(voice: str) -> bool:
    return isinstance(VOICES[voice], Drum)


def ticks(seconds: float, beat: float, grid: int = 1) -> int:
    return round(seconds / beat * PPQ / grid) * grid


def events(score: Score, grid: int = 1) -> dict[str, list[Event]]:
    out: dict[str, list[Event]] = {name: [] for name in score.voices}
    for row in score:
        voice = VOICES[row.voice]
        out[row.voice].append(
            Event(
                ticks(row.t, score.beat, grid),
                max(1, ticks(row.dur or voice.dur, score.beat)),
                voice.note(row),
                max(1, min(127, round(row.vel * 127))),
            )
        )
    for rows in out.values():
        rows.sort()
    return out


def varlen(value: int) -> bytes:
    out = bytearray([value & 0x7F])
    while value := value >> 7:
        out.insert(0, (value & 0x7F) | 0x80)
    return bytes(out)


def meta(kind: int, payload: bytes) -> bytes:
    return b"\xff" + bytes([kind]) + varlen(len(payload)) + payload


def chunk(body: bytes) -> bytes:
    return b"MTrk" + pack(">I", len(body)) + body


def pairs(rows: list[Event]) -> list[tuple[int, int, int, int]]:
    return sorted(
        [(e.start, 1, e.pitch, e.vel) for e in rows]
        + [(e.start + e.length, 0, e.pitch, 0) for e in rows]
    )


def track(channel: int, name: str, rows: list[Event]) -> bytes:
    body = varlen(0) + meta(0x03, name.encode())
    body += varlen(0) + bytes([0xC0 | channel, VOICES[name].program])
    previous = 0
    for at, on, note, vel in pairs(rows):
        body += varlen(at - previous)
        body += bytes([(0x90 if on else 0x80) | channel, note, vel])
        previous = at
    return chunk(body + varlen(0) + meta(0x2F, b""))


def midi(score: Score) -> bytes:
    rows = events(score)
    channels = cycle(c for c in range(16) if c != DRUM_CHANNEL)
    conductor = chunk(
        varlen(0)
        + meta(0x03, b"promo")
        + varlen(0)
        + meta(0x51, round(score.beat * 1e6).to_bytes(3, "big"))
        + varlen(0)
        + meta(0x58, bytes([BAR, 2, 24, 8]))
        + varlen(0)
        + meta(0x2F, b"")
    )
    tracks = [conductor] + [
        track(
            DRUM_CHANNEL if is_drum(name) else next(channels), name, rows[name]
        )
        for name in score.voices
    ]
    return b"MThd" + pack(">IHHH", 6, 1, len(tracks), PPQ) + b"".join(tracks)


def snap(value: int) -> int:
    return min(NOTATION, key=lambda n: (abs(n - value), -n))


def floor_note(limit: int) -> int:
    return max((n for n in NOTATION if n <= limit), default=GRID)


def pieces(event: Event) -> Iterator[Piece]:
    start, remaining, first = event.start, event.length, True
    while remaining > 0:
        room = TICKS_PER_BAR - start % TICKS_PER_BAR
        value = min(snap(min(remaining, room)), room)
        if value not in NOTATION:
            value = floor_note(room)
        yield Piece(start, value, event.pitch, value < remaining, not first)
        start += value
        remaining -= value
        first = False


def note_xml(piece: Piece) -> str:
    step, alter, octave = spell(piece.pitch)
    kind, dots = NOTATION.get(piece.length, ("quarter", 0))
    ties = [
        t
        for t, on in (("stop", piece.tie_stop), ("start", piece.tie_start))
        if on
    ]
    tied = "".join(f'<tied type="{t}"/>' for t in ties)
    return "".join((
        "<note>",
        f"<pitch><step>{step}</step>",
        f"<alter>{alter}</alter>" if alter else "",
        f"<octave>{octave}</octave></pitch>",
        *(f'<tie type="{t}"/>' for t in ties),
        f"<duration>{piece.length}</duration><voice>1</voice><type>{kind}</type>",
        "<dot/>" * dots,
        f"<notations>{tied}</notations>" if tied else "",
        "</note>",
    ))


def rests(length: int) -> str:
    out = ""
    while length > 0:
        value = floor_note(length)
        kind, dots = NOTATION[value]
        out += (
            f"<note><rest/><duration>{value}</duration><voice>1</voice>"
            f"<type>{kind}</type>{'<dot/>' * dots}</note>"
        )
        length -= value
    return out


def measure(items: list[Piece], number: int, head: str) -> str:
    body = ""
    cursor = 0
    for piece in sorted(
        items, key=lambda p: (p.start % TICKS_PER_BAR, -p.length)
    ):
        start = piece.start % TICKS_PER_BAR
        if start > cursor:
            body += rests(start - cursor)
        elif start < cursor:
            body += f"<backup><duration>{cursor - start}</duration></backup>"
        body += note_xml(piece)
        cursor = start + piece.length
    tail = rests(max(0, TICKS_PER_BAR - cursor))
    return f'<measure number="{number}">{head}{body}{tail}</measure>'


def attributes(clef: str) -> str:
    return (
        f"<attributes><divisions>{PPQ}</divisions>"
        "<key><fifths>-1</fifths></key>"
        f"<time><beats>{BAR}</beats><beat-type>4</beat-type></time>"
        f"<clef><sign>{clef}</sign><line>{4 if clef == 'F' else 2}</line></clef>"
        "</attributes>"
    )


def sheet(score: Score) -> str:
    rows = events(score, GRID)
    pitched = [name for name in score.voices if not is_drum(name)]
    bars = ceil(score.n_beats / BAR)
    parts = []
    for index, name in enumerate(pitched, start=1):
        buckets: list[list[Piece]] = [[] for _ in range(bars)]
        for event in rows[name]:
            for piece in pieces(event):
                buckets[min(bars - 1, piece.start // TICKS_PER_BAR)].append(
                    piece
                )
        head = attributes("F" if name == "bass" else "G")
        parts.append(
            f'<part id="P{index}">'
            + "".join(
                measure(items, number, head if number == 1 else "")
                for number, items in enumerate(buckets, start=1)
            )
            + "</part>"
        )
    listing = "".join(
        f'<score-part id="P{index}"><part-name>{name}</part-name>'
        f'<midi-instrument id="P{index}-I1"><midi-channel>{index}</midi-channel>'
        f"<midi-program>{VOICES[name].program + 1}</midi-program>"
        "</midi-instrument></score-part>"
        for index, name in enumerate(pitched, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<score-partwise version="4.0">'
        "<work><work-title>Promo</work-title></work>"
        "<identification><encoding><software>audio</software></encoding></identification>"
        f"<part-list>{listing}</part-list>"
        + "".join(parts)
        + "</score-partwise>"
    )
