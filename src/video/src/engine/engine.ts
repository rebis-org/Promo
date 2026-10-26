import * as THREE from "three";
import { AudioData } from "./audio";
import { Compositor, FSPass, PW, PH, W, H, clearRT, makeRT } from "./gl";
import { DEFAULT_POST, Post, type PostParams } from "./post";
import { Readback } from "./readback";
import { Sampler, type AdaptiveSampling } from "./sampler";
import {
  Frame,
  Maker,
  type PostOverrides,
  type Scene,
  type SceneClass,
} from "./scene";
import { loadFonts } from "./type";

export type { AdaptiveSampling } from "./sampler";

export interface TimelineEntry {
  id: string;

  load: () => Promise<{ default: SceneClass }>;
  start: number;
  end: number;

  post?: PostOverrides;

  params?: Record<string, any>;

  maxSamples?: number;
}

interface Loaded {
  entry: TimelineEntry;
  scene: Scene | null;
  error?: string;
  lastT: number;
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  audio!: AudioData;
  post!: Post;
  comp = new Compositor();
  loaded = new Map<string, Loaded>();
  readonly sampler: Sampler;
  private readback: Readback;
  private rts = [makeRT(), makeRT(), makeRT()];
  private mixRT = makeRT();
  private finalRT = new THREE.WebGLRenderTarget(PW, PH, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
  });
  private blit: FSPass;
  private xfade: FSPass;
  private lastT = -1;
  lastPost: PostParams = { ...DEFAULT_POST };
  lastSamples = 1;
  errors: string[] = [];

  timeline: TimelineEntry[] = [];

  canvas: HTMLCanvasElement;
  private makeTimeline: (audio: AudioData) => TimelineEntry[];

  constructor(
    canvas: HTMLCanvasElement,
    makeTimeline: (audio: AudioData) => TimelineEntry[],
  ) {
    this.canvas = canvas;
    this.makeTimeline = makeTimeline;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(PW, PH, false);
    this.renderer.autoClear = false;
    this.sampler = new Sampler(this.renderer);
    this.readback = new Readback(this.renderer);
    for (const rt of [...this.rts, this.mixRT]) {
      this.sampler.watch(rt);
    }
    this.blit = new FSPass(
      `uniform sampler2D src; void main(){ fragColor = texture(src, vUv); }`,
      { src: { value: null } },
    );
    this.xfade = new FSPass(
      `uniform sampler2D a; uniform sampler2D b; uniform float k;
	      void main(){ fragColor = mix(texture(a, vUv), texture(b, vUv), k); }`,
      { a: { value: null }, b: { value: null }, k: { value: 0 } },
    );
  }

  async init(only?: (e: TimelineEntry) => boolean): Promise<void> {
    this.audio = await AudioData.load();
    await loadFonts();
    this.timeline = this.makeTimeline(this.audio);
    this.post = new Post();
    const entries = only ? this.timeline.filter(only) : this.timeline;
    await Promise.all(entries.map((e) => this.loadEntry(e)));
  }

  private async loadEntry(e: TimelineEntry): Promise<void> {
    const rec: Loaded = { entry: e, scene: null, lastT: -1 };
    this.loaded.set(e.id, rec);
    try {
      const mod = await e.load();
      const SceneCtor: SceneClass = mod.default;
      const s = new SceneCtor({
        id: e.id,
        params: e.params ?? {},
        audio: this.audio,
        W,
        H,
        make: new Maker(),
      });
      await s.init();
      rec.scene = s;
      for (const m of s.tileMasked) {
        this.sampler.watch(m.rt, m.margin, m.moving);
      }
    } catch (error) {
      rec.error = String((error as Error)?.stack ?? error);
      this.errors.push(`[${e.id}] ${rec.error}`);
      console.error(`scene ${e.id} failed`, error);
    }
  }

  async reload(id: string): Promise<void> {
    const e = this.timeline.find((x) => x.id === id);
    if (!e) {
      return;
    }
    const old = this.loaded.get(id)?.scene;
    for (const m of old?.tileMasked ?? []) {
      this.sampler.unwatch(m.rt);
    }
    old?.dispose();
    await this.loadEntry(e);
    this.lastT = -1;
  }

  dispose(): void {
    for (const rec of this.loaded.values()) {
      rec.scene?.dispose();
    }
    this.loaded.clear();
    this.comp.dispose();
    this.post?.dispose();
    this.sampler.dispose();
    this.readback.dispose();
    for (const rt of [...this.rts, this.mixRT, this.finalRT]) {
      rt.dispose();
    }
    for (const p of [this.blit, this.xfade]) {
      p.dispose();
    }
    this.renderer.dispose();
  }

  get duration(): number {
    return this.audio.duration;
  }

  private frameFor(
    e: TimelineEntry,
    t: number,
    dt: number,
    seeked: boolean,
    preroll: boolean,
    under: THREE.Texture | null,
    tin: number,
    tout: number,
    out: THREE.WebGLRenderTarget,
  ): Frame {
    const beat = this.audio.beatAt(t);
    const bar = this.audio.barAt(t);
    return new Frame(
      { renderer: this.renderer, comp: this.comp },
      out,
      {
        t,
        dt,
        lt: t - e.start,
        p: (t - e.start) / (e.end - e.start),
        start: e.start,
        end: e.end,
        seeked,
        preroll,
        beat,
        bar,
        beatPhase: beat - Math.floor(beat),
        barPhase: bar - Math.floor(bar),
        a: this.audio.sample(t),
        under,
        tin,
        tout,
      },
      (rt, map) => this.sampler.remap(rt, map),
    );
  }

  render(
    t: number,
    dt = 1 / 60,
    toScreen = true,
    samples: number | AdaptiveSampling = 1,
    shutter = 0.5,
  ): number {
    const r = this.renderer;
    const seeked =
      this.lastT < 0 ||
      t < this.lastT - 1e-6 ||
      t - this.lastT > Math.max(0.25, dt * 4);
    this.lastT = t;
    let outTex: THREE.Texture;
    let post: PostParams = { ...DEFAULT_POST };
    let n = 1;
    if (samples === 1) {
      ({ outTex, post } = this.composite(t, dt, seeked));
    } else {
      const adaptive = typeof samples !== "number";
      let maxAdaptive = adaptive ? samples.max : 0;
      if (adaptive) {
        const w = dt * shutter;
        const on = this.timeline.filter(
          (e) => t + w / 2 >= e.start && t - w / 2 < e.end,
        );
        const st = on.find((e) => this.loaded.get(e.id)?.scene?.stateful);
        if (st) {
          throw new Error(
            `adaptive sampling needs stateless scenes; '${st.id}' is stateful (use a fixed --samples)`,
          );
        }
        for (const e of on) {
          if (e.maxSamples) {
            maxAdaptive = Math.min(maxAdaptive, e.maxSamples);
          }
        }
      }
      const POST_U = 0.125;
      let nearest: number | undefined;
      const draw = (
        ts: number,
        u: number,
        step: number,
        seekedFirst: boolean,
      ): THREE.Texture => {
        const res = this.sub(ts, step, seekedFirst);
        const d = Math.abs(u - POST_U);
        if (
          nearest === undefined ||
          d < nearest - 1e-9 ||
          (d < nearest + 1e-9 && u > POST_U)
        ) {
          nearest = d;
          ({ post } = res);
        }
        return res.outTex;
      };
      n = this.sampler.run({
        t,
        dt,
        shutter,
        seeked,
        ...(adaptive
          ? { adaptive: samples, maxAdaptive }
          : { fixed: samples as number }),
        draw,
      });
      outTex = this.sampler.avgRT.texture;
    }
    this.lastSamples = n;
    this.post.render(r, outTex, this.finalRT, post, t);
    this.lastPost = post;
    if (toScreen) {
      this.blit.u.src!.value = this.finalRT.texture;
      this.blit.render(r, null);
    }
    return n;
  }

  private sub(
    ts: number,
    step: number,
    seekedFirst: boolean,
  ): { outTex: THREE.Texture; post: PostParams } {
    const s = this.sampler;
    if (!s.masking) {
      return this.composite(ts, step, seekedFirst);
    }
    const ids = this.timeline
      .filter((e) => ts >= e.start && ts < e.end)
      .map((e) => e.id);
    const own = ids.some((id) => s.depthEntries.has(id));
    if (!own) {
      s.depthSeen = false;
      const res = this.composite(ts, step, seekedFirst);
      if (!s.depthSeen) {
        return res;
      }
      for (const id of ids) {
        s.depthEntries.add(id);
      }
    }
    s.setMasking(false);
    const res = this.composite(ts, step, seekedFirst);
    s.writeTileMask();
    s.setMasking(true);
    return res;
  }

  private composite(
    t: number,
    dt: number,
    seeked: boolean,
  ): { outTex: THREE.Texture; post: PostParams } {
    const r = this.renderer;

    const active = this.timeline
      .filter((e) => t >= e.start && t < e.end)
      .toSorted((a, b) => a.start - b.start);
    let post: PostParams = { ...DEFAULT_POST };
    let under: THREE.Texture | null = null;
    let outTex: THREE.Texture | null = null;

    active.forEach((e, idx) => {
      const rec = this.loaded.get(e.id);
      const rt = this.rts[idx % this.rts.length]!;
      const prev = active[idx - 1];
      const next = active[idx + 1];
      const tin = prev
        ? Math.min(1, (t - e.start) / Math.max(1e-3, prev.end - e.start))
        : 1;
      const tout = next
        ? Math.max(0, (t - next.start) / Math.max(1e-3, e.end - next.start))
        : 0;
      if (!rec?.scene) {
        clearRT(r, rt, [0.25, 0, 0]);
        under = rt.texture;
        outTex = rt.texture;
        return;
      }
      const s = rec.scene;
      const sceneSeeked =
        seeked || rec.lastT < 0 || Math.abs(t - rec.lastT) > 0.25;
      if (s.stateful && sceneSeeked) {
        s.reset();
        const from = Math.max(e.start, t - s.prerollMax);
        const step = 1 / 60;
        let first = true;
        for (let pt = from; pt < t - step * 0.5; pt += step) {
          const f = this.frameFor(
            e,
            pt,
            first ? 0 : step,
            first,
            true,
            null,
            1,
            0,
            rt,
          );
          try {
            s.render(f);
          } finally {
            f.revoke();
          }
          first = false;
        }
      }
      const frame = this.frameFor(
        e,
        t,
        sceneSeeked ? 0 : dt,
        seeked && !s.stateful,
        false,
        idx > 0 ? under : null,
        tin,
        tout,
        rt,
      );
      const ov = this.renderScene(s, frame, e.id, rt);
      rec.lastT = t;
      post = { ...post, ...e.post, ...ov };
      if (idx > 0 && !s.handlesTransition && under) {
        this.xfade.u.a!.value = under;
        this.xfade.u.b!.value = rt.texture;
        this.xfade.u.k!.value = tin;
        this.xfade.render(r, this.mixRT);
        outTex = this.mixRT.texture;
      } else {
        outTex = rt.texture;
      }
      under = outTex;
    });

    if (!outTex) {
      clearRT(r, this.rts[0]!, [0, 0, 0]);
      outTex = this.rts[0]!.texture;
    }
    return { outTex, post };
  }

  private renderScene(
    s: Scene,
    frame: Frame,
    id: string,
    rt: THREE.WebGLRenderTarget,
  ): PostOverrides | undefined {
    try {
      const ov: PostOverrides | void = s.render(frame);
      if (ov === undefined) {
        return;
      }
      return ov;
    } catch (error) {
      console.error(`scene ${id} render error`, error);
      clearRT(this.renderer, rt, [0.25, 0, 0]);
      return;
    } finally {
      frame.revoke();
    }
  }

  readPixels(buf?: Uint8Array): Uint8Array {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    this.renderer.readRenderTargetPixels(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }

  async readPixelsAsync(buf?: Uint8Array): Promise<Uint8Array> {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    await this.renderer.readRenderTargetPixelsAsync(
      this.finalRT,
      0,
      0,
      PW,
      PH,
      out,
    );
    return out;
  }

  static readonly RGB_BYTES = Readback.BYTES;

  readStart(slot: number): void {
    this.readback.start(slot, this.finalRT.texture);
  }

  readFinish(slot: number, out: Uint8Array): Promise<Uint8Array> {
    return this.readback.finish(slot, out);
  }
}
