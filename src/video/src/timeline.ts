import type { TimelineEntry } from "./engine/engine";
import type { SceneClass } from "./engine/scene";
import type { AudioData } from "./engine/audio";

const modules = import.meta.glob<{ default: SceneClass }>("./scenes/*.ts");
const scene = (name: string) => () => {
  const m = modules[`./scenes/${name}.ts`];
  return m
    ? m()
    : Promise.reject(new Error(`scene module not found: scenes/${name}.ts`));
};

const CUTS = [0, 8, 20, 32, 44, 56];
const VARIANTS: Record<string, string[]> = {
  libstd: ["u-type", "u-layer", "u-value", "u-contract", "u-scope", "u-freeze"],
  transform: [
    "p-fact",
    "p-spell",
    "p-intent",
    "p-commit",
    "p-absent",
    "p-seal",
  ],
};

export const variant = (): string =>
  new URLSearchParams(location.search).get("v") ?? "transform";

export function makeTimeline(au: AudioData): TimelineEntry[] {
  const ids = VARIANTS[variant()] ?? VARIANTS.transform!;
  const cuts = [...CUTS.map((b) => au.timeOfBeat(b)), au.duration];
  return ids.map((id, i) => ({
    id,
    load: scene(id),
    start: cuts[i]!,
    end: cuts[i + 1]!,
  }));
}
