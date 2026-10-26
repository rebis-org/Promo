export const clamp = (x: number, a = 0, b = 1): number =>
  Math.min(b, Math.max(a, x));

export const ease = {
  linear: (t: number): number => t,
  outCubic: (t: number): number => 1 - (1 - t) ** 3,
  inOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  outExpo: (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
};

export const prog = (
  x: number,
  a: number,
  b: number,
  fn: (t: number) => number = ease.linear,
): number => fn(clamp((x - a) / (b - a)));

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b_79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const frameIdx = (t: number): number => Math.round((t * 60_000) / 1001);

export function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToLinear(hex: string): [number, number, number] {
  const c = hexRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return c as [number, number, number];
}
