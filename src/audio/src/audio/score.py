from dataclasses import asdict, dataclass
from typing import NamedTuple
lazy from collections.abc import Iterable, Iterator

import numpy as np

COLUMNS = ("t", "dur", "pitch", "vel", "code")


class Row(NamedTuple):
    t: float
    dur: float
    pitch: int
    vel: float
    voice: str


@dataclass(frozen=True, slots=True)
class Section:
    name: str
    start: float
    end: float
    space: float


@dataclass(frozen=True, slots=True)
class Score:
    bpm: float
    n_beats: int
    duration: float
    sections: tuple[Section, ...]
    voices: tuple[str, ...]
    t: np.ndarray
    dur: np.ndarray
    pitch: np.ndarray
    vel: np.ndarray
    code: np.ndarray

    @property
    def beat(self) -> float:
        return 60 / self.bpm

    @classmethod
    def build(
        cls,
        *,
        bpm: float,
        n_beats: int,
        sections: tuple[Section, ...],
        rows: Iterable[Row],
    ) -> Score:
        rows = tuple(rows)
        voices = tuple(dict.fromkeys(row.voice for row in rows))
        index = {name: i for i, name in enumerate(voices)}
        return cls(
            bpm=bpm,
            n_beats=n_beats,
            duration=n_beats * 60 / bpm,
            sections=sections,
            voices=voices,
            t=np.array([round(row.t, 6) for row in rows]),
            dur=np.array([round(row.dur, 6) for row in rows]),
            pitch=np.array([row.pitch for row in rows], np.int16),
            vel=np.array([round(row.vel, 3) for row in rows]),
            code=np.array([index[row.voice] for row in rows], np.int8),
        )

    def __len__(self) -> int:
        return len(self.t)

    def __iter__(self) -> Iterator[Row]:
        return (
            Row(t, d, int(p), v, self.voices[c])
            for t, d, p, v, c in zip(
                self.t, self.dur, self.pitch, self.vel, self.code, strict=True
            )
        )

    def times(self, voice: str) -> np.ndarray:
        if voice not in self.voices:
            return self.t[:0]
        return self.t[self.code == self.voices.index(voice)]

    def grid(self, step: int = 1) -> list[float]:
        return [round(i * self.beat, 5) for i in range(0, self.n_beats, step)]

    def dump(self) -> dict[str, object]:
        return {
            "bpm": self.bpm,
            "n_beats": self.n_beats,
            "duration": self.duration,
            "sections": [asdict(section) for section in self.sections],
            "voices": list(self.voices),
            **{name: getattr(self, name).tolist() for name in COLUMNS},
        }
