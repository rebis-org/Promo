from struct import Struct

import numpy as np

from audio.dsp import SR, Wave

HEADER = Struct("<4sI4s4sIHHIIHH4sI")
FLOAT = 3
BITS = 32


def encode(x: Wave) -> bytes:
    x = np.ascontiguousarray(x, np.float32)
    channels = x.shape[1]
    data = x.tobytes()
    return (
        HEADER.pack(
            b"RIFF",
            36 + len(data),
            b"WAVE",
            b"fmt ",
            16,
            FLOAT,
            channels,
            SR,
            SR * channels * BITS // 8,
            channels * BITS // 8,
            BITS,
            b"data",
            len(data),
        )
        + data
    )
