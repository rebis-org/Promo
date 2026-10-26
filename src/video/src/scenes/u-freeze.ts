import { Scene, type Frame, type PostOverrides } from "../engine/scene";
import { rgba } from "../engine/palette";
import { clamp } from "../engine/util";
import {
  CLAIM_LH,
  CLAIM_Y,
  CADENCE,
  GREP_Y,
  TERMINAL_POST,
  X0,
  answer,
  claim,
  codeText,
  divider,
  echo,
  hit,
  modeLine,
  prompt,
  schedule,
  schedEnd,
  typedAt,
  withPen,
} from "./_mono";

const CLAIM = [
  `id(c) = (0x6e6b_82f0_8d91_0400 | ord(c), 0xa7a3_5105_3d6d_4000 | ord(c))`,
  `name(c) drifts -> id(c) != frozen(c) -> build fails`,
];

const ACT1 = [
  `    for (frozen) |entry| {`,
  `        const component = discovery.findByName(entry.name) orelse continue;`,
  `        const low = @as(u64, 0x6e6b_82f0_8d91_0400) | entry.ordinal;`,
  `        const high = @as(u64, 0xa7a3_5105_3d6d_4000) | entry.ordinal;`,
];

const ERR_LINE = `src/kernel/catalog.zig:14: error: released component id drifted: lzma-file.`;
const ERR_ECHO = "Compilation exited abnormally with code 1.";

const SPEC_PATH = "*frozen-spec*";
const HEADER = "FROZEN SPEC - DWG R128-O16 - REV 6 - SCALE 1:1";
const HIGH_L = "HIGH  0xa7a3_5105_3d6d_4000 | ordinal";
const LOW_L = "LOW   0x6e6b_82f0_8d91_0400 | ordinal";
const ORD_MARK = `${" ".repeat(60)}^^^^ ordinal`;

const bits = (hex: string): string =>
  hex
    .replaceAll(/0x|_/gu, "")
    .split("")
    .map((d) => Number.parseInt(d, 16).toString(2).padStart(4, "0"))
    .join("");
const ruler = (hex: string): string =>
  bits(hex)
    .split("")
    .map((b) => (b === "1" ? "\u2588" : "\u2591"))
    .join("");
const RULER_H = ruler("0xa7a3_5105_3d6d_4000");
const RULER_L = ruler("0x6e6b_82f0_8d91_0400");

const SLOTS: [string, string][][] = [
  [
    ["0x03", "deflate"],
    ["0x04", "gzip"],
    ["0x09", "bzip2"],
  ],
  [
    ["0x0a", "lzma"],
    ["0x0b", "lzma-file"],
    ["\u2026", "16 frozen"],
  ],
];

const SIGN = "github.com/rebis-org/libstd";

const errTail = (line: string): string => {
  const j = line.indexOf(":", line.indexOf(":") + 1);
  return line.slice(j + 1);
};

interface Plan {
  claim: number;
  code: number;
  compile: number;
  err: number;
  errEcho: number;
  spec: number;
  hdr: number;
  hi: number;
  tick1: number;
  lo: number;
  tick2: number;
  mark: number;
  slots: number;
  ans: number;
  sign: number;
  pace: number;
}

const end = (text: string, base = CADENCE.code): number =>
  schedEnd(schedule(text, base));

function plan(dur: number): Plan {
  const claimEnd = 0.25 + end(CLAIM.join("\n"), CADENCE.code) + 0.15;
  const codeEnd = claimEnd + 0.1 + end(ACT1.join("\n")) + 0.15;
  const compile = codeEnd + 0.15;
  const err = compile + end("M-x compile RET") + 0.2;
  const errEcho = err + end(errTail(ERR_LINE)) + 0.2;
  const spec = errEcho + 0.5;
  const hdr = spec + 0.2;
  const hi = hdr + end(HEADER, CADENCE.prose) + 0.2;
  const tick1 = hi + end(HIGH_L) + 0.15;
  const lo = tick1 + end(RULER_H) + 0.3;
  const tick2 = lo + end(LOW_L) + 0.15;
  const mark = tick2 + end(RULER_L) + 0.15;
  const slots = mark + 0.2;
  const ans = slots + 2 * 0.15 + 3 * 0.15 + 0.35;
  const sign = ans + 0.6;
  const total = sign + 0.5;
  const pace = clamp((dur - 0.35) / total, 0.45, 1);
  return {
    claim: claimEnd,
    code: codeEnd,
    compile,
    err,
    errEcho,
    spec,
    hdr,
    hi,
    tick1,
    lo,
    tick2,
    mark,
    slots,
    ans,
    sign,
    pace,
  };
}

function typeLine(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  lt: number,
  start: number,
  size: number,
  fill: string,
): void {
  const done = typedAt(schedule(text, CADENCE.code), lt, start);
  if (done <= 0) {
    return;
  }
  withPen(c, { size, fill, align: "left", baseline: "alphabetic" }, () => {
    codeText(c, text.slice(0, done), x, y);
  });
}

function drawFreeze(
  c: CanvasRenderingContext2D,
  ltRaw: number,
  t: number,
  dur: number,
): void {
  const b = plan(dur);
  const lt = ltRaw / b.pace;
  const act2 = lt >= b.spec;
  modeLine(
    c,
    act2 ? SPEC_PATH : "src/kernel/catalog.zig",
    "6 / 6",
    lt,
    0.05,
    1,
    act2 ? "Spec" : undefined,
  );
  prompt(c, "Find file: src/kernel/catalog.zig", lt, 0.02);
  claim(c, CLAIM, lt, 0.25, CADENCE.code);

  const top = CLAIM_Y + CLAIM.length * CLAIM_LH + 46;
  const lh = 40;
  if (!act2) {
    const done = typedAt(
      schedule(ACT1.join("\n"), CADENCE.code),
      lt,
      b.claim + 0.1,
    );
    let acc = 0;
    withPen(c, { size: 24, align: "left", baseline: "alphabetic" }, () => {
      ACT1.forEach((line, i) => {
        const k = clamp(done - acc, 0, line.length);
        acc += line.length + 1;
        if (k > 0) {
          c.fillStyle = rgba("paper", i === 2 ? 1 : 0.86);
          codeText(c, line.slice(0, k), X0, top + i * lh);
        }
      });
    });
    typeLine(
      c,
      "M-x compile RET",
      X0,
      GREP_Y - 42,
      lt,
      b.compile,
      16,
      rgba("grey", 0.75),
    );
    divider(c, GREP_Y - 14);
    if (lt >= b.err) {
      const typed = typedAt(
        schedule(errTail(ERR_LINE), CADENCE.code),
        lt,
        b.err,
      );
      hit(c, ERR_LINE, GREP_Y, typed);
    }
    if (lt >= b.errEcho) {
      echo(c, ERR_ECHO, lt, b.errEcho);
    }
  }

  if (act2) {
    const y0 = top;
    typeLine(c, HEADER, X0, y0, lt, b.hdr, 15, rgba("grey", 0.62));
    typeLine(c, HIGH_L, X0, y0 + 34, lt, b.hi, 16, rgba("paper", 0.9));
    typeLine(c, RULER_H, X0, y0 + 64, lt, b.tick1, 18, rgba("paper", 1));
    typeLine(c, LOW_L, X0, y0 + 108, lt, b.lo, 16, rgba("paper", 0.9));
    typeLine(c, RULER_L, X0, y0 + 138, lt, b.tick2, 18, rgba("paper", 1));
    typeLine(c, ORD_MARK, X0, y0 + 164, lt, b.mark, 13, rgba("grey", 0.55));
    withPen(c, { size: 13, fill: rgba("grey", 0.5), align: "left" }, () => {
      c.fillText("SLOT   COMPONENT", X0, y0 + 208);
      c.fillText("SLOT   COMPONENT", X0 + 460, y0 + 208);
    });
    SLOTS.forEach((col, ci) => {
      col.forEach(([ord, name], i) => {
        const start = b.slots + ci * 0.15 + i * 0.15;
        typeLine(
          c,
          `${ord}  ${name}`,
          X0 + ci * 460,
          y0 + 236 + i * 26,
          lt,
          start,
          16,
          rgba("paper", 0.86),
        );
      });
    });
  }
  answer(c, "16", "frozen ids", lt, b.ans);
  if (act2) {
    echo(c, SIGN, lt, b.sign, true);
  }
}

export default class Freeze extends Scene {
  layer = this.ctx.make.layer();
  override render(f: Frame): PostOverrides {
    this.layer.clear();
    f.clear();
    drawFreeze(this.layer.ctx, f.lt, f.t, f.end - f.start);
    f.over(this.layer);
    return TERMINAL_POST;
  }
}
