const DEFS: { family: string; file: string }[] = [
  { family: "Unifont", file: "unifont-18.0.01.otf" },
];

export const F = {
  main(): string {
    return "Unifont";
  },
};

export const font = (family: string, sizePx: number): string =>
  `${sizePx}px "${family}"`;

export async function loadFonts(): Promise<void> {
  await Promise.all(
    DEFS.map(async (d) => {
      const res = await fetch(`fonts/${d.file}`);
      const ff = new FontFace(d.family, await res.arrayBuffer());
      await ff.load();
      document.fonts.add(ff);
    }),
  );
  await document.fonts.ready;
}
