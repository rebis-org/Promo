import * as THREE from "three";
import type { AudioData, AudioSample } from "./audio";
import {
  clearRT,
  type Compositor,
  type DrawOpts,
  FSPass,
  H,
  Layer2D,
  makeRT,
  type Rgb,
  W,
} from "./gl";
import type { PostParams } from "./post";

export type { Rgb } from "./gl";

export interface Disposable {
  dispose: () => void;
}

export interface Surface {
  renderer: THREE.WebGLRenderer;
  comp: Compositor;
}

export class Maker {
  #owned: Disposable[] = [];

  own = <T extends Disposable>(it: T): T => {
    this.#owned.push(it);
    return it;
  };

  target(
    w = W,
    h = H,
    opts: Partial<THREE.RenderTargetOptions> & { pxScale?: number } = {},
  ): THREE.WebGLRenderTarget {
    return this.own(makeRT(w, h, opts));
  }

  layer(w = W, h = H): Layer2D {
    return this.own(new Layer2D(w, h));
  }

  pass(
    frag: string,
    uniforms: Record<string, THREE.IUniform> = {},
    opts: { blending?: THREE.Blending; transparent?: boolean } = {},
  ): FSPass {
    return this.own(new FSPass(frag, uniforms, opts));
  }

  dispose(): void {
    for (let i = this.#owned.length - 1; i >= 0; i--) {
      this.#owned[i]!.dispose();
    }
    this.#owned.length = 0;
  }
}

export interface SceneCtx {
  readonly id: string;
  readonly params: Record<string, any>;
  readonly audio: AudioData;
  readonly W: number;
  readonly H: number;
  readonly make: Maker;
}

export interface FrameData {
  t: number;
  dt: number;
  lt: number;
  p: number;
  start: number;
  end: number;
  seeked: boolean;
  preroll: boolean;
  beat: number;
  bar: number;
  beatPhase: number;
  barPhase: number;
  a: AudioSample;
  under: THREE.Texture | null;
  tin: number;
  tout: number;
}

export class Frame implements FrameData {
  declare readonly t: number;
  declare readonly dt: number;
  declare readonly lt: number;
  declare readonly p: number;
  declare readonly start: number;
  declare readonly end: number;
  declare readonly seeked: boolean;
  declare readonly preroll: boolean;
  declare readonly beat: number;
  declare readonly bar: number;
  declare readonly beatPhase: number;
  declare readonly barPhase: number;
  declare readonly a: AudioSample;
  declare readonly under: THREE.Texture | null;
  declare readonly tin: number;
  declare readonly tout: number;

  #surface: Surface;
  #out: THREE.WebGLRenderTarget;
  #mask: (rt: THREE.WebGLRenderTarget, map: THREE.Vector4 | null) => void;
  #live = true;

  constructor(
    surface: Surface,
    out: THREE.WebGLRenderTarget,
    data: FrameData,
    mask: (rt: THREE.WebGLRenderTarget, map: THREE.Vector4 | null) => void,
  ) {
    this.#surface = surface;
    this.#out = out;
    this.#mask = mask;
    Object.assign(this, data);
  }

  #use(): Surface {
    if (!this.#live) {
      throw new Error("frame used after its sub-frame ended");
    }
    return this.#surface;
  }

  clear(color: Rgb | null = null, target = this.#out): void {
    clearRT(this.#use().renderer, target, color ?? [0, 0, 0]);
  }

  draw(
    object: THREE.Object3D,
    camera: THREE.Camera,
    opts: { clear?: boolean | Rgb; target?: THREE.WebGLRenderTarget } = {},
  ): void {
    const r = this.#use().renderer;
    r.setRenderTarget(opts.target ?? this.#out);
    if (opts.clear) {
      const rgb: Rgb = opts.clear === true ? [0, 0, 0] : opts.clear;
      r.setClearColor(
        new THREE.Color().setRGB(...rgb, THREE.LinearSRGBColorSpace),
        1,
      );
      r.clear(true, true, false);
    }
    r.render(object, camera);
  }

  over(
    layer: Layer2D,
    opts: DrawOpts & { target?: THREE.WebGLRenderTarget } = {},
  ): void {
    const { renderer, comp } = this.#use();
    const { target, ...o } = opts;
    comp.draw(renderer, layer.upload(), target ?? this.#out, o);
  }

  shade(
    pass: FSPass,
    opts: {
      target?: THREE.WebGLRenderTarget;
      uniforms?: Record<string, unknown>;
    } = {},
  ): void {
    for (const [k, v] of Object.entries(opts.uniforms ?? {})) {
      const slot = pass.u[k];
      if (slot) {
        slot.value = v;
      }
    }
    pass.render(this.#use().renderer, opts.target ?? this.#out);
  }

  mask(rt: THREE.WebGLRenderTarget, map: THREE.Vector4 | null): void {
    this.#use();
    this.#mask(rt, map);
  }

  revoke(): void {
    this.#live = false;
  }
}

export type PostOverrides = Partial<PostParams>;

export abstract class Scene {
  stateful = false;

  prerollMax = 6;

  handlesTransition = false;

  tileMasked: {
    rt: THREE.WebGLRenderTarget;
    margin: 0 | 1;
    moving?: boolean;
  }[] = [];

  protected ctx: SceneCtx;

  constructor(ctx: SceneCtx) {
    this.ctx = ctx;
  }

  init(): Promise<void> | void {}

  reset(): void {}

  abstract render(f: Frame): PostOverrides | void;

  dispose(): void {
    this.ctx.make.dispose();
  }
}

export type SceneClass = new (ctx: SceneCtx) => Scene;
