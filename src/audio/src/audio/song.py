from dataclasses import dataclass, field, replace

from audio.theory import SIXTEENTH, Phrase, negative

BPM = 120
BEAT = 60 / BPM


def _mute(bar: str, *steps: int) -> str:
    return "".join("." if i in steps else c for i, c in enumerate(bar))


REST = "." * 16
HIT = "X" + "." * 15
_KICK = "X.....X.....X..."
_HAT = "x.X.x.X.x.X.x.X."
_SNARE = "....X.......X..."


@dataclass(frozen=True, slots=True)
class Lane:
    voice: str
    vel: float
    bars: tuple[str, ...]
    accents: dict[str, float] = field(default_factory=dict)

    def trimmed(self, factor: float) -> Lane:
        return replace(self, vel=self.vel * factor)


KICK = Lane("kick", 0.92, (_KICK,) * 4)
SNARE = Lane("snare", 0.62, (_SNARE,) * 4)
CLAP = Lane("clap", 0.6, (_SNARE,) * 4)
HAT = Lane(
    "hat", 0.34, (_HAT, _HAT, _HAT, _mute(_HAT, 12, 13, 14, 15)), {"X": 1.3}
)
FILL = Lane(
    "hat", 0.34, (REST, REST, REST, REST[:12] + "o+o+"), {"+": 1.15, "o": 0.9}
)
OPEN = Lane("hatopen", 0.48, (HIT, HIT, REST, HIT))
TIMPANI = Lane("timpani", 0.55, (HIT,) * 4)

_HAT_C = _mute(_HAT, 4, 12)
HAT_C = replace(HAT, bars=(_HAT_C, _HAT_C, _HAT_C, _mute(_HAT_C, 13, 14, 15)))


@dataclass(frozen=True, slots=True)
class Pad:
    voice: str
    level: float
    shift: int = 0
    enter: int = 0


@dataclass(frozen=True, slots=True)
class Segment:
    name: str
    first: int
    beats: int
    space: float
    silence: int = 0
    prog: tuple[tuple[str, ...], ...] = ()
    pads: tuple[Pad, ...] = ()
    pad_window: int = 4
    pad_lead: bool = False
    stagger: float = 0.0
    bass: float = 0.0
    pedal: float = 0.0
    approach: float = 0.0
    arp: tuple[float, ...] = ()
    octave: float = 0.0
    hush: int = 0
    stab: float = 0.0
    swell: float = 0.0
    drums: tuple[Lane, ...] = ()

    @property
    def end(self) -> int:
        return self.first + self.beats

    @property
    def start(self) -> int:
        return self.first + self.silence


ARP_EIGHTHS = tuple(0.26 if i % 2 == 0 else 0.0 for i in range(16))
ARP_3_4 = (0.34, 0.2, 0.2) * 5 + (0.34,)
ARP_HALF = (0.26, 0.0, 0.0, 0.0) * 4

SEGMENTS = (
    Segment(
        "intro",
        0,
        8,
        space=0.45,
        prog=(("Dm9",), ("Dm9",)),
        pads=(Pad("pad", 0.42), Pad("choir", 0.3, shift=2, enter=1)),
    ),
    Segment(
        "a",
        8,
        16,
        space=0.32,
        prog=(("Dm9",), ("A7",), ("Dm9",), ("Em7", "A7")),
        pads=(Pad("pad", 0.5),),
        bass=1.0,
        drums=(KICK.trimmed(0.85), SNARE, CLAP, HAT.trimmed(0.85), FILL),
    ),
    Segment(
        "b",
        24,
        16,
        space=0.45,
        prog=(("D9",), ("Bm7", "Gmaj7"), ("Em7", "A7"), ("Asus4",)),
        pads=(Pad("pad", 0.54),),
        pad_window=2,
        bass=1.0,
        approach=0.34,
        arp=ARP_EIGHTHS,
        hush=4,
        swell=0.45,
        drums=(KICK, SNARE, CLAP.trimmed(0.7), HAT, FILL, OPEN),
    ),
    Segment(
        "climax",
        40,
        16,
        space=0.70,
        prog=(("Dm9",), ("Dm9",), ("Bbmaj",), ("Gm9", "A7")),
        pads=(Pad("pad", 0.62),),
        bass=1.0,
        arp=ARP_3_4,
        octave=0.5,
        stab=0.34,
        drums=(KICK, SNARE, CLAP, HAT, FILL, OPEN, TIMPANI),
    ),
    Segment(
        "c",
        56,
        10,
        space=1.30,
        silence=2,
        prog=(("Bbmaj",), ("Gm9",)),
        pads=(Pad("pad", 0.42),),
        stagger=0.1,
        bass=0.8,
        arp=ARP_HALF,
        drums=(SNARE.trimmed(0.8), CLAP, HAT_C, FILL, OPEN),
    ),
    Segment(
        "coda",
        66,
        4,
        space=2.00,
        prog=(("Dm9",),),
        pads=(Pad("pad", 0.26),),
        pad_window=2,
        pad_lead=True,
        bass=0.44,
        pedal=2.0,
    ),
)
SEGMENT_OF = {segment.name: segment for segment in SEGMENTS}

CELL: Phrase = (("D5", 1.0), ("F5", 0.5), ("G5", 0.5))
SIGH: Phrase = (("D5", 2.0),)
SUSPEND: Phrase = (("C5", 2.0),)
THEME_A: Phrase = (
    *CELL,
    ("A5", 1.5),
    ("G5", 0.5),
    ("F5", 0.5),
    ("D5", 1.0),
    ("C5", 0.5),
    ("D5", 1.5),
)
THEME_NEG: Phrase = negative(THEME_A)
THEME_INV: Phrase = (
    ("D5", 1.0),
    ("C5", 0.5),
    ("A4", 0.5),
    ("G4", 1.5),
    ("A4", 0.5),
    ("C5", 0.5),
    ("D5", 2.0),
)


@dataclass(frozen=True, slots=True)
class Call:
    segment: str
    bar: int
    phrase: Phrase
    voice: str
    vel: float
    shift: int = 0
    at: float = 0.0


CIRCLE = (
    Call("b", 0, THEME_NEG, "guzheng", 0.54),
    Call("b", 2, THEME_NEG, "guzheng", 0.5),
    Call("b", 2, THEME_NEG, "brass", 0.24, shift=-12),
)

CALLS = (
    Call("intro", 0, CELL, "guzheng", 0.6),
    Call("intro", 0, CELL, "piano_mute", 0.3, at=SIXTEENTH),
    Call("intro", 1, CELL, "guzheng", 0.5, shift=2),
    Call("intro", 1, CELL, "piano_mute", 0.26, shift=2, at=SIXTEENTH),
    Call("intro", 1, THEME_INV[:4], "guzheng", 0.42, at=2),
    Call("a", 0, THEME_A, "guzheng", 0.58),
    Call("a", 2, THEME_A, "guzheng", 0.55),
    Call("a", 2, THEME_A, "brass", 0.3, shift=-12),
    Call("a", 3, THEME_INV[:6], "guzheng", 0.5),
    *CIRCLE,
    Call("climax", 0, THEME_INV, "guzheng", 0.85),
    Call("climax", 0, THEME_INV, "brass", 0.34, shift=-12),
    Call("climax", 2, THEME_A[:7], "brass", 0.58),
    Call("c", 0, SIGH, "guzheng", 0.5),
    Call("c", 1, SUSPEND, "guzheng", 0.4, at=2),
    Call("coda", 0, CELL, "piano", 0.5),
)


@dataclass(frozen=True, slots=True)
class OneShot:
    beat: int
    voice: str
    vel: float
    dur: float = 0.0


ONESHOTS = (
    OneShot(8, "crash", 0.6),
    OneShot(24, "crash", 0.6),
    OneShot(36, "inhale", 0.5, 2.0),
    OneShot(36, "shepard", 0.32, 10.0),
    OneShot(40, "impact", 0.95),
    OneShot(40, "crash", 0.65),
)
