import { W } from "../engine/gl";
import { rgba } from "../engine/palette";
import type { PostOverrides } from "../engine/scene";
import { F, font } from "../engine/type";
import { clamp, ease, frameIdx, prog } from "../engine/util";

export const X0 = 120;
export const X1 = W - 120;
export const CLAIM_Y = 176;
export const CLAIM_LH = 38;
export const TILDE_X = 120;
export const MODE_Y = 664;
export const MODE_H = 30;
export const GREP_Y = 760;
export const GREP_LH = 26;
export const NUM_BASE = 938;
export const ECHO_Y = 1046;

export const TERMINAL_POST: PostOverrides = {
  bloom: 0.26,
  halation: 0.14,
  vignette: 0.5,
  grain: 0.05,
  scan: 1,
  curve: 1,
};

export const codeTop = (claimLines: number): number =>
  CLAIM_Y + claimLines * CLAIM_LH + 46;

export const countChars = (lines: string[]): number =>
  lines.reduce((n, l) => n + l.length + 1, 0);

export const rise = (lt: number, t0: number, d = 0.4): number =>
  ease.outCubic(prog(lt, t0, t0 + d));

export const shown = (text: string, k: number): string =>
  text.slice(0, Math.ceil(text.length * k));

export const CADENCE = { prose: 0.03, code: 0.007 };

const hash = (i: number, salt = 0): number => {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43_758.5453;
  return x - Math.floor(x);
};

export function schedule(text: string, base: number): Float64Array {
  const t = new Float64Array(text.length);
  let acc = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    let d = base * (0.75 + 0.5 * hash(i, base));
    if (ch === "\n" || ch === ";") {
      d += base * 9;
    } else if (ch === " ") {
      d += base * 1.6;
    } else if ("{}()".includes(ch)) {
      d += base * 4;
    }
    acc += d;
    t[i] = acc;
  }
  return t;
}

export const schedEnd = (sch: Float64Array): number =>
  sch.length > 0 ? sch.at(-1)! : 0;

export function typedAt(sch: Float64Array, lt: number, t0: number): number {
  const e = lt - t0;
  let n = 0;
  while (n < sch.length && sch[n]! <= e) {
    n++;
  }
  return n;
}

export const offsets = (lines: string[]): number[] => {
  const o = [0];
  lines.forEach((l, i) => {
    o.push(o[i]! + l.length + 1);
  });
  return o;
};

interface PenStyle {
  size?: number;
  fill?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  alpha?: number;
}

export function withPen<T>(
  c: CanvasRenderingContext2D,
  style: PenStyle,
  draw: () => T,
): T {
  c.save();
  if (style.size !== undefined) {
    c.font = font(F.main(), style.size);
  }
  if (style.fill !== undefined) {
    c.fillStyle = style.fill;
  }
  if (style.align !== undefined) {
    c.textAlign = style.align;
  }
  if (style.baseline !== undefined) {
    c.textBaseline = style.baseline;
  }
  if (style.alpha !== undefined) {
    c.globalAlpha = style.alpha;
  }
  try {
    return draw();
  } finally {
    c.restore();
  }
}

export function expandTabs(text: string): string {
  let out = "";
  let col = 0;
  for (const ch of text) {
    if (ch === "\t") {
      const n = 8 - (col % 8);
      out += " ".repeat(n);
      col += n;
    } else {
      out += ch;
      col += 1;
    }
  }
  return out;
}

export function codeText(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  jitter = true,
): void {
  const adv = c.measureText("0").width;
  const line = expandTabs(text);
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === " ") {
      continue;
    }
    if (jitter) {
      const dx = (hash(i) - 0.5) * 0.7;
      const dy = (hash(i + 91.7) - 0.5) * 0.45;
      c.globalAlpha = 0.9 + 0.1 * hash(i + 7.3);
      c.fillText(ch, x + i * adv + dx, y + dy);
    } else {
      c.fillText(ch, x + i * adv, y);
    }
  }
  c.globalAlpha = 1;
}

export const advance = (c: CanvasRenderingContext2D): number =>
  c.measureText("0").width;

export function claim(
  c: CanvasRenderingContext2D,
  lines: string[],
  lt: number,
  t0 = 0.25,
  cadence = CADENCE.prose,
): number {
  if (lines.length === 0) {
    return t0;
  }
  const text = lines.join("\n");
  const sch = schedule(text, cadence);
  const done = typedAt(sch, lt, t0);
  const off = offsets(lines);
  withPen(
    c,
    {
      size: 17,
      fill: rgba("grey", 0.55),
      align: "left",
      baseline: "alphabetic",
    },
    () => c.fillText("// pseudocode", X0, 132),
  );
  withPen(
    c,
    { size: 26, fill: rgba("grey", 1), align: "left", baseline: "alphabetic" },
    () => {
      lines.forEach((line, i) => {
        const k = clamp(done - off[i]!, 0, line.length);
        if (k > 0) {
          codeText(c, line.slice(0, k), X0, CLAIM_Y + i * CLAIM_LH);
        }
      });
    },
  );
  return t0 + schedEnd(sch) + 0.15;
}

export function tildes(
  c: CanvasRenderingContext2D,
  top: number,
  bottom: number,
  k: number,
): void {
  if (k <= 0) {
    return;
  }
  withPen(
    c,
    {
      size: 20,
      fill: rgba("grey", 0.92 * k),
      align: "left",
      baseline: "alphabetic",
    },
    () => {
      for (let y = top; y < bottom; y += 30) {
        c.fillText("~", TILDE_X, y);
      }
    },
  );
}

const MODES: Record<string, string> = {
  zig: "Zig",
  pkl: "Pkl",
  c: "C",
  go: "Go",
  zon: "Zon",
  cs: "C#",
  swift: "Swift",
  kt: "Kotlin",
  cj: "Cangjie",
  ed: "Ed",
  grep: "Grep",
};

export function modeLine(
  c: CanvasRenderingContext2D,
  path: string,
  folio: string,
  lt: number,
  t0: number,
  win = 1,
  lang?: string,
): void {
  const k = rise(lt, t0);
  if (k <= 0) {
    return;
  }
  const ext = path.split(".").pop() ?? "";
  const name = lang ?? MODES[ext] ?? "Fundamental";
  c.save();
  c.globalAlpha = k;
  c.fillStyle = rgba("paper", 1);
  c.fillRect(0, MODE_Y, W, MODE_H);
  c.restore();
  withPen(
    c,
    { size: 19, fill: rgba("ink", 1), baseline: "middle", alpha: k },
    () => {
      c.textAlign = "left";
      c.fillText(
        ` U1:**-F${win}  ${path}   (${name})`,
        X0,
        MODE_Y + MODE_H / 2 + 1,
      );
      c.textAlign = "right";
      c.fillText(`${folio}----`, X1, MODE_Y + MODE_H / 2 + 1);
    },
  );
}

export function divider(c: CanvasRenderingContext2D, y: number): void {
  withPen(c, { size: 16, fill: rgba("graphite", 1), align: "left" }, () => {
    const n = Math.floor((X1 - X0) / advance(c));
    c.fillText("-".repeat(Math.max(0, n)), X0, y);
  });
}

export function prompt(
  c: CanvasRenderingContext2D,
  text: string,
  lt: number,
  t0: number,
): void {
  const k = clamp(prog(lt, t0, t0 + 0.1) - prog(lt, t0 + 1.1, t0 + 1.4));
  if (k <= 0) {
    return;
  }
  withPen(
    c,
    {
      size: 18,
      fill: rgba("grey", 0.75),
      align: "left",
      baseline: "alphabetic",
      alpha: k,
    },
    () => codeText(c, text, X0, ECHO_Y),
  );
}

export function echo(
  c: CanvasRenderingContext2D,
  text: string,
  lt: number,
  t0: number,
  white = false,
): void {
  const k = rise(lt, t0);
  if (k <= 0) {
    return;
  }
  const sch = schedule(text, CADENCE.prose);
  const typed = typedAt(sch, lt, t0);
  withPen(
    c,
    {
      size: white ? 26 : 18,
      fill: white ? rgba("paper", 0.94) : rgba("grey", 0.8),
      align: "left",
      baseline: "alphabetic",
      alpha: k,
    },
    () => codeText(c, text.slice(0, typed), X0, ECHO_Y),
  );
}

export function hit(
  c: CanvasRenderingContext2D,
  line: string,
  y: number,
  typed: number,
): void {
  const i = line.indexOf(":");
  const j = line.indexOf(":", i + 1);
  let head = i === -1 ? "" : line.slice(0, i + 1);
  let tail = j === -1 ? line.slice(i + 1) : line.slice(j + 1);
  withPen(c, { size: 16, align: "left", baseline: "alphabetic" }, () => {
    const adv = advance(c);
    const avail = X1 - X0 - 210;
    const room = Math.floor(avail / adv);
    if (head.length + tail.length > room) {
      const keep = Math.max(0, room - tail.length);
      head = keep > 6 ? `...${head.slice(head.length - keep + 3)}` : "";
      if (head.length + tail.length > room) {
        tail = `${tail.slice(0, Math.max(1, room - head.length - 1))}$`;
      }
    }
    c.fillStyle = rgba("grey", 0.62);
    codeText(c, head, X0, y);
    const hw = head.length * adv;
    c.fillStyle = rgba("paper", 0.92);
    codeText(c, tail.slice(0, typed), X0 + hw, y);
  });
}

export function command(
  c: CanvasRenderingContext2D,
  pattern: string,
  lt: number,
  t0: number,
): void {
  const text = `M-x grep RET ${pattern} RET`;
  const k = rise(lt, t0, 0.35);
  if (k <= 0) {
    return;
  }
  const sch = schedule(text, CADENCE.code);
  const typed = typedAt(sch, lt, t0);
  withPen(
    c,
    {
      size: 16,
      fill: rgba("grey", 0.75),
      align: "left",
      baseline: "alphabetic",
      alpha: k,
    },
    () => codeText(c, text.slice(0, typed), X0, GREP_Y - 42),
  );
}

export function answer(
  c: CanvasRenderingContext2D,
  value: string,
  unit: string | undefined,
  lt: number,
  t0: number,
): void {
  const k = rise(lt, t0, 0.55);
  if (k <= 0) {
    return;
  }
  const num = Number(value);
  const shownValue = Number.isFinite(num)
    ? String(Math.round(num * k))
    : shown(value, k);
  const size = Math.min(88, 88 / Math.max(1, shownValue.length / 1.6));
  withPen(c, { size, fill: rgba("paper", 1), align: "right" }, () => {
    c.fillText(shownValue, X1, NUM_BASE);
    if (unit) {
      c.font = font(F.main(), 18);
      c.fillStyle = rgba("grey", 0.7);
      c.fillText(unit, X1, NUM_BASE + 30);
    }
  });
}

export function caret(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  t: number,
): void {
  if (frameIdx(t) % 22 >= 14) {
    return;
  }
  c.fillStyle = rgba("paper", 0.88);
  c.fillRect(x, y - size * 0.76, size * 0.46, size * 0.94);
}
