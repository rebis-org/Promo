import * as THREE from "three";
import { GLSL_COMMON } from "./glsl/common";
import { SCALE } from "./scale";

export { SCALE } from "./scale";

export const W = 1920;
export const H = 1080;

export const PW = W * SCALE;
export const PH = H * SCALE;

export function makeRT(
  w = W,
  h = H,
  opts: Partial<THREE.RenderTargetOptions> & { pxScale?: number } = {},
): THREE.WebGLRenderTarget {
  const { pxScale = SCALE, ...o } = opts;
  return new THREE.WebGLRenderTarget(
    Math.max(1, Math.round(w * pxScale)),
    Math.max(1, Math.round(h * pxScale)),
    {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      ...o,
    },
  );
}

const FS_VERT = `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

let fsGeom: THREE.BufferGeometry | null = null;
function fullscreenGeometry(): THREE.BufferGeometry {
  if (!fsGeom) {
    fsGeom = new THREE.BufferGeometry();
    fsGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
  }
  return fsGeom;
}

export class FSPass {
  mat: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  constructor(
    frag: string,
    uniforms: Record<string, THREE.IUniform> = {},
    opts: { blending?: THREE.Blending; transparent?: boolean } = {},
  ) {
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: `precision highp float;\nin vec3 position;\n${FS_VERT}`,
      fragmentShader: `precision highp float;\nprecision highp int;\nin vec2 vUv;\nout vec4 fragColor;\n${GLSL_COMMON}\n${frag}`,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: opts.blending ?? THREE.NoBlending,
      transparent: opts.transparent ?? false,
    });
    this.mesh = new THREE.Mesh(fullscreenGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  get u(): Record<string, THREE.IUniform> {
    return this.mat.uniforms;
  }
  render(
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget | null,
    clear = false,
  ): void {
    renderer.setRenderTarget(target);
    if (clear) {
      renderer.clear();
    }
    renderer.render(this.scene, this.cam);
  }

  dispose(): void {
    this.mat.dispose();
  }
}

export type Rgb = [number, number, number];

export type BlendMode =
  | "normal"
  | "add"
  | "screen"
  | "multiply"
  | "max"
  | "replace";

export interface DrawOpts {
  mode?: BlendMode;
  opacity?: number;
  tint?: Rgb;
  scale?: [number, number];
  offset?: [number, number];
  premult?: boolean;
}

interface BlendCfg {
  eq?: THREE.BlendingEquation;
  src?: THREE.BlendingSrcFactor;
  dst?: THREE.BlendingDstFactor;
  sa?: THREE.BlendingSrcFactor;
  da?: THREE.BlendingDstFactor;
}

const BLENDS: Record<BlendMode, BlendCfg> = {
  normal: {
    src: THREE.OneFactor,
    dst: THREE.OneMinusSrcAlphaFactor,
    sa: THREE.OneFactor,
    da: THREE.OneMinusSrcAlphaFactor,
  },
  add: {
    src: THREE.OneFactor,
    dst: THREE.OneFactor,
    sa: THREE.ZeroFactor,
    da: THREE.OneFactor,
  },
  screen: {
    src: THREE.OneFactor,
    dst: THREE.OneMinusSrcColorFactor,
    sa: THREE.ZeroFactor,
    da: THREE.OneFactor,
  },
  multiply: {
    src: THREE.DstColorFactor,
    dst: THREE.OneMinusSrcAlphaFactor,
    sa: THREE.ZeroFactor,
    da: THREE.OneFactor,
  },
  max: { eq: THREE.MaxEquation, src: THREE.OneFactor, dst: THREE.OneFactor },
  replace: {},
};

export class Compositor {
  private passes = new Map<BlendMode, FSPass>();
  private frag = `
	    uniform sampler2D tex; uniform float opacity; uniform vec3 tint; uniform vec4 uvXform; uniform bool premult;
	    void main() {
	      vec2 uv = (vUv - 0.5) * uvXform.xy + 0.5 + uvXform.zw;
	      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
	      vec4 c = texture(tex, uv);
	      c.rgb *= tint;
	      if (premult) c.rgb *= c.a;
	      fragColor = vec4(c.rgb, c.a) * opacity;
	    }`;
  private get(mode: BlendMode): FSPass {
    let p = this.passes.get(mode);
    if (!p) {
      const cfg = BLENDS[mode];
      const u = {
        tex: { value: null },
        opacity: { value: 1 },
        tint: { value: new THREE.Vector3(1, 1, 1) },
        uvXform: { value: new THREE.Vector4(1, 1, 0, 0) },
        premult: { value: true },
      };
      p = new FSPass(this.frag, u, {
        blending: THREE.CustomBlending,
        transparent: true,
      });
      const m = p.mat;
      if (cfg.src === undefined) {
        m.blending = THREE.NoBlending;
      } else {
        m.blendEquation = cfg.eq ?? THREE.AddEquation;
        m.blendSrc = cfg.src;
        m.blendDst = cfg.dst!;
        if (cfg.sa !== undefined) {
          m.blendSrcAlpha = cfg.sa;
        }
        if (cfg.da !== undefined) {
          m.blendDstAlpha = cfg.da;
        }
      }
      this.passes.set(mode, p);
    }
    return p;
  }

  draw(
    renderer: THREE.WebGLRenderer,
    tex: THREE.Texture,
    target: THREE.WebGLRenderTarget | null,
    o: DrawOpts = {},
  ): void {
    const p = this.get(o.mode ?? "normal");
    p.u.tex!.value = tex;
    p.u.opacity!.value = o.opacity ?? 1;
    (p.u.tint!.value as THREE.Vector3).set(...(o.tint ?? [1, 1, 1]));
    (p.u.uvXform!.value as THREE.Vector4).set(
      o.scale?.[0] ?? 1,
      o.scale?.[1] ?? 1,
      o.offset?.[0] ?? 0,
      o.offset?.[1] ?? 0,
    );
    p.u.premult!.value = o.premult ?? o.mode !== "multiply";
    p.render(renderer, target);
  }

  dispose(): void {
    for (const p of this.passes.values()) {
      p.dispose();
    }
    this.passes.clear();
  }
}

const PX_RE = /(?<num>-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px/giu;
const px = (v: string, k: number): string =>
  v.replaceAll(
    PX_RE,
    (m, _g, _o, _s, groups: { num: string }) => `${Number(groups.num) * k}px`,
  );

function scaleContext2D(
  c: CanvasRenderingContext2D,
  s: number,
): CanvasRenderingContext2D {
  if (s === 1) {
    return c;
  }
  const proto = CanvasRenderingContext2D.prototype;
  const setT = proto.setTransform as (
    this: CanvasRenderingContext2D,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ) => void;
  const getT = proto.getTransform;
  c.setTransform = function setTransform(
    this: CanvasRenderingContext2D,
    a?: number | DOMMatrix2DInit,
    b?: number,
    cc?: number,
    d?: number,
    e?: number,
    f?: number,
  ): void {
    if (typeof a === "number") {
      setT.call(this, a * s, b! * s, cc! * s, d! * s, e! * s, f! * s);
      return;
    }
    const m = new DOMMatrix([
      a?.a ?? a?.m11 ?? 1,
      a?.b ?? a?.m12 ?? 0,
      a?.c ?? a?.m21 ?? 0,
      a?.d ?? a?.m22 ?? 1,
      a?.e ?? a?.m41 ?? 0,
      a?.f ?? a?.m42 ?? 0,
    ]);
    setT.call(this, m.a * s, m.b * s, m.c * s, m.d * s, m.e * s, m.f * s);
  } as CanvasRenderingContext2D["setTransform"];
  c.resetTransform = function resetTransform(
    this: CanvasRenderingContext2D,
  ): void {
    setT.call(this, s, 0, 0, s, 0, 0);
  };
  c.getTransform = function getTransform(
    this: CanvasRenderingContext2D,
  ): DOMMatrix {
    const m = getT.call(this);
    return new DOMMatrix([
      m.a / s,
      m.b / s,
      m.c / s,
      m.d / s,
      m.e / s,
      m.f / s,
    ]);
  };
  for (const k of ["shadowBlur", "shadowOffsetX", "shadowOffsetY"] as const) {
    const d = Object.getOwnPropertyDescriptor(proto, k)!;
    Object.defineProperty(c, k, {
      configurable: true,
      get(): number {
        return d.get!.call(this) / s;
      },
      set(v: number): void {
        d.set!.call(this, v * s);
      },
    });
  }
  const fd = Object.getOwnPropertyDescriptor(proto, "filter")!;
  Object.defineProperty(c, "filter", {
    configurable: true,
    get(): string {
      return px(fd.get!.call(this), 1 / s);
    },
    set(v: string): void {
      fd.set!.call(this, px(String(v), s));
    },
  });
  setT.call(c, s, 0, 0, s, 0, 0);
  return c;
}

export class Layer2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  w: number;
  h: number;

  constructor(w = W, h = H, scale = SCALE) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(w * scale);
    this.canvas.height = Math.round(h * scale);
    this.ctx = scaleContext2D(this.canvas.getContext("2d")!, scale);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = true;
  }
  clear(color?: string): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    c.filter = "none";
    c.shadowBlur = 0;
    if (color) {
      c.fillStyle = color;
      c.fillRect(0, 0, this.w, this.h);
    } else {
      c.clearRect(0, 0, this.w, this.h);
    }
  }
  upload(): THREE.CanvasTexture {
    this.texture.needsUpdate = true;
    return this.texture;
  }

  dispose(): void {
    this.texture.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

export function clearRT(
  renderer: THREE.WebGLRenderer,
  rt: THREE.WebGLRenderTarget | null,
  rgb: Rgb = [0, 0, 0],
  a = 1,
): void {
  const prev = renderer.getClearColor(new THREE.Color()).clone();
  const prevA = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(
    new THREE.Color().setRGB(
      rgb[0],
      rgb[1],
      rgb[2],
      THREE.LinearSRGBColorSpace,
    ),
    a,
  );
  renderer.clear(true, true, true);
  renderer.setClearColor(prev, prevA);
}
