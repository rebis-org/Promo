import {
  Scene,
  type Frame,
  type PostOverrides,
  type SceneClass,
} from "../engine/scene";
import { rgba } from "../engine/palette";
import { clamp, prog } from "../engine/util";
import {
  CADENCE,
  GREP_LH,
  GREP_Y,
  MODE_Y,
  TERMINAL_POST,
  X0,
  X1,
  advance,
  answer,
  caret,
  claim,
  codeText,
  codeTop,
  command,
  divider,
  echo,
  expandTabs,
  hit,
  modeLine,
  offsets,
  prompt,
  rise,
  schedule,
  schedEnd,
  shown,
  tildes,
  typedAt,
  withPen,
} from "./_mono";

export interface Proof {
  path: string;
  hot?: number;
  page: string;
  lines: string[];
  claim: string[];
  grep: string;
  hits: string[];
  answer: string;
  unit?: string;
  size?: number;
  sign?: string;
}

const T0 = 0.25;
const SHOWN_HITS = 5;
const HIT_STAGGER = 0.14;

interface Plan {
  claim: number;
  code: number;
  grep: number;
  hits: number;
  count: number;
  reply: number;
  pace: number;
}

function plan(p: Proof, dur: number): Plan {
  const claimEnd =
    T0 + schedEnd(schedule(p.claim.join("\n"), CADENCE.prose)) + 0.15;
  const codeEnd =
    claimEnd + 0.1 + schedEnd(schedule(p.lines.join("\n"), CADENCE.code)) + 0.1;
  const grep = codeEnd + 0.22;
  const hits = grep + 0.3;
  const n = Math.min(p.hits.length, SHOWN_HITS);
  const count = hits + Math.max(1, n) * HIT_STAGGER + 0.25;
  const reply = count + 0.4;
  const pace = clamp((dur - 0.35) / reply, 0.45, 1);
  return { claim: claimEnd, code: codeEnd, grep, hits, count, reply, pace };
}

export function drawProof(
  c: CanvasRenderingContext2D,
  p: Proof,
  ltRaw: number,
  t: number,
  dur: number,
): void {
  const b = plan(p, dur);
  const lt = ltRaw / b.pace;
  const win2 = p.hits.length > 0 && lt >= b.hits;
  modeLine(
    c,
    win2 ? "*grep*" : p.path,
    p.page,
    lt,
    0.05,
    win2 ? 2 : 1,
    win2 ? "Grep" : undefined,
  );
  prompt(c, `Find file: ${p.path}`, lt, 0.02);
  claim(c, p.claim, lt, T0);

  const top = codeTop(p.claim.length);
  const room = MODE_Y - 36 - top;
  const n = Math.max(1, p.lines.length);
  const byHeight = room / ((n - 1) * 1.34 + 1);
  const longest = Math.max(1, ...p.lines.map((l) => l.length));
  const byWidth = (X1 - X0) / (longest * 0.6);
  const size = Math.max(12, Math.min(p.size ?? 34, byHeight, byWidth));
  const lh = Math.round(size * 1.34);

  const codeSch = schedule(p.lines.join("\n"), CADENCE.code);
  const done = typedAt(codeSch, lt, b.claim + 0.1);
  const off = offsets(p.lines);
  let cy = -1;
  let cx = -1;
  withPen(c, { size, align: "left", baseline: "alphabetic" }, () => {
    p.lines.forEach((line, i) => {
      const k = clamp(done - off[i]!, 0, line.length);
      if (k === 0) {
        return;
      }
      const y = top + i * lh;
      c.fillStyle = rgba("paper", i === p.hot ? 1 : 0.86);
      codeText(c, line.slice(0, k), X0, y);
      if (k < line.length) {
        cy = y;
        cx = X0 + expandTabs(line.slice(0, k)).length * advance(c) + 3;
      }
    });
  });
  if (cy >= 0) {
    caret(c, cx, cy, size, t);
  }
  tildes(
    c,
    top + p.lines.length * lh + 12,
    MODE_Y - 12,
    rise(lt, b.code, 0.35),
  );

  divider(c, GREP_Y - 14);
  command(c, p.grep, lt, b.grep);
  if (p.hits.length === 0) {
    const k = rise(lt, b.hits, 0.3);
    if (k > 0) {
      withPen(
        c,
        { size: 16, fill: rgba("grey", 0.7), align: "left", alpha: k },
        () =>
          codeText(
            c,
            shown("Grep finished with no matches found.", k),
            X0,
            GREP_Y,
          ),
      );
    }
  }
  p.hits.slice(0, SHOWN_HITS).forEach((line, i) => {
    const start = b.hits + i * HIT_STAGGER;
    if (lt < start) {
      return;
    }
    const j = line.indexOf(":", line.indexOf(":") + 1);
    const tail = j === -1 ? line : line.slice(j + 1);
    const typed = typedAt(schedule(tail, CADENCE.code), lt, start);
    hit(c, line, GREP_Y + i * GREP_LH, typed);
  });
  const rest = p.hits.length - SHOWN_HITS;
  if (rest > 0) {
    const k = clamp(
      prog(
        lt,
        b.hits + SHOWN_HITS * HIT_STAGGER,
        b.hits + SHOWN_HITS * HIT_STAGGER + 0.2,
      ),
    );
    if (k > 0) {
      withPen(
        c,
        { size: 16, fill: rgba("grey", 0.5), align: "left", alpha: k },
        () => c.fillText(`... ${rest} more`, X0, GREP_Y + SHOWN_HITS * GREP_LH),
      );
    }
  }
  answer(c, p.answer, p.unit, lt, b.count);
  echo(
    c,
    p.sign ??
      (p.hits.length === 0
        ? "Grep finished."
        : `Grep finished with ${p.answer} ${p.answer === "1" ? "match" : "matches"}.`),
    lt,
    b.reply,
    p.sign !== undefined,
  );
}

export function proof(p: Proof): SceneClass {
  return class extends Scene {
    layer = this.ctx.make.layer();
    override render(f: Frame): PostOverrides {
      this.layer.clear();
      f.clear();
      drawProof(this.layer.ctx, p, f.lt, f.t, f.end - f.start);
      f.over(this.layer);
      return TERMINAL_POST;
    }
  };
}
