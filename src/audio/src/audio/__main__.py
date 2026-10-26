import argparse
import json
from pathlib import Path
from typing import NamedTuple
lazy from collections.abc import Callable

from audio import analyze, compose, export, synth, wav
lazy from audio.score import Score
lazy from audio.synth import Master

PROJECT = Path(__file__).resolve().parents[2]
WORK = PROJECT / "work"
DATA = PROJECT.parent / "video" / "data"


class Stage(NamedTuple):
    path: Path
    emit: Callable[..., bytes]
    note: Callable[..., str]


NOTATION: dict[str, Stage] = {
    "score": Stage(
        WORK / "score.json",
        lambda s: json.dumps(s.dump()).encode(),
        lambda s: f"{len(s)} rows over {len(s.voices)} voices",
    ),
    "midi": Stage(
        WORK / "track.mid",
        export.midi,
        lambda s: f"{len(s.voices)} tracks, {s.bpm:g} BPM, {export.PPQ} PPQ",
    ),
    "sheet": Stage(
        WORK / "track.musicxml",
        lambda s: export.sheet(s).encode(),
        lambda s: f"{s.n_beats} beats",
    ),
}

SOUND: dict[str, Stage] = {
    "audio": Stage(
        WORK / "track.wav",
        lambda _s, m: wav.encode(m.wave),
        lambda _s, m: str(m),
    ),
    "features": Stage(
        DATA / "audio.json",
        lambda s, m: json.dumps(analyze.features(m.wave, s)).encode(),
        lambda s, _m: f"{s.duration}s, {s.n_beats} beats",
    ),
}


def run(
    stages: dict[str, Stage], wanted: set[str], *args: Score | Master
) -> None:
    for name, stage in stages.items():
        if name in wanted:
            stage.path.parent.mkdir(parents=True, exist_ok=True)
            stage.path.write_bytes(stage.emit(*args))
            print(f"{stage.path.name}: {stage.note(*args)}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="audio", description=__doc__)
    parser.add_argument("stages", nargs="*", choices=(*NOTATION, *SOUND))
    wanted = set(parser.parse_args(argv).stages) or {*NOTATION, *SOUND}
    WORK.mkdir(parents=True, exist_ok=True)

    score = compose.compose()
    run(NOTATION, wanted, score)
    if wanted & SOUND.keys():
        run(SOUND, wanted, score, synth.render(score))


if __name__ == "__main__":
    main()
