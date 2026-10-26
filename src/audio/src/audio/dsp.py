import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

type Wave = np.ndarray
type Response = Callable[[Wave], Wave]
type Peaks = tuple[tuple[float, float, float], ...]
type Osc = Callable[[float, int, int], Wave]
type Kernel = Callable[[int, float], Wave]

SR = 48_000
EPS = 1e-9
TOP_PARTIAL = 0.45
BLOCK = 4096
GLIDE_BLOCK = 512


@dataclass(frozen=True, slots=True)
class Env:
    attack: float
    decay: float
    release: float
    sustain: float = 0.7

    def curve(self, n: int) -> Wave:
        a, d, r = (
            max(1, int(s * SR)) for s in (self.attack, self.decay, self.release)
        )
        if a + d + r > n:
            fit = n / (a + d + r)
            a = max(1, round(a * fit))
            d = max(1, round(d * fit))
            r = max(1, n - a - d)
        env = np.concatenate((
            np.linspace(0, 1, a, endpoint=False),
            np.linspace(1, self.sustain, d, endpoint=False),
            np.full(max(0, n - a - d - r), self.sustain),
            np.linspace(self.sustain, 0, r),
        ))
        return np.pad(env, (0, max(0, n - env.size)))[:n]


def span(n: int) -> Wave:
    return np.arange(n) / SR


def noise(n: int, seed: int) -> Wave:
    return np.random.default_rng(seed).standard_normal(n)


def additive(step: int, gain: float, bright: tuple[float, ...]) -> Osc:
    def osc(f: float, n: int, _seed: int) -> Wave:
        k = np.arange(1, int(TOP_PARTIAL * SR / f) + 1, step)
        axis = np.linspace(0.0, 1.0, len(bright))
        block = BLOCK if len(bright) == 1 else GLIDE_BLOCK
        out = np.empty(n)
        for start in range(0, n, block):
            t = (start + np.arange(min(block, n - start))) / SR
            here = float(np.interp((start + len(t) / 2) / n, axis, bright))
            amps = k**-1.0 * np.exp(-(k / (len(k) * here + 1)) * 1.6)
            out[start : start + len(t)] = (
                np.sin(math.tau * np.outer(k, f * t)) * amps[:, None]
            ).sum(axis=0)
        return out * gain

    return osc


def saw(bright: float = 1.0) -> Osc:
    return additive(1, 0.5, (bright,))


def square(bright: float = 1.0) -> Osc:
    return additive(2, 0.6, (bright,))


def swell(low: float = 0.45, high: float = 1.35) -> Osc:
    return additive(1, 0.5, (low, high))


def plucked(damping: float) -> Osc:
    def osc(f: float, n: int, seed: int) -> Wave:
        delay = max(2, round(SR / f))
        x = np.zeros(n)
        m = min(2 * delay, n)
        x[:m] = noise(m, seed)
        w = math.tau * np.fft.rfftfreq(n)
        loop = 1 - damping * np.exp(-1j * w * delay) * 0.5 * (
            1 + np.exp(-1j * w)
        )
        y = np.fft.irfft(np.fft.rfft(x) / loop, n)
        return y / (np.abs(y).max() + EPS)

    return osc


def spectral(x: Wave, response: Response) -> Wave:
    return np.fft.irfft(
        np.fft.rfft(x) * response(np.fft.rfftfreq(len(x), 1 / SR)), len(x)
    )


def match_level(reference: Wave, y: Wave) -> Wave:
    return y * (
        np.sqrt((reference**2).mean()) / max(np.sqrt((y**2).mean()), EPS)
    )


def lowpass(cutoff: float) -> Response:
    def response(f: Wave) -> Wave:
        skirt = (f > cutoff) & (f < cutoff * 1.15)
        gain = np.where(f <= cutoff, 1.0, 0.0)
        gain[skirt] = np.linspace(1, 0, skirt.sum(), endpoint=False)
        return gain

    return response


def formants(peaks: Peaks) -> Response:
    def response(f: Wave) -> Wave:
        shape = sum(
            gain / (1 + ((f - centre) / (width / 2)) ** 2)
            for centre, width, gain in peaks
        )
        return 0.3 + 0.7 * shape / shape.max()

    return response


def chirp(top: float, floor: float, tau: float, n: int) -> Wave:
    f = top * np.exp(-span(n) / tau) + floor
    return np.sin(math.tau * np.cumsum(f) / SR)


def decay(x: Wave, tau: float) -> Wave:
    return x * np.exp(-span(len(x)) / tau)


def room(seed: int, dur: float = 1.7, fall: float = 13.0) -> Wave:
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = span(n)
    x = rng.standard_normal(n) * np.exp(-fall * t)
    for tap, gain in ((0.021, 0.5), (0.037, 0.35), (0.053, 0.25)):
        i = int(tap * SR)
        x[i:] += gain * rng.standard_normal(n - i) * np.exp(-fall * t[: n - i])
    return x


def convolve(x: Wave, h: Wave) -> Wave:
    n = len(x) + len(h) - 1
    nfft = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)[:n]


def echo(
    x: Wave, delay: float, feedback: float, taps: int, damp: float = 0.55
) -> Wave:
    d = int(delay * SR)
    y = np.zeros(len(x) + d * taps + d)
    y[: len(x)] += x
    buf = x.copy()
    for k in range(1, taps + 1):
        buf *= damp
        y[k * d : k * d + len(buf)] += buf * (feedback**k)
    return y[: len(x) + d * taps]
