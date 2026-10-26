import {
  Scene,
  type Frame,
  type PostOverrides,
  type SceneClass,
} from "../engine/scene";
import { rgba } from "../engine/palette";
import { F, font } from "../engine/type";
import { clamp } from "../engine/util";
import {
  CADENCE,
  GREP_LH,
  GREP_Y,
  MODE_Y,
  TERMINAL_POST,
  X0,
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
  prompt,
  rise,
  schedule,
  schedEnd,
  tildes,
  typedAt,
  withPen,
} from "./_mono";

export interface Row {
  label: string;
  text: string;
  more?: string[];
}

export interface RowsSpec {
  path: string;
  page: string;
  claim: string[];
  rows: Row[];
  size?: number;
  labelW?: number;
  grep: string;
  hits: string[];
  answer: string;
  unit?: string;
}

const ROW_STAGGER = 0.35;

interface Plan {
  grep: number;
  hits: number;
  count: number;
  reply: number;
  pace: number;
}

function plan(s: RowsSpec, dur: number): Plan {
  const claimEnd =
    0.25 + schedEnd(schedule(s.claim.join("\n"), CADENCE.prose)) + 0.2;
  let end = claimEnd;
  s.rows.forEach((r, i) => {
    const lines = [r.text, ...(r.more ?? [])];
    const e =
      claimEnd +
      0.2 +
      i * ROW_STAGGER +
      schedEnd(schedule(lines.join("\n"), CADENCE.code));
    end = Math.max(end, e);
  });
  const grep = end + 0.35;
  const hits = grep + 0.3;
  const count = hits + Math.min(s.hits.length, 5) * 0.14 + 0.25;
  const reply = count + 0.4;
  const pace = clamp((dur - 0.35) / reply, 0.45, 1);
  return { grep, hits, count, reply, pace };
}

export function drawRows(
  c: CanvasRenderingContext2D,
  rows: Row[],
  spec: { size?: number; labelW?: number; top?: number },
  lt: number,
  t0: number,
  t: number,
): number {
  const size = spec.size ?? 17;
  const lh = Math.round(size * 1.6);
  const labelW = spec.labelW ?? 130;
  const gap = 18;
  let y = spec.top ?? 380;
  withPen(c, { align: "left", baseline: "alphabetic" }, () => {
    rows.forEach((r, idx) => {
      const lines = [r.text, ...(r.more ?? [])];
      const start = t0 + idx * ROW_STAGGER;
      const sch = schedule(lines.join("\n"), CADENCE.code);
      const done = typedAt(sch, lt, start);
      if (done <= 0) {
        y += lines.length * lh + gap;
        return;
      }
      let acc = 0;
      c.font = font(F.main(), 13);
      c.fillStyle = rgba("grey", 0.5);
      c.fillText(r.label, X0, y + 12);
      c.font = font(F.main(), size);
      lines.forEach((line, i) => {
        const k = clamp(done - acc, 0, line.length);
        acc += line.length + 1;
        if (k > 0) {
          c.fillStyle = rgba("paper", 0.9);
          codeText(c, line.slice(0, k), X0 + labelW, y + i * lh);
        }
        if (k < line.length) {
          caret(
            c,
            X0 + labelW + expandTabs(line.slice(0, k)).length * advance(c) + 2,
            y + i * lh,
            size,
            t,
          );
        }
      });
      y += lines.length * lh + gap;
    });
  });
  return y;
}

export function drawRowPage(
  c: CanvasRenderingContext2D,
  s: RowsSpec,
  ltRaw: number,
  t: number,
  dur: number,
): void {
  const b = plan(s, dur);
  const lt = ltRaw / b.pace;
  const win2 = s.hits.length > 0 && lt >= b.hits;
  modeLine(
    c,
    win2 ? "*grep*" : s.path,
    s.page,
    lt,
    0.05,
    win2 ? 2 : 1,
    win2 ? "Grep" : undefined,
  );
  prompt(c, `Find file: ${s.path}`, lt, 0.02);
  const claimEnd = claim(c, s.claim, lt);
  const top = codeTop(s.claim.length) - 20;
  const bottom = drawRows(
    c,
    s.rows,
    { size: s.size, labelW: s.labelW, top },
    lt,
    claimEnd + 0.2,
    t,
  );
  tildes(c, bottom + 8, MODE_Y - 12, rise(lt, claimEnd + 1.5, 0.4));

  divider(c, GREP_Y - 14);
  command(c, s.grep, lt, b.grep);
  s.hits.slice(0, 5).forEach((line, i) => {
    const start = b.hits + i * 0.14;
    if (lt < start) {
      return;
    }
    const j = line.indexOf(":", line.indexOf(":") + 1);
    const tail = j === -1 ? line : line.slice(j + 1);
    const typed = typedAt(schedule(tail, CADENCE.code), lt, start);
    hit(c, line, GREP_Y + i * GREP_LH, typed);
  });
  answer(c, s.answer, s.unit, lt, b.count);
  echo(c, `Grep finished with ${s.answer} matches.`, lt, b.reply);
}

export function rowPage(s: RowsSpec): SceneClass {
  return class extends Scene {
    layer = this.ctx.make.layer();
    override render(f: Frame): PostOverrides {
      this.layer.clear();
      f.clear();
      drawRowPage(this.layer.ctx, s, f.lt, f.t, f.end - f.start);
      f.over(this.layer);
      return TERMINAL_POST;
    }
  };
}
