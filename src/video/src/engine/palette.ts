import { hexRgb, hexToLinear } from "./util";

export const HEX = {
  ink: "#000000",
  graphite: "#2E2E2E",
  grey: "#808080",
  ash: "#B4B4B4",
  paper: "#FFFFFF",
} as const;

export type PaletteKey = keyof typeof HEX;

export const LIN: Record<PaletteKey, [number, number, number]> =
  Object.fromEntries(
    Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
  ) as Record<PaletteKey, [number, number, number]>;

export function rgba(key: PaletteKey | string, a = 1): string {
  const [r, g, b] = hexRgb((HEX as Record<string, string>)[key] ?? key);
  return `rgba(${r},${g},${b},${a})`;
}
