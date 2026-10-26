from math import ceil

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from audio.dsp import SR, Wave
lazy from audio.score import Score

FPS = 100
HOP = SR // FPS
WINDOW = 1024
DECIMALS = 4
BANDS = (
    ("low", 20, 250),
    ("mid", 250, 2000),
    ("high", 2000, 16000),
    ("bass", 30, 130),
    ("drums", 1500, 9000),
    ("other", 250, 5000),
)
ONSETS = ("kick", "snare", "hat")
FOLD = {"hatopen": "hat"}


def features(stereo: Wave, score: Score) -> dict[str, object]:
    mono = stereo.mean(axis=1)
    n = len(mono)
    frames = ceil(n / HOP)
    padded = np.concatenate((
        mono,
        np.zeros(max(0, (frames - 1) * HOP + WINDOW - n)),
    ))
    windows = sliding_window_view(padded, WINDOW)[::HOP] * np.hanning(WINDOW)
    magnitude = np.abs(np.fft.rfft(windows, axis=1))
    freqs = np.fft.rfftfreq(WINDOW, 1 / SR)
    levels = {"rms": np.sqrt((windows**2).mean(axis=1))} | {
        name: magnitude[:, (freqs >= low) & (freqs < high)].sum(axis=1)
        for name, low, high in BANDS
    }
    return {
        "duration": round(float(score.duration), 5),
        "bpm": score.bpm,
        "fps": FPS,
        "beats": score.grid(),
        "downbeats": score.grid(4),
        "sections": [
            {"name": s.name, "start": s.start, "end": s.end}
            for s in score.sections
        ],
        "features": {
            name: [round(float(v), DECIMALS) for v in normalise(level)]
            for name, level in levels.items()
        },
        "onsets": onsets(score),
    }


def normalise(values: Wave) -> Wave:
    top = values.max()
    return np.clip(values / top, 0, 1) if top > 0 else values


def onsets(score: Score) -> dict[str, list[list[float]]]:
    buckets: dict[str, list[list[float]]] = {name: [] for name in ONSETS}
    for row in score:
        kind = FOLD.get(row.voice, row.voice)
        if kind in buckets:
            buckets[kind].append([
                round(row.t, DECIMALS),
                round(min(1.0, row.vel), 3),
            ])
    return {name: sorted(hits) for name, hits in buckets.items()}
