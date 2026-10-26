import math
from dataclasses import dataclass
from enum import StrEnum, auto
from functools import partial

import numpy as np

from audio.dsp import (
    SR,
    Env,
    Kernel,
    Osc,
    Peaks,
    Wave,
    chirp,
    decay,
    formants,
    lowpass,
    match_level,
    noise,
    plucked,
    saw,
    span,
    spectral,
    square,
    swell,
)
from audio.theory import hz
lazy from audio.score import Row

TAIL = 0.9


class Bus(StrEnum):
    PAD = auto()
    BASS = auto()
    ARP = auto()
    KICK = auto()
    SNARE = auto()
    HAT = auto()
    OTHER = auto()
    TIMPANI = auto()
    GUZHENG = auto()
    PIANO = auto()
    BRASS = auto()
    SHEPARD = auto()


@dataclass(frozen=True, slots=True)
class Instrument:
    osc: Osc
    env: Env
    cutoff: float
    gain: float
    bus: Bus
    program: int
    dur: float = 0.25
    detunes: tuple[float, ...] = (0.0,)
    unison: float = 1.0
    vowel: Peaks = ()

    def __call__(self, row: Row) -> Wave:
        n = max(8, int(row.dur * SR) + int(TAIL * SR))
        f = hz(row.pitch)
        seed = (row.pitch * 2654435761 + int(row.t * 1e4)) % 2**31
        x = self.osc(f * (1 + self.detunes[0]), n, seed)
        for k, detune in enumerate(self.detunes[1:], 1):
            x += self.osc(f * (1 + detune), n, seed + 7 * k)
        x *= self.unison
        x *= self.env.curve(n) * row.vel * self.gain
        x = spectral(x, lowpass(self.cutoff))
        return (
            match_level(x, spectral(x, formants(self.vowel)))
            if self.vowel
            else x
        )

    @staticmethod
    def note(row: Row) -> int:
        return row.pitch


@dataclass(frozen=True, slots=True)
class Drum:
    kernel: Kernel
    gain: float
    dur: float
    bus: Bus
    key: int
    program: int = 0

    def __call__(self, row: Row) -> Wave:
        dur = row.dur or self.dur
        return self.kernel(int(dur * SR), dur) * row.vel * self.gain

    def note(self, _row: Row) -> int:
        return self.key


def kick(n: int, _dur: float) -> Wave:
    x = decay(chirp(150, 44, 0.025, n), 0.11)
    m = min(n, 240)
    x[:m] += noise(m, 1) * np.exp(-np.arange(m) / (SR * 0.0015)) * 0.5
    return x


def snare(n: int, _dur: float) -> Wave:
    t = span(n)
    body = np.sin(math.tau * 188 * t) * np.exp(-t / 0.06)
    return body * 0.8 + decay(np.diff(noise(n, 2), prepend=0), 0.13) * 0.55


def hat(n: int, _dur: float, fall: float) -> Wave:
    return (
        decay(np.diff(np.diff(noise(n, 3), prepend=0), prepend=0), fall) * 0.6
    )


def clap(n: int, _dur: float) -> Wave:
    rng = np.random.default_rng(4)
    x = np.zeros(n)
    for k in range(3):
        i = int(k * 0.011 * SR)
        m = min(n - i, int(0.02 * SR))
        x[i : i + m] += rng.standard_normal(m) * np.exp(
            -np.arange(m) / (SR * 0.004)
        )
    return x + decay(rng.standard_normal(n), 0.09) * 0.25


def crash(n: int, _dur: float) -> Wave:
    return spectral(decay(noise(n, 5), 0.7), lowpass(9000))


def impact(n: int, _dur: float) -> Wave:
    return (
        decay(chirp(60, 36, 0.3, n), 0.5) * 0.9
        + spectral(decay(noise(n, 6), 0.25), lowpass(3000)) * 0.35
    )


def timpani(n: int, _dur: float) -> Wave:
    x = decay(chirp(66, 38, 0.4, n), 0.85)
    m = int(0.02 * SR)
    x[:m] += noise(m, 8) * 0.3
    return x


def shepard(n: int, dur: float) -> Wave:
    t = span(n)
    rise = t / dur
    out = np.zeros(n)
    for k in range(-3, 3):
        f = 220 * 2 ** (rise + k)
        out += np.sin(math.tau * np.cumsum(f) / SR) * np.exp(
            -0.5 * ((np.log2(f) - np.log2(220)) / 1.2) ** 2
        )
    return out * np.clip(np.minimum(t / 0.5, (dur - t) / 0.5), 0, 1) * 0.18


def inhale(n: int, dur: float) -> Wave:
    t = span(n)
    env = (t / dur) ** 3 * np.clip((dur - t) / 0.03, 0, 1)
    sweep = 660 * 2 ** (-2 * (t / dur))
    return (
        (noise(n, 9) * 0.7 + np.sin(math.tau * np.cumsum(sweep) / SR) * 0.3)
        * env
        * 0.5
    )


type Voice = Instrument | Drum

AH: Peaks = ((700.0, 130.0, 1.0), (1220.0, 140.0, 0.55), (2600.0, 220.0, 0.28))

VOICES: dict[str, Voice] = {
    "pad": Instrument(
        saw(0.5),
        Env(0.9, 0.4, 1.6),
        3600,
        0.16,
        bus=Bus.PAD,
        program=52,
        detunes=(0.004, -0.004),
        unison=0.5,
        vowel=AH,
    ),
    "choir": Instrument(
        saw(0.5),
        Env(1.4, 0.4, 1.8),
        3600,
        0.14,
        bus=Bus.PAD,
        program=52,
        detunes=(0.00445, 0.00945),
        unison=0.5,
        vowel=AH,
    ),
    "bass": Instrument(
        saw(0.8), Env(0.006, 0.08, 0.14), 760, 0.34, bus=Bus.BASS, program=38
    ),
    "arp": Instrument(
        square(1.1), Env(0.004, 0.06, 0.16), 6800, 0.11, bus=Bus.ARP, program=81
    ),
    "guzheng": Instrument(
        plucked(0.9985),
        Env(0.004, 0.05, 0.7),
        12000,
        0.36,
        bus=Bus.GUZHENG,
        program=107,
        detunes=(0.0, 0.0032),
        unison=0.5,
    ),
    "piano": Instrument(
        plucked(0.997),
        Env(0.003, 0.08, 0.8),
        3200,
        0.30,
        bus=Bus.PIANO,
        program=0,
    ),
    "piano_mute": Instrument(
        plucked(0.90),
        Env(0.002, 0.03, 0.12),
        1400,
        0.18,
        bus=Bus.GUZHENG,
        program=0,
    ),
    "brass": Instrument(
        saw(0.9),
        Env(0.09, 0.15, 0.55),
        2100,
        0.20,
        bus=Bus.BRASS,
        program=61,
        detunes=(0.004, 0.0, -0.004),
        unison=0.34,
    ),
    "brass_swell": Instrument(
        swell(0.4, 1.4),
        Env(0.18, 0.2, 0.7),
        2600,
        0.24,
        bus=Bus.BRASS,
        program=61,
        detunes=(0.004, 0.0, -0.004),
        unison=0.34,
    ),
    "kick": Drum(kick, 0.9, 0.3, bus=Bus.KICK, key=36),
    "snare": Drum(snare, 0.55, 0.35, bus=Bus.SNARE, key=38),
    "hat": Drum(partial(hat, fall=0.028), 0.28, 0.06, bus=Bus.HAT, key=42),
    "hatopen": Drum(partial(hat, fall=0.09), 0.3, 0.3, bus=Bus.HAT, key=46),
    "clap": Drum(clap, 0.4, 0.3, bus=Bus.SNARE, key=39),
    "crash": Drum(crash, 0.5, 1.6, bus=Bus.OTHER, key=49),
    "impact": Drum(impact, 0.9, 1.2, bus=Bus.OTHER, key=35),
    "timpani": Drum(timpani, 0.3, 1.1, bus=Bus.TIMPANI, key=47),
    "inhale": Drum(inhale, 0.5, 2.0, bus=Bus.OTHER, key=122),
    "shepard": Drum(shepard, 1.0, 10.0, bus=Bus.SHEPARD, key=119),
}
