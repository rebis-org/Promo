import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Page, chromium } from "playwright-core";
import { type WebSocket, WebSocketServer } from "ws";

const argv = process.argv.slice(2);
const mode = argv[0] ?? "stills";
const opt = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i === -1 ? d : argv[i + 1];
};
const flag = (k: string) => argv.includes(`--${k}`);
const APP = path.resolve(import.meta.dirname, "..");
const SCALE = Math.max(1, Math.round(Number(opt("scale", "1")!)));
const OW = 1920 * SCALE;
const OH = 1080 * SCALE;
const VARIANT = opt("variant", "transform")!;
const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });
const FPS_R = opt("fps", "60000/1001")!;
const [FPS_N, FPS_D] = FPS_R.split("/");
const FPS = Number(FPS_N) / Number(FPS_D ?? 1);
const SAMPLES =
  opt("samples", "1") === "auto"
    ? {
        min: Number(opt("min-samples", "4")!),
        max: Number(opt("max-samples", "324")!),
        tol: Number(opt("tol", "3")!),
        refine: opt("refine", "tiles") as "tiles" | "frame",
      }
    : Number(opt("samples", "1")!);
const hist = (h: Record<string, number>) =>
  Object.entries(h)
    .toSorted((a, b) => Number(a[0]) - Number(b[0]))
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
const ROOT = path.resolve(APP, "..", "..");
const VITE_BIN = path.join(APP, "node_modules", "vite", "bin", "vite.js");
const SYSTEM_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME =
  opt("chrome") ??
  process.env.CHROME_PATH ??
  (existsSync(SYSTEM_CHROME) ? SYSTEM_CHROME : undefined);

async function reachable(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<{ url: string; stop: () => void }> {
  const url = opt("url", "http://localhost:5173")!;
  if (await reachable(url)) {
    return { url, stop: () => void 0 };
  }
  if (!existsSync(VITE_BIN)) {
    throw new Error(
      `vite not found at ${VITE_BIN} — run "vp install" in video/ first`,
    );
  }
  const port = 5300 + Math.floor(Math.random() * 500);
  const proc = spawn(
    process.execPath,
    [VITE_BIN, "--port", String(port), "--strictPort"],
    { cwd: APP, stdio: "ignore", env: { ...process.env, PDOOM_NO_HMR: "1" } },
  );
  const u = `http://localhost:${port}`;
  for (let i = 0; i < 100 && !(await reachable(u)); i++) {
    await sleep(100);
  }
  return { url: u, stop: () => proc.kill("SIGTERM") };
}

async function openPage(url: string) {
  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : { channel: "chrome" }),
    headless: !flag("headed"),
    args: [
      "--use-angle=metal",
      "--enable-gpu-rasterization",
      "--ignore-gpu-blocklist",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
  const proc = (browser as any).process?.() as ChildProcess | undefined;
  if (proc) {
    proc.on("exit", (code, signal) =>
      console.error(
        `[browser-exit] pid=${proc.pid} code=${code} signal=${signal}`,
      ),
    );
  }
  browser.on("disconnected", () => console.log("[render] browser closed"));
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const logs: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      logs.push(`[${m.type()}] ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  const only = opt("only");
  await page.goto(
    `${url}/?export=1&v=${VARIANT}${only ? `&only=${only}` : ""}${SCALE === 1 ? "" : `&scale=${SCALE}`}`,
  );
  await page.waitForFunction(
    () => (window as any).__promo?.ready || (window as any).__promo?.error,
    null,
    { timeout: 120_000 },
  );
  const err = await page.evaluate(() => (window as any).__promo.error);
  if (err) {
    throw new Error(`app failed to boot:\n${err}\n${logs.join("\n")}`);
  }
  const size: [number, number] = await page.evaluate(() => [
    (window as any).__promo.width ?? 1920,
    (window as any).__promo.height ?? 1080,
  ]);
  if (size[0] !== OW || size[1] !== OH) {
    throw new Error(
      `app renders ${size[0]}x${size[1]}, expected ${OW}x${OH} (--scale ${SCALE})`,
    );
  }
  const sceneErrors: string[] = await page.evaluate(
    () => (window as any).__promo.errors,
  );
  if (sceneErrors.length > 0) {
    console.error(`SCENE ERRORS:\n${sceneErrors.join("\n")}`);
  }
  return { browser, page, logs };
}

async function stills(page: Page, times: number[], outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const t of times) {
    const k: number = await page.evaluate(
      ([t, s, sh]) => (window as any).__promo.still(t, s, sh),
      [t, SAMPLES, Number(opt("shutter", "0.5")!)] as const,
    );
    const f = path.join(outDir, `f_${t.toFixed(2).padStart(7, "0")}.png`);
    if (typeof SAMPLES !== "number") {
      console.log(`t=${t}: ${k} sub-frames`);
    }
    const written =
      SCALE === 1
        ? page.screenshot({
            path: f,
            clip: { x: 0, y: 0, width: 1920, height: 1080 },
          })
        : writeFile(
            f,
            Buffer.from(
              await page.evaluate(() => (window as any).__promo.png()),
              "base64",
            ),
          );
    await written;
    files.push(f);
  }
  return files;
}

async function sheet(page: Page, times: number[], cols: number, out: string) {
  const dataUrl: string = await page.evaluate(
    ({ times, cols }) => {
      const P = (window as any).__promo;
      const ch = 270;
      const cw = 480;
      const lab = 18;
      const pad = 4;
      const rows = Math.ceil(times.length / cols);
      const cv = document.createElement("canvas");
      cv.width = cols * (cw + pad) + pad;
      cv.height = rows * (ch + lab + pad) + pad;
      const c = cv.getContext("2d")!;
      c.fillStyle = "#222";
      c.fillRect(0, 0, cv.width, cv.height);
      const src = document.querySelector("#c") as HTMLCanvasElement;
      times.forEach((t: number, i: number) => {
        P.still(t);
        const x = pad + (i % cols) * (cw + pad);
        const y = pad + Math.floor(i / cols) * (ch + lab + pad);
        c.drawImage(src, x, y + lab, cw, ch);
        c.fillStyle = "#ddd";
        c.font = "13px monospace";
        c.fillText(`${t.toFixed(2)}s`, x + 2, y + 13);
      });
      return cv.toDataURL("image/png");
    },
    { times, cols },
  );
  mkdirSync(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(dataUrl.split(",")[1]!, "base64"));
}

function writeAll(stdin: NonNullable<ChildProcess["stdin"]>, buf: Uint8Array) {
  return new Promise<void>((res, rej) => {
    const onErr = (e: Error) => {
      cleanup();
      rej(e);
    };
    const cleanup = () => {
      stdin.off("error", onErr);
    };
    stdin.once("error", onErr);
    if (stdin.write(buf)) {
      cleanup();
      res();
    } else {
      stdin.once("drain", () => {
        cleanup();
        res();
      });
    }
  });
}
const exitCode = (p: ChildProcess) =>
  new Promise<number>((res) => {
    p.on("exit", (code) => res(code ?? -1));
  });

async function video(url: string, from: number, to: number, out: string) {
  mkdirSync(path.dirname(out), { recursive: true });
  const crf = opt("crf", "26")!;
  const audio = path.join(APP, "audio", `${VARIANT}.opus`);
  if (!flag("noaudio") && !existsSync(audio)) {
    throw new Error(`audio track not found: ${audio}`);
  }
  const args = [
    "ffmpeg",
    "-y",
    "-loglevel",
    "error",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${OW}x${OH}`,
    "-r",
    FPS_R,
    "-i",
    "pipe:0",
  ];
  if (!flag("noaudio")) {
    args.push("-ss", String(from), "-t", String(to - from), "-i", audio);
  }
  args.push(
    "-vf",
    "vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p10le,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",
  );
  const encoder = opt("encoder", "libsvtav1")!;
  if (encoder === "hevc_videotoolbox") {
    args.push(
      "-c:v",
      encoder,
      "-q:v",
      opt("qv", "60")!,
      "-pix_fmt",
      "yuv420p10le",
      "-tag:v",
      "hvc1",
    );
  } else if (encoder === "libsvtav1") {
    args.push(
      "-c:v",
      encoder,
      "-preset",
      opt("preset", "4")!,
      "-crf",
      crf,
      "-pix_fmt",
      "yuv420p10le",
      "-g",
      "120",
      "-svtav1-params",
      opt("svtav1", "tune=0")!,
    );
  } else {
    throw new Error(`unsupported encoder: ${encoder}`);
  }
  if (!flag("noaudio")) {
    args.push("-c:a", "libopus", "-b:a", "320k", "-shortest");
  }
  args.push("-movflags", "+faststart", out);
  const ff = spawn(args[0]!, args.slice(1), {
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (!ff.stdin) {
    throw new Error("failed to open ffmpeg stdin");
  }

  const f0 = Math.round(from * FPS);
  const f1 = Math.round(to * FPS);
  const total = f1 - f0;
  const chunk = Math.max(1, Number(opt("chunk", "8")!));
  const workers = Math.max(
    1,
    Math.min(Number(opt("workers", "2")!), Math.ceil(total / chunk)),
  );
  const frameBytes = OW * OH * 3;
  const cap = Math.max(
    4,
    Math.floor((Number(opt("mem-gb", "1")!) * 1e9) / frameBytes),
  );
  const spoolCap = Math.floor(
    (Number(opt("spool-gb", "20")!) * 1e9) / frameBytes,
  );
  const spoolDir = path.join(tmpdir(), `promo-spool-${process.pid}`);
  mkdirSync(spoolDir, { recursive: true });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      ff.kill(9);
      rmSync(spoolDir, { recursive: true, force: true });
      process.exit(130);
    });
  }
  const spooled = new Set<number>();
  let spoolPeak = 0;
  const spoolFile = (n: number) => path.join(spoolDir, `${n}.rgb`);
  const toSpool = (n: number, buf: Uint8Array) => {
    writeFileSync(spoolFile(n), buf);
    spooled.add(n);
    spoolPeak = Math.max(spoolPeak, spooled.size);
  };
  const waiting = new Map<number, Uint8Array>();
  const owed = new Map<number, number>();
  const queue: number[][] = Array.from({ length: workers }, () => []);
  const sockets: (WebSocket | undefined)[] = [];
  const ackCount: number[] = Array.from({ length: workers }, () => 0);
  const ack = (k: number) => {
    ackCount[k]!++;
    sockets[k]?.send(String(ackCount[k]));
  };
  let next = f0;
  let written = 0;
  let cursor = f0;
  let ending = false;

  let failure: Error | null = null;
  let rejectFailed!: (e: Error) => void;
  let resolveWritten!: () => void;
  const failed = new Promise<never>((_, rej) => {
    rejectFailed = rej;
  });
  failed.catch(() => void 0);
  const allWritten = new Promise<void>((res) => {
    resolveWritten = res;
  });
  const fail = (e: unknown) => {
    if (failure) {
      return;
    }
    failure = e instanceof Error ? e : new Error(String(e));
    for (const ws of sockets) {
      ws?.close();
    }
    rejectFailed(failure);
  };
  const ffExited = exitCode(ff);
  void ffExited.then((code) => {
    if (!ending) {
      fail(new Error(`ffmpeg exited early (code ${code})`));
    }
  });

  const t0 = performance.now();
  let draining = false;
  const drain = async () => {
    if (draining || failure) {
      return;
    }
    draining = true;
    try {
      while (!failure && (waiting.has(next) || spooled.has(next))) {
        let buf = waiting.get(next);
        if (buf) {
          waiting.delete(next);
        } else {
          buf = await readFile(spoolFile(next));
          spooled.delete(next);
          rmSync(spoolFile(next));
        }
        await writeAll(ff.stdin!, buf);
        const k = owed.get(next);
        if (k !== undefined) {
          owed.delete(next);
          ack(k);
        }
        next++;
        written++;
        for (const [m, kk] of owed) {
          if (waiting.size > cap) {
            if (spooled.size >= spoolCap) {
              break;
            }
            toSpool(m, waiting.get(m)!);
            waiting.delete(m);
          }
          owed.delete(m);
          ack(kk);
        }
        if (written % 120 === 0 || written === total) {
          const el = (performance.now() - t0) / 1000;
          process.stdout.write(
            `\r${written}/${total} frames  ${(written / el).toFixed(1)} fps  eta ${written ? ((total - written) / (written / el)).toFixed(0) : "?"}s   `,
          );
        }
        if (written === total) {
          resolveWritten();
        }
      }
    } catch (error) {
      fail(error);
    } finally {
      draining = false;
    }
  };

  const wss = new WebSocketServer({
    port: 0,
    maxPayload: Math.max(64 * 1024 * 1024, OW * OH * 3 + 1024),
  });
  await new Promise<void>((res) => {
    wss.on("listening", () => res());
  });
  const { port: serverPort } = wss.address() as { port: number };
  wss.on("connection", (ws, req) => {
    const k = Number(
      new URL(req.url ?? "/", "http://x").searchParams.get("w") ?? 0,
    );
    sockets[k] = ws;
    if (failure) {
      ws.close();
      return;
    }
    ws.on("message", (msg: Buffer) => {
      if (failure) {
        return;
      }
      try {
        const n = queue[k]!.shift();
        const buf = msg as unknown as Uint8Array;
        if (n === undefined) {
          throw new Error(`worker ${k} sent a frame it was not given`);
        }
        if (buf.length !== frameBytes) {
          throw new Error(
            `worker ${k} sent ${buf.length} bytes for frame ${n}`,
          );
        }
        if (waiting.size < cap || n === next) {
          waiting.set(n, buf);
          ack(k);
        } else if (spooled.size < spoolCap) {
          toSpool(n, buf);
          ack(k);
        } else {
          waiting.set(n, buf);
          owed.set(n, k);
        }
        void drain();
      } catch (error) {
        fail(error);
      }
    });
  });
  const take = () => {
    if (cursor >= f1) {
      return null;
    }
    const a = cursor;
    cursor = Math.min(f1, a + chunk);
    return [a, cursor] as const;
  };
  const pages: Awaited<ReturnType<typeof openPage>>[] = [];
  const used: Record<string, number> = {};
  const closePages = async () => {
    for (const p of pages.splice(0)) {
      if (p.logs.length > 0) {
        console.error(`BROWSER LOG:\n${p.logs.slice(0, 40).join("\n")}`);
      }
      await p.browser.close().catch(() => void 0);
    }
  };
  let ok = false;
  try {
    const opened = await Promise.allSettled(
      Array.from({ length: workers }, () => openPage(url)),
    );
    for (const o of opened) {
      if (o.status === "fulfilled") {
        pages.push(o.value);
      }
    }
    for (const o of opened) {
      if (o.status === "rejected") {
        throw o.reason;
      }
    }
    const rendering = Promise.all(
      pages.map(async ({ page }, k) => {
        for (let r = take(); r && !failure; r = take()) {
          const [first, last] = r;
          for (let n = first; n < last; n++) {
            queue[k]!.push(n);
          }
          const h: Record<string, number> = await page.evaluate(
            (o) => (window as any).__promo.stream(o),
            {
              from: r[0] / FPS,
              to: r[1] / FPS,
              fps: FPS,
              ws: `ws://localhost:${serverPort}/?w=${k}`,
              samples: SAMPLES,
              shutter: Number(opt("shutter", "0.5")!),
              inflight: 4,
            },
          );
          for (const [c, m] of Object.entries(h)) {
            used[c] = (used[c] ?? 0) + m;
          }
        }
      }),
    );
    rendering.catch(() => void 0);
    await Promise.race([rendering, failed]).catch((error) => {
      fail(error);
      throw failure;
    });
    await Promise.race([allWritten, failed]);
    await closePages();
    ending = true;
    ff.stdin.end();
    const code = await ffExited;
    if (code !== 0) {
      throw new Error(`ffmpeg exited with code ${code}`);
    }
    ok = true;
  } finally {
    ending = true;
    if (!ok) {
      ff.kill(9);
    }
    await closePages();
    for (const ws of sockets) {
      ws?.terminate();
    }
    wss.close();
    rmSync(spoolDir, { recursive: true, force: true });
  }
  console.log(
    `\nwrote ${out} (${written} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s, ${workers} workers${spoolPeak ? `, up to ${spoolPeak} frames spooled to disk` : ""})`,
  );
  console.log(`sub-frames per frame (count:frames): ${hist(used)}`);
}

const { url, stop } = await ensureServer();
if (mode === "video") {
  try {
    const { browser, page } = await openPage(url);
    const dur: number = await page.evaluate(
      () => (window as any).__promo.duration,
    );
    await browser.close();
    await video(
      url,
      Number(opt("from", "0")!),
      Number(opt("to", String(dur))!),
      path.resolve(opt("out", path.join(ROOT, `out/${VARIANT}.mp4`))!),
    );
  } finally {
    stop();
  }
  process.exit(0);
}
const { browser, page, logs } = await openPage(url);
try {
  if (mode === "gpu") {
    console.log(
      await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2")!;
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        return ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER);
      }),
    );
  } else if (mode === "stills") {
    const times = (opt("t") ?? "0").split(",").map(Number);
    const files = await stills(
      page,
      times,
      opt("out", path.join(ROOT, "out/stills"))!,
    );
    console.log(files.join("\n"));
  } else if (mode === "sheet") {
    const from = Number(opt("from", "0")!);
    const to = Number(opt("to", "10")!);
    const n = Number(opt("n", "12")!);
    let times = Array.from(
      { length: n },
      (_, i) => from + ((to - from) * i) / Math.max(1, n - 1),
    );
    if (opt("times")) {
      times = opt("times")!.split(",").map(Number);
    }
    if (flag("cuts")) {
      const tl: { id: string; start: number }[] = await page.evaluate(
        () => (window as any).__promo.timeline,
      );
      times = tl
        .slice(1)
        .flatMap((e) => [
          e.start - 0.1,
          e.start - 1 / FPS,
          e.start + 1 / FPS,
          e.start + 0.1,
        ]);
    }
    const out = opt(
      "out",
      path.join(ROOT, `out/sheets/sheet_${from}-${to}.png`),
    )!;
    await sheet(page, times, Number(opt("cols", "4")!), out);
    console.log(out);
  } else if (mode === "perf") {
    const from = Number(opt("from", "0")!);
    const to = Number(opt("to", "5")!);
    const r = await page.evaluate(
      async ({ from, to, samples, shutter }) => {
        const P = (window as any).__promo;
        const ms: number[] = [];
        const buf = new Uint8Array(P.width * P.height * 4);
        P.still(from);
        const used: Record<number, number> = {};
        for (let t = from; t < to; t += 1 / 60) {
          const a = performance.now();
          const k = P.engine.render(t, 1 / 60, false, samples, shutter);
          used[k] = (used[k] ?? 0) + 1;
          await P.engine.readPixelsAsync(buf);
          ms.push(performance.now() - a);
        }
        ms.sort((a, b) => a - b);
        return {
          n: ms.length,
          avg: ms.reduce((a, b) => a + b, 0) / ms.length,
          p50: ms[ms.length >> 1],
          p95: ms[Math.floor(ms.length * 0.95)],
          max: ms.at(-1) ?? 0,
          used,
        };
      },
      { from, to, samples: SAMPLES, shutter: Number(opt("shutter", "0.5")!) },
    );
    console.log(
      `frames ${r.n}  avg ${r.avg.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}  sub-frames ${hist(r.used)}`,
    );
  }
  if (logs.length > 0) {
    console.error(`BROWSER LOG:\n${logs.slice(0, 40).join("\n")}`);
  }
} finally {
  await browser.close();
  stop();
}
