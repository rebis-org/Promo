from dataclasses import dataclass
from itertools import chain
lazy from collections.abc import Callable, Iterator

from audio.score import Row, Score, Section
from audio.song import (
    BEAT,
    BPM,
    CALLS,
    ONESHOTS,
    SEGMENT_OF,
    SEGMENTS,
    Call,
    Segment,
)
from audio.theory import BAR, CHORDS, EIGHTH, SIXTEENTH, midi

ARTICULATION = 0.92
PAD_ROOT = 0.9
PAD_TONE = 0.72

BASS_STEPS = (0, None, 7, 0, 10, None, 7, 12)
BASS_VEL = (0.58, 0.44)
BASS_LENGTH = 0.42
ANTICIPATION = 6
APPROACH = -3
APPROACH_LENGTH = 0.25

ARP_LENGTH = 0.2
STAB_LENGTH = 3.4
HUSHED = frozenset({"hat", "hatopen"})
STEPS_PER_BEAT = round(1 / SIXTEENTH)


@dataclass(frozen=True, slots=True)
class Bar:
    segment: Segment
    index: int
    first: int
    beats: int
    chords: tuple[str, ...]


def bars() -> Iterator[Bar]:
    for segment in SEGMENTS:
        for index, chords in enumerate(segment.prog):
            first = segment.start + BAR * index
            beats = min(BAR, segment.end - first)
            if beats <= 0:
                break
            yield Bar(segment, index, first, beats, chords)


BARS = tuple(bars())
ROOTS = tuple((bar.first, CHORDS[bar.chords[0]].root) for bar in BARS)
BEAT_SEGMENT = tuple(
    segment for segment in SEGMENTS for _ in range(segment.beats)
)


def compose() -> Score:
    return Score.build(
        bpm=BPM,
        n_beats=SEGMENTS[-1].end,
        sections=tuple(
            Section(s.name, s.first * BEAT, s.end * BEAT, s.space)
            for s in SEGMENTS
        ),
        rows=chain(accompaniment(), calls(), percussion(), one_shots()),
    )


def accompaniment() -> Iterator[Row]:
    for bar in BARS:
        for layer in LAYERS:
            yield from layer(bar)


def pad(bar: Bar) -> Iterator[Row]:
    window = min(bar.segment.pad_window, bar.beats)
    offset = (
        bar.first if bar.segment.pad_lead else bar.first + bar.beats - window
    )
    slot = window / len(bar.chords)
    for layer in bar.segment.pads:
        if not layer.level or bar.index < layer.enter:
            continue
        for i, name in enumerate(bar.chords):
            voicing = CHORDS[name].voicing
            t = (offset + i * slot) * BEAT
            yield Row(
                t,
                slot * BEAT,
                voicing[0] + layer.shift,
                layer.level * PAD_ROOT,
                layer.voice,
            )
            for pitch in voicing[1:]:
                yield Row(
                    t + bar.segment.stagger * BEAT,
                    slot * BEAT,
                    pitch + layer.shift,
                    layer.level * PAD_TONE,
                    layer.voice,
                )


def bass(bar: Bar) -> Iterator[Row]:
    level = bar.segment.bass
    if not level:
        return
    if bar.segment.pedal:
        yield Row(
            bar.first * BEAT,
            bar.segment.pedal * BEAT,
            CHORDS[bar.chords[0]].root,
            level,
            "bass",
        )
        return
    for i, step in enumerate(BASS_STEPS):
        if step is None or i * EIGHTH >= bar.beats:
            continue
        name = bar.chords[0] if i < ANTICIPATION else bar.chords[-1]
        yield Row(
            (bar.first + i * EIGHTH) * BEAT,
            BASS_LENGTH * BEAT,
            CHORDS[name].root + step,
            BASS_VEL[i % 2] * level,
            "bass",
        )
    if bar.segment.approach:
        yield Row(
            (bar.first + bar.beats - EIGHTH) * BEAT,
            APPROACH_LENGTH * BEAT,
            next_root(bar.first + bar.beats) + APPROACH,
            bar.segment.approach,
            "bass",
        )


def arp(bar: Bar) -> Iterator[Row]:
    profile = bar.segment.arp
    if not profile:
        return
    tones = CHORDS[bar.chords[0]].voicing
    stop = bar.segment.end - bar.segment.hush
    for i, vel in enumerate(profile[: round(bar.beats * 4)]):
        if not vel or bar.first + i * SIXTEENTH >= stop:
            continue
        t = (bar.first + i * SIXTEENTH) * BEAT
        pitch = tones[(i + bar.index) % len(tones)] + 12
        yield Row(t, ARP_LENGTH * BEAT, pitch, vel, "arp")
        if bar.segment.octave:
            yield Row(
                t,
                ARP_LENGTH * BEAT,
                pitch + 12,
                vel * bar.segment.octave,
                "arp",
            )


def stab(bar: Bar) -> Iterator[Row]:
    level = bar.segment.stab
    if not level:
        return
    for name in bar.chords:
        for pitch in CHORDS[name].brass:
            yield Row(
                bar.first * BEAT, STAB_LENGTH * BEAT, pitch, level, "brass"
            )


def swell(bar: Bar) -> Iterator[Row]:
    level = bar.segment.swell
    if not level:
        return
    window = min(bar.segment.pad_window, bar.beats)
    for pitch in CHORDS[bar.chords[0]].brass:
        yield Row(
            (bar.first + bar.beats - window) * BEAT,
            window * BEAT,
            pitch,
            level,
            "brass_swell",
        )


LAYERS: tuple[Callable[[Bar], Iterator[Row]], ...] = (
    pad,
    bass,
    arp,
    stab,
    swell,
)


def calls() -> Iterator[Row]:
    for call in CALLS:
        yield from melody(
            call, SEGMENT_OF[call.segment].start + 4 * call.bar + call.at
        )


def melody(call: Call, first: float) -> Iterator[Row]:
    beat = first
    for name, length in call.phrase:
        yield Row(
            beat * BEAT,
            length * BEAT * ARTICULATION,
            midi(name) + call.shift,
            call.vel,
            call.voice,
        )
        beat += length


def percussion() -> Iterator[Row]:
    for beat, segment in enumerate(BEAT_SEGMENT):
        if beat < segment.start:
            continue
        hushed = beat >= segment.end - segment.hush
        for lane in segment.drums:
            if hushed and lane.voice in HUSHED:
                continue
            pattern = lane.bars[(beat // BAR) % len(lane.bars)]
            offset = round((beat % BAR) / SIXTEENTH)
            for k, char in enumerate(pattern[offset : offset + STEPS_PER_BEAT]):
                if char != ".":
                    yield Row(
                        (beat + k * SIXTEENTH) * BEAT,
                        0.0,
                        0,
                        lane.vel * lane.accents.get(char, 1.0),
                        lane.voice,
                    )


def one_shots() -> Iterator[Row]:
    for shot in ONESHOTS:
        yield Row(shot.beat * BEAT, shot.dur, 0, shot.vel, shot.voice)


def next_root(beat: int) -> int:
    return next((root for start, root in ROOTS if start >= beat), ROOTS[-1][1])
