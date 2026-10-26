function readScale(): number {
  if (typeof location === "undefined") {
    return 1;
  }
  const s = Math.round(
    Number(new URLSearchParams(location.search).get("scale") ?? "1"),
  );
  return Number.isFinite(s) && s >= 1 ? Math.min(s, 4) : 1;
}

export const SCALE = readScale();
