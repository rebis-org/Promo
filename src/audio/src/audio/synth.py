from dataclasses import dataclass
from typing import NamedTuple, override

import numpy as np

from audio.dsp import EPS, SR, Wave, convolve, echo, room
from audio.voices import VOICES, Bus
lazy from audio.score import Score

WORK_LEVEL = 10 ** (-13.2 / 20)
CEILING = 0.891
TRUE_PEAK = 10 ** (-1.0 / 20)
ROOM_GAIN = 0.24
ECHO_SEND = 0.3
ECHO_LEFT = 0.7
ECHO_DELAY = 0.3515625
ECHO_FEEDBACK = 0.42
ECHO_TAPS = 4
HAAS = 0.35
HAAS_DELAY = 0.009
SPACE_RAMP = 0.3
DUCK_LENGTH = 0.22
DUCK_DEPTH = 0.38
DUCK_RELEASE = 0.06


@dataclass(frozen=True, slots=True)
class Strip:
    left: float = 1.0
    right: float = 1.0
    reverb: float = 0.0
    echo: float = 0.0
    duck: bool = False


MIX: dict[Bus, Strip] = {
    Bus.PAD: Strip(1.00, 0.96, reverb=0.50, duck=True),
    Bus.BASS: Strip(duck=True),
    Bus.ARP: Strip(1.00, 0.94, reverb=0.35, echo=0.45),
    Bus.KICK: Strip(),
    Bus.SNARE: Strip(reverb=0.40),
    Bus.HAT: Strip(),
    Bus.OTHER: Strip(0.90, 1.00, reverb=0.50),
    Bus.TIMPANI: Strip(0.95, 0.95, reverb=0.60),
    Bus.GUZHENG: Strip(1.00, 0.94, reverb=0.22),
    Bus.PIANO: Strip(reverb=0.30),
    Bus.BRASS: Strip(1.00, 0.96, reverb=0.18),
    Bus.SHEPARD: Strip(0.70, 0.70, reverb=0.25),
}


class Master(NamedTuple):
    wave: Wave
    peak: float
    true_peak: float
    rms: float

    @override
    def __str__(self) -> str:
        return (
            f"sample peak {db(self.peak):.2f} dBFS  "
            f"true peak {db(self.true_peak):.2f} dBTP  "
            f"RMS {db(self.rms):.2f} dB"
        )


def db(value: float) -> float:
    return float(20 * np.log10(max(value, EPS)))


def peak(x: Wave) -> float:
    return float(np.abs(x).max())


def rms(x: Wave) -> float:
    return float(np.sqrt((x**2).mean()))


def true_peak(x: Wave) -> float:
    return float(
        np.abs(np.fft.irfft(np.fft.rfft(x, axis=0), 4 * len(x), axis=0)).max()
        * 4
    )


def headroom(level: float, ceiling: float) -> float:
    return min(1.0, ceiling / max(level, EPS))


def render(score: Score) -> Master:
    n = round(score.duration * SR)
    return master(mix(buses(score, n), n, reverb_curve(score, n)))


def reverb_curve(score: Score, n: int) -> Wave:
    curve = np.ones(n)
    for i, section in enumerate(score.sections):
        before = score.sections[i - 1].space if i else section.space
        lo = round(section.start * SR)
        hi = min(n, round(section.end * SR))
        ramp = min(int(SPACE_RAMP * SR), hi - lo)
        curve[lo : lo + ramp] = np.linspace(before, section.space, ramp)
        curve[lo + ramp : hi] = section.space
    return curve


def buses(score: Score, n: int) -> dict[Bus, Wave]:
    out = {bus: np.zeros(n) for bus in Bus}
    for row in score:
        voice = VOICES[row.voice]
        wave = voice(row)
        start = int(row.t * SR)
        seg = wave[: max(0, n - start)]
        out[voice.bus][start : start + len(seg)] += seg
    sidechain(out, score.times("kick"), n)
    return out


def sidechain(dry: dict[Bus, Wave], kicks: Wave, n: int) -> None:
    envelope = np.ones(n)
    for t in kicks:
        start = int(t * SR)
        length = min(n - start, int(DUCK_LENGTH * SR))
        if length > 0:
            envelope[start : start + length] = np.minimum(
                envelope[start : start + length],
                1
                - DUCK_DEPTH * np.exp(-np.arange(length) / (SR * DUCK_RELEASE)),
            )
    for bus, strip in MIX.items():
        if strip.duck:
            dry[bus] *= envelope


def mix(dry: dict[Bus, Wave], n: int, curve: Wave) -> Wave:
    left, right = np.zeros(n), np.zeros(n)
    reverb_send, echo_send = np.zeros(n), np.zeros(n)
    for bus, strip in MIX.items():
        signal = dry[bus]
        left += signal * strip.left
        right += signal * strip.right
        if strip.reverb:
            reverb_send += signal * strip.reverb
        if strip.echo:
            echo_send += signal * strip.echo

    reverb_send *= curve
    left += convolve(reverb_send, room(11))[:n] * ROOM_GAIN
    right += convolve(reverb_send, room(12))[:n] * ROOM_GAIN
    delay = (
        echo(echo_send, ECHO_DELAY, ECHO_FEEDBACK, ECHO_TAPS)[:n] * ECHO_SEND
    )
    left += delay * ECHO_LEFT
    right += delay

    shift = int(HAAS_DELAY * SR)
    left[shift:] += dry[Bus.PAD][: n - shift] * HAAS
    right[: n - shift] += dry[Bus.PAD][shift:] * HAAS
    return np.stack([left, right], axis=1)


def master(stereo: Wave) -> Master:
    stereo *= WORK_LEVEL / max(rms(stereo), EPS)
    shaped = np.tanh(stereo)
    shaped *= headroom(peak(shaped), CEILING)
    over = true_peak(shaped)
    gain = headroom(over, TRUE_PEAK)
    shaped *= gain
    return Master(
        shaped.astype(np.float32), peak(shaped), over * gain, rms(shaped)
    )
