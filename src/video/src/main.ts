import { type AdaptiveSampling, Engine } from "./engine/engine";
import { PH, PW, SCALE } from "./engine/gl";
import { makeTimeline, variant as currentVariant } from "./timeline";

const params = new URLSearchParams(location.search);
const EXPORT = params.has("export");
const ONLY = params.get("only");
const VARIANT = currentVariant();
const FROM = params.get("t") ? Number(params.get("t")) : null;

const canvas = document.querySelector("#c") as HTMLCanvasElement;
canvas.width = PW;
canvas.height = PH;

const engine = new Engine(canvas, makeTimeline);

declare global {
  interface Window {
    __promo: any;
  }
}

let TIMELINE: typeof engine.timeline = [];

async function boot() {
  const onlySet = ONLY ? new Set(ONLY.split(",")) : null;
  await engine.init(onlySet ? (e) => onlySet.has(e.id) : undefined);
  TIMELINE = engine.timeline;
  if (EXPORT) {
    setupExport();
  } else {
    setupPlayer();
  }
}

let lastStreamed = -2;
const senders = new Map<string, Promise<Sender>>();
interface Sender {
  send: (fill: (buf: Uint8Array) => Promise<unknown>) => Promise<void>;
}

function sender(url: string, inflight: number): Promise<Sender> {
  let s = senders.get(url);
  if (s) {
    return s;
  }
  s = new Promise<Sender>((resolve, reject) => {
    const src = `let ws;
      onmessage = (e) => {
        const m = e.data;
        if (m.open) {
          ws = new WebSocket(m.open); ws.binaryType = 'arraybuffer';
          ws.onopen = () => postMessage({ open: true });
          ws.onerror = () => postMessage({ error: 'websocket error' });
          ws.onclose = () => postMessage({ error: 'websocket closed' });
          ws.onmessage = (ev) => postMessage({ acked: +ev.data || 0 });
        } else {
          ws.send(m.buf);
          postMessage({ free: m.buf }, [m.buf]);
        }
      };`;
    const w = new Worker(
      URL.createObjectURL(new Blob([src], { type: "text/javascript" })),
    );
    const free: ArrayBuffer[] = [];
    let acked = 0;
    let failed = "";
    let pool = 0;
    let sent = 0;
    let wake: (() => void) | null = null;
    const notify = () => {
      const f = wake;
      wake = null;
      f?.();
    };
    const wait = () =>
      new Promise<void>((r) => {
        wake = r;
      });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.open) {
        resolve({ send });
      } else if (m.error) {
        failed = m.error;
        reject(new Error(m.error));
        notify();
      } else if (m.acked !== undefined) {
        acked = Math.max(acked, m.acked);
        notify();
      } else if (m.free) {
        free.push(m.free);
        notify();
      }
    };
    async function send(fill: (buf: Uint8Array) => Promise<unknown>) {
      while (!failed && sent - acked >= inflight) {
        await wait();
      }
      if (failed) {
        throw new Error(failed);
      }
      if (free.length === 0 && pool < 2) {
        free.push(new ArrayBuffer(Engine.RGB_BYTES));
        pool++;
      }
      while (free.length === 0) {
        await wait();
      }
      const buf = free.pop()!;
      await fill(new Uint8Array(buf));
      w.postMessage({ buf }, [buf]);
      sent++;
    }
    w.postMessage({ open: url });
  });
  senders.set(url, s);
  return s;
}

function setupExport() {
  document.body.classList.add("export");
  window.__promo = {
    engine,
    duration: engine.duration,
    errors: engine.errors,

    scale: SCALE,
    width: PW,
    height: PH,
    timeline: TIMELINE.map(({ id, start, end }) => ({ id, start, end })),

    still(t: number, samples: number | AdaptiveSampling = 1, shutter = 0.5) {
      return engine.render(t, 1 / 60, true, samples, shutter);
    },

    async png() {
      const px = await engine.readPixelsAsync();
      const row = PW * 4;
      const img = new ImageData(PW, PH);
      for (let y = 0; y < PH; y++) {
        img.data.set(px.subarray((PH - 1 - y) * row, (PH - y) * row), y * row);
      }
      const oc = new OffscreenCanvas(PW, PH);
      oc.getContext("2d")!.putImageData(img, 0, 0);
      const blob = await oc.convertToBlob({ type: "image/png" });
      const ab = await blob.arrayBuffer();
      const b = new Uint8Array(ab);
      let s = "";
      for (let i = 0; i < b.length; i += 0x80_00) {
        s += String.fromCodePoint(...b.subarray(i, i + 0x80_00));
      }
      return btoa(s);
    },

    async stream(opts: {
      from: number;
      to: number;
      fps: number;
      ws: string;
      samples?: number | AdaptiveSampling;
      shutter?: number;
      inflight?: number;
    }) {
      const snd = await sender(opts.ws, opts.inflight ?? 4);
      const dt = 1 / opts.fps;
      const n0 = Math.round(opts.from * opts.fps);
      const n1 = Math.round(opts.to * opts.fps);
      const S = opts.samples ?? 1;
      const SH = opts.shutter ?? 0.5;
      if (n0 > 0 && lastStreamed !== n0 - 1) {
        engine.render(
          (n0 - 1) * dt,
          dt,
          false,
          typeof S === "number" ? S : 1,
          SH,
        );
      }
      const used: Record<number, number> = {};
      let pending = -1;
      for (let n = n0; n < n1; n++) {
        const k = engine.render(n * dt, dt, false, S, SH);
        used[k] = (used[k] ?? 0) + 1;
        engine.readStart(n % 2);
        if (pending >= 0) {
          await snd.send((buf) => engine.readFinish(pending % 2, buf));
        }
        pending = n;
      }
      if (pending >= 0) {
        await snd.send((buf) => engine.readFinish(pending % 2, buf));
      }
      lastStreamed = n1 - 1;
      return used;
    },
  };
  window.__promo.ready = true;
}

function setupPlayer() {
  const audio = new Audio(`audio/${VARIANT}.opus`);
  audio.preload = "auto";
  const ui = document.querySelector("#ui")!;
  const scrub = document.querySelector("#scrub") as HTMLInputElement;
  const info = document.querySelector("#info")!;
  const marks = document.querySelector("#marks")!;
  const errs = document.querySelector("#errs") as HTMLElement;
  scrub.max = String(engine.duration);
  scrub.step = "0.001";
  if (engine.errors.length > 0) {
    errs.textContent = engine.errors.join("\n\n");
    errs.style.display = "block";
  }

  for (const e of TIMELINE) {
    const m = document.createElement("div");
    m.className = "mark";
    m.style.left = `${(e.start / engine.duration) * 100}%`;
    m.style.width = `${((e.end - e.start) / engine.duration) * 100}%`;
    m.title = `${e.id} ${e.start.toFixed(2)}–${e.end.toFixed(2)}`;
    m.textContent = e.id;
    m.onclick = () => seek(e.start);
    marks.append(m);
  }

  let t = FROM ?? 0;
  let playing = false;
  let loop: [number, number] | null = null;
  let lastAudioT = 0;
  let lastPerf = 0;
  const seek = (x: number) => {
    t = Math.max(0, Math.min(engine.duration - 0.001, x));
    audio.currentTime = t;
  };
  seek(t);

  const toggle = () => {
    playing = !playing;
    if (playing) {
      audio.currentTime = t;
      audio.play();
    } else {
      audio.pause();
    }
  };
  canvas.onclick = toggle;
  scrub.oninput = () => seek(Number(scrub.value));
  const at = () => TIMELINE.find((x) => t >= x.start && t < x.end);
  const KEYS: Record<string, (ev: KeyboardEvent) => void> = {
    " ": () => toggle(),
    ArrowRight: (ev) => seek(t + (ev.shiftKey ? 5 : 1)),
    ArrowLeft: (ev) => seek(t - (ev.shiftKey ? 5 : 1)),
    ".": () => seek(t + 1 / 60),
    ",": () => seek(t - 1 / 60),
    l: () => {
      if (loop) {
        loop = null;
        return;
      }
      const e = at();
      loop = e ? [e.start, e.end] : null;
    },
    h: () => ui.classList.toggle("hidden"),
    "]": () => {
      const e = TIMELINE.find((x) => x.start > t + 0.01);
      if (e) {
        seek(e.start);
      }
    },
    "[": () => {
      const e = TIMELINE.findLast((x) => x.start < t - 0.3);
      if (e) {
        seek(e.start);
      }
    },
  };
  window.addEventListener("keydown", (ev) => {
    const fn = KEYS[ev.key];
    if (!fn) {
      return;
    }
    if (ev.key === " ") {
      ev.preventDefault();
    }
    fn(ev);
  });

  let frames = 0;
  let fpsT = performance.now();
  let fps = 0;
  const tick = () => {
    if (playing) {
      const now = performance.now();
      if (audio.currentTime !== lastAudioT) {
        lastAudioT = audio.currentTime;
        lastPerf = now;
      }
      t = lastAudioT + (audio.paused ? 0 : (now - lastPerf) / 1000);
      if (loop && t >= loop[1]) {
        seek(loop[0]);
      }
      if (audio.ended) {
        playing = false;
      }
    }
    engine.render(t, 1 / 60);
    scrub.value = String(t);
    frames++;
    const now = performance.now();
    if (now - fpsT > 500) {
      fps = (frames * 1000) / (now - fpsT);
      frames = 0;
      fpsT = now;
    }
    const e = TIMELINE.find((x) => t >= x.start && t < x.end);
    info.textContent = `${t.toFixed(2)}s  beat ${engine.audio.beatAt(t).toFixed(2)}  bar ${engine.audio.barAt(t).toFixed(2)}  [${e?.id ?? "—"}]  ${fps.toFixed(0)}fps   ${engine.audio.section(t) ? `§ ${engine.audio.section(t)!.name}` : ""}${loop ? "  LOOP" : ""}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  if (import.meta.hot) {
    import.meta.hot.on("vite:afterUpdate", (payload: any) => {
      for (const u of payload.updates ?? []) {
        const m = /scenes\/(?<scene>[\w-]+)\.ts/u.exec(u.path ?? "");
        if (m) {
          for (const e of TIMELINE) {
            if (e.id === m.groups?.scene) {
              engine.reload(e.id);
            }
          }
        }
      }
    });
  }
}

await boot().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<pre style="color:#f55;position:fixed;top:0;left:0">${String(error?.stack ?? error)}</pre>`,
  );
  window.__promo = { error: String(error?.stack ?? error) };
});
