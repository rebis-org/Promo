export interface AudioJSON {
  duration: number;
  bpm: number;
  fps: number;
  beats: number[];
  downbeats: number[];
  sections: { name: string; start: number; end: number }[];
  features: Record<string, number[]>;
  onsets: Record<string, [number, number][]>;
}

export interface AudioSample {
  rms: number;
  low: number;
  mid: number;
  high: number;
  vocal: number;
  drums: number;
  bass: number;
  other: number;

  kick: number;
  snare: number;
  hat: number;
  vonset: number;
}

const FEATURES = [
  "rms",
  "low",
  "mid",
  "high",
  "vocal",
  "drums",
  "bass",
  "other",
] as const;

function gridAt(g: number[], t: number): number {
  if (t <= g[0]!) {
    return (t - g[0]!) / (g[1]! - g[0]!);
  }
  if (t >= g.at(-1)!) {
    return g.length - 1 + (t - g.at(-1)!) / (g.at(-1)! - g.at(-2)!);
  }
  let lo = 0,
    hi = g.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (g[m]! <= t) {
      lo = m;
    } else {
      hi = m;
    }
  }
  return lo + (t - g[lo]!) / (g[hi]! - g[lo]!);
}

export class AudioData {
  duration: number;
  bpm: number;
  beats: number[];
  downbeats: number[];
  sections: { name: string; start: number; end: number }[];
  private fps: number;
  private feat: Record<string, Float32Array> = {};
  onsets: Record<string, [number, number][]>;

  constructor(j: AudioJSON) {
    this.duration = j.duration;
    this.bpm = j.bpm;
    this.beats = j.beats;
    this.downbeats = j.downbeats;
    this.sections = j.sections;
    this.fps = j.fps || 100;
    for (const k of FEATURES) {
      this.feat[k] = Float32Array.from(j.features?.[k] ?? []);
    }
    this.onsets = j.onsets ?? {};
  }

  static async load(): Promise<AudioData> {
    for (const url of ["data/audio.json", "data/audio.approx.json"]) {
      const r = await fetch(url);
      if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) {
        return new AudioData(await r.json());
      }
    }
    throw new Error("no audio analysis data found");
  }

  env(name: string, t: number): number {
    const a = this.feat[name];
    if (!a || a.length === 0) {
      return 0;
    }
    const x = t * this.fps;
    const i = Math.floor(x);
    if (i < 0) {
      return a[0]!;
    }
    if (i >= a.length - 1) {
      return a.at(-1)!;
    }
    const f = x - i;
    return a[i]! * (1 - f) + a[i + 1]! * f;
  }

  envPeak(name: string, t: number, w = 0.08): number {
    let m = 0;
    for (let s = t - w; s <= t; s += 1 / this.fps) {
      m = Math.max(m, this.env(name, s));
    }
    return m;
  }

  hit(kind: string, t: number, halfLife = 0.11): number {
    const list = this.onsets[kind];
    if (!list || list.length === 0) {
      return 0;
    }
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m]![0] <= t) {
        lo = m + 1;
      } else {
        hi = m;
      }
    }
    let v = 0;
    for (let i = lo - 1; i >= 0 && i >= lo - 6; i--) {
      const [ot, s] = list[i]!;
      const dt = t - ot;
      if (dt > halfLife * 8) {
        break;
      }
      v = Math.max(v, s * 0.5 ** (dt / halfLife));
    }
    return v;
  }

  events(kind: string, t0: number, t1: number): [number, number][] {
    return (this.onsets[kind] ?? []).filter(([t]) => t >= t0 && t < t1);
  }

  sample(t: number): AudioSample {
    return {
      rms: this.env("rms", t),
      low: this.env("low", t),
      mid: this.env("mid", t),
      high: this.env("high", t),
      vocal: this.env("vocal", t),
      drums: this.env("drums", t),
      bass: this.env("bass", t),
      other: this.env("other", t),
      kick: this.hit("kick", t, 0.12),
      snare: this.hit("snare", t, 0.14),
      hat: this.hit("hat", t, 0.06),
      vonset: this.hit("vocal", t, 0.15),
    };
  }

  beatAt(t: number): number {
    return this.beats.length < 2 ? t * (this.bpm / 60) : gridAt(this.beats, t);
  }

  timeOfBeat(i: number): number {
    const b = this.beats;
    const n = b.length;
    const period = n > 1 ? (b.at(-1)! - b[0]!) / (n - 1) : 60 / this.bpm;
    if (i <= 0) {
      return (b[0] ?? 0) + i * period;
    }
    if (i >= n - 1) {
      return b.at(-1)! + (i - (n - 1)) * period;
    }
    const k = Math.floor(i);
    return b[k]! + (b[k + 1]! - b[k]!) * (i - k);
  }

  barAt(t: number): number {
    return this.downbeats.length < 2
      ? this.beatAt(t) / 4
      : gridAt(this.downbeats, t);
  }

  nearestBeat(t: number): number {
    return this.timeOfBeat(Math.round(this.beatAt(t)));
  }

  section(t: number): { name: string; start: number; end: number } | undefined {
    return (
      this.sections.find((s) => t >= s.start && t < s.end) ??
      this.sections.at(-1)
    );
  }
}
