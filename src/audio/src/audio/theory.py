from dataclasses import dataclass
from functools import cache

BAR = 4
EIGHTH = 1 / 2
SIXTEENTH = 1 / 4

SHARP = (
    ("C", 0),
    ("C", 1),
    ("D", 0),
    ("D", 1),
    ("E", 0),
    ("F", 0),
    ("F", 1),
    ("G", 0),
    ("G", 1),
    ("A", 0),
    ("A", 1),
    ("B", 0),
)
NATURAL = {letter: pitch - alter for pitch, (letter, alter) in enumerate(SHARP)}


@cache
def midi(name: str) -> int:
    letter, rest = name[0].upper(), name[1:]
    alter = 0
    while rest[:1] in {"#", "b"}:
        alter += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    return 12 * (int(rest) + 1) + NATURAL[letter] + alter


def notes(names: str) -> tuple[int, ...]:
    return tuple(sorted(midi(n) for n in names.split()))


def spell(pitch: int) -> tuple[str, int, int]:
    letter, alter = SHARP[pitch % 12]
    return letter, alter, pitch // 12 - 1


def hz(pitch: float) -> float:
    return float(440 * 2 ** ((pitch - 69) / 12))


@dataclass(frozen=True, slots=True)
class Chord:
    voicing: tuple[int, ...]
    stab: tuple[int, ...] = ()

    @property
    def root(self) -> int:
        return self.voicing[0] - 12

    @property
    def brass(self) -> tuple[int, ...]:
        return self.stab or self.voicing


CHORDS = {
    "Dm9": Chord(notes("D3 A3 F4 C5 E5")),
    "D9": Chord(notes("D3 A3 F#4 C5 E5")),
    "A7": Chord(notes("A2 E3 A3 C4 G4")),
    "Bm7": Chord(notes("B2 F#3 A3 D4")),
    "Em7": Chord(notes("E2 B2 E3 G3 D4")),
    "Gmaj7": Chord(notes("G2 D3 G3 B3 F#4")),
    "G7": Chord(notes("G2 D3 G3 B3 F4")),
    "Cmaj7": Chord(notes("C3 G3 B3 E4")),
    "Fmaj7": Chord(notes("F2 C3 F3 A3 E4"), notes("F3 C4 F4 A4 E5")),
    "Bbmaj": Chord(notes("Bb2 F3 Bb3 D4 A4")),
    "Gm9": Chord(notes("G2 D3 G3 Bb3 F4 A4")),
    "Asus4": Chord(notes("A2 E3 A3 D4")),
}

type Phrase = tuple[tuple[str, float], ...]

AXIS = midi("D5") + midi("A5")


def negative(phrase: Phrase) -> Phrase:
    def mirror(name: str) -> str:
        letter, alter, octave = spell(AXIS - midi(name))
        return f"{letter}{'#' * alter}{octave}"

    return tuple((mirror(name), length) for name, length in phrase)
