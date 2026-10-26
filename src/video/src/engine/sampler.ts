import * as THREE from "three";
import { FSPass, H, PW, PH, SCALE, W, clearRT, makeRT } from "./gl";
import { SHOULDER_GLSL } from "./post";

export interface AdaptiveSampling {
  min: number;
  max: number;
  tol: number;
  refine?: "tiles" | "frame";
}

const B = 2 * SCALE,
  R = 16;

const lg3 = (x: number): number => Math.log(x / 4) / Math.log(3);

function ternaryOffsets(steps: number): number[] {
  const u = [0, 1, 2, 3].map((i) => (i + 0.5) / 4 - 0.5);
  for (let l = 0, n = 4; l < steps; l++, n *= 3) {
    for (let m = 0; m < n; m++) {
      u.push((3 * m + 0.5) / (3 * n) - 0.5, (3 * m + 2.5) / (3 * n) - 0.5);
    }
  }
  return u;
}

const nb9 = (
  x: number,
  y: number,
  w: number,
  h: number,
  visit: (i: number) => void,
): void => {
  for (
    let yy = Math.max(0, y - 1), ye = Math.min(h - 1, y + 1);
    yy <= ye;
    yy++
  ) {
    for (
      let xx = Math.max(0, x - 1), xe = Math.min(w - 1, x + 1);
      xx <= xe;
      xx++
    ) {
      visit(yy * w + xx);
    }
  }
};

const wideMask = (on: Uint8Array, tw: number, th: number): Uint8Array => {
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      if (on[y * tw + x]) {
        nb9(x, y, tw, th, (i) => {
          out[i] = 255;
        });
      }
    }
  }
  return out;
};

const max9 = (
  e: Float32Array,
  x: number,
  y: number,
  tw: number,
  th: number,
): number => {
  let m = 0;
  nb9(x, y, tw, th, (i) => {
    m = Math.max(m, e[i * 4]!);
  });
  return m;
};

const SMALL = {
  depthBuffer: false,
  type: THREE.FloatType,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  pxScale: 1,
} as const;

export class Sampler {
  readonly avgRT = makeRT(W, H, { depthBuffer: false });
  lastErrors: number[] = [];
  lastShaded = 1;

  private r: THREE.WebGLRenderer;
  private sumRT = makeRT(W, H, { type: THREE.FloatType });
  private newRT = makeRT(W, H, { type: THREE.FloatType });
  private errRT = makeRT(Math.ceil(PW / B), Math.ceil(PH / B), SMALL);
  private maxRT = makeRT(
    Math.ceil(this.errRT.width / R),
    Math.ceil(this.errRT.height / R),
    SMALL,
  );
  private errBuf = new Float32Array(this.maxRT.width * this.maxRT.height * 4);
  private tileOn = new Uint8Array(this.maxRT.width * this.maxRT.height);
  private tileOnWide = new Uint8Array(this.maxRT.width * this.maxRT.height);
  private gainBuf = new Float32Array(this.maxRT.width * this.maxRT.height);
  private tileTex: THREE.DataTexture;
  private tileTexWide: THREE.DataTexture;
  private gainTex: THREE.DataTexture;
  private accumPass: FSPass;
  private errPass: FSPass;
  private maxPass: FSPass;
  private maskPass: FSPass;
  private gainPass: FSPass;

  private maskedRTs = new Map<
    THREE.WebGLRenderTarget,
    { margin: number; moving?: boolean }
  >();

  masking = false;
  depthSeen = false;
  readonly depthEntries = new Set<string>();
  setMasking!: (on: boolean) => void;

  constructor(r: THREE.WebGLRenderer) {
    this.r = r;
    const tex = (
      data: Uint8Array | Float32Array,
      type: THREE.TextureDataType,
    ) => {
      const t = new THREE.DataTexture(
        data,
        this.maxRT.width,
        this.maxRT.height,
        THREE.RedFormat,
        type,
      );
      t.unpackAlignment = 1;
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      return t;
    };
    this.tileTex = tex(this.tileOn, THREE.UnsignedByteType);
    this.tileTexWide = tex(this.tileOnWide, THREE.UnsignedByteType);
    this.gainTex = tex(this.gainBuf, THREE.FloatType);

    this.accumPass = new FSPass(
      `
	    uniform sampler2D src;
	    void main() {
	      vec4 c = texture(src, vUv);
	      bool ok = abs(c.r) <= 6e4 && abs(c.g) <= 6e4 && abs(c.b) <= 6e4 && abs(c.a) <= 6e4;
	      fragColor = ok ? c : vec4(0.0);
	    }`,
      { src: { value: null } },
      { blending: THREE.CustomBlending, transparent: true },
    );
    const am = this.accumPass.mat;
    am.blendEquation = THREE.AddEquation;
    am.blendSrc = THREE.OneFactor;
    am.blendDst = THREE.OneFactor;
    am.blendSrcAlpha = THREE.ZeroFactor;
    am.blendDstAlpha = THREE.OneFactor;

    this.errPass = new FSPass(
      `
	      uniform sampler2D a; uniform sampler2D b; uniform float invA, invB;
	      uniform sampler2D tiles; uniform bool tileMask;
	      ${SHOULDER_GLSL}
	      vec3 disp(vec3 x) { return toSRGB(sat(shoulder(max(x, 0.0)))); }
	      void main() {
	        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${B}, lim = ivec2(${PW - 1}, ${PH - 1});
	        vec3 sa = vec3(0.0), sb = vec3(0.0);
	        for (int y = 0; y < ${B}; y++) for (int x = 0; x < ${B}; x++) {
	          ivec2 p = min(p0 + ivec2(x, y), lim);
	          sa += texelFetch(a, p, 0).rgb; sb += texelFetch(b, p, 0).rgb;
	        }
	        vec3 e = abs(disp(sa * (invA / ${B * B}.0)) - disp(sb * (invB / ${B * B}.0)));
	        float on = tileMask ? texelFetch(tiles, ivec2(gl_FragCoord.xy) / ${R}, 0).r : 1.0;
	        fragColor = vec4(170.0 * max(e.r, max(e.g, e.b)) * on, 0.0, 0.0, 1.0);
	      }`,
      {
        a: { value: null },
        b: { value: null },
        invA: { value: 1 },
        invB: { value: 1 },
        tiles: { value: this.tileTex },
        tileMask: { value: false },
      },
    );
    this.maxPass = new FSPass(
      `
	      uniform sampler2D e;
	      void main() {
	        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${R};
	        float m = 0.0;
	        for (int y = 0; y < ${R}; y++) for (int x = 0; x < ${R}; x++) {
	          ivec2 p = p0 + ivec2(x, y);
	          if (p.x < ${this.errRT.width} && p.y < ${this.errRT.height}) m = max(m, texelFetch(e, p, 0).r);
	        }
	        fragColor = vec4(m, 0.0, 0.0, 1.0);
	      }`,
      { e: { value: null } },
    );
    this.maskPass = new FSPass(
      `
	      uniform sampler2D tiles; uniform vec4 map;
	      void main() {
	        vec2 p = gl_FragCoord.xy * map.xy + map.zw;
	        if (p.x < 0.0 || p.y < 0.0 || p.x >= ${PW}.0 || p.y >= ${PH}.0) discard;
	        if (texelFetch(tiles, ivec2(floor(p / ${B * R}.0)), 0).r < 0.5) discard;
	        gl_FragDepth = 1.0;
	        fragColor = vec4(0.0);
	      }`,
      {
        tiles: { value: this.tileTex },
        map: { value: new THREE.Vector4(1, 1, 0, 0) },
      },
    );
    const mm = this.maskPass.mat;
    mm.colorWrite = false;
    mm.depthTest = true;
    mm.depthWrite = true;
    mm.depthFunc = THREE.AlwaysDepth;
    this.gainPass = new FSPass(
      `
	      uniform sampler2D tex; uniform vec3 tint; uniform vec4 uvXform; uniform bool premult; uniform sampler2D gain;
	      void main() {
	        vec2 uv = (vUv - 0.5) * uvXform.xy + 0.5 + uvXform.zw;
	        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
	        vec4 c = texture(tex, uv);
	        c.rgb *= tint;
	        if (premult) c.rgb *= c.a;
	        fragColor = vec4(c.rgb, c.a) * texelFetch(gain, ivec2(gl_FragCoord.xy) / ${B * R}, 0).r;
	      }`,
      {
        tex: { value: null },
        tint: { value: new THREE.Vector3(1, 1, 1) },
        uvXform: { value: new THREE.Vector4(1, 1, 0, 0) },
        premult: { value: false },
        gain: { value: this.gainTex },
      },
    );
    this.hookDepthState();
  }

  watch(rt: THREE.WebGLRenderTarget, margin = 0, moving = false): void {
    this.maskedRTs.set(rt, { margin, moving });
  }

  unwatch(rt: THREE.WebGLRenderTarget): void {
    this.maskedRTs.delete(rt);
  }

  run(o: {
    t: number;
    dt: number;
    shutter: number;
    seeked: boolean;
    fixed?: number;
    adaptive?: AdaptiveSampling;
    maxAdaptive?: number;
    draw: (
      ts: number,
      u: number,
      step: number,
      seekedFirst: boolean,
    ) => THREE.Texture;
  }): number {
    const { t, dt, shutter, seeked, draw } = o;
    const { r } = this;
    clearRT(r, this.sumRT, [0, 0, 0], 0);
    const shot = (
      u: number,
      step: number,
      seekedFirst: boolean,
      into: THREE.WebGLRenderTarget,
    ): void => {
      this.accumInto(
        draw(Math.max(0, t + dt * shutter * u), u, step, seekedFirst),
        into,
      );
    };

    if (o.fixed !== undefined) {
      const n = o.fixed;
      for (let k = 0; k < n; k++) {
        shot((k + 0.5) / n - 0.5, dt / n, seeked && k === 0, this.sumRT);
      }
      this.normalize(n, false);
      return n;
    }

    const a = o.adaptive!;
    const lo = Math.max(0, Math.round(lg3(a.min)));
    const hi = Math.max(lo, Math.floor(lg3(o.maxAdaptive ?? a.max) + 1e-9));
    const u = ternaryOffsets(hi);
    let n = 4 * 3 ** lo;
    let perTile = false;
    this.lastErrors = [];
    this.lastShaded = 1;
    const batch = (
      from: number,
      to: number,
      into: THREE.WebGLRenderTarget,
      step: number,
    ): void => {
      for (let k = from; k < to; k++) {
        shot(u[k]!, step, seeked && k === 0, into);
      }
    };
    batch(0, n, this.sumRT, dt / n);

    if ((a.refine ?? "tiles") === "frame") {
      for (let l = lo; l < hi; l++) {
        clearRT(r, this.newRT, [0, 0, 0], 0);
        batch(n, 3 * n, this.newRT, dt / (3 * n));
        const err = this.error(n, false) / 2;
        this.lastErrors.push(err);
        this.accumInto(this.newRT.texture, this.sumRT);
        n *= 3;
        if (err < a.tol) {
          break;
        }
      }
    } else {
      const on = this.tileOn;
      const tw = this.maxRT.width;
      const th = this.maxRT.height;
      const T = on.length;
      on.fill(255);
      const tileN = this.gainBuf;
      tileN.fill(0);
      let live = T;
      let shaded = 0;
      let full = 0;
      for (let l = lo; l < hi && live > 0; l++) {
        const masked = live < T;
        clearRT(r, this.newRT, [0, 0, 0], 0);
        if (masked) {
          this.writeTileMask();
          this.setMasking(true);
        }
        batch(n, 3 * n, this.newRT, dt / (3 * n));
        if (masked) {
          this.setMasking(false);
        }
        const err = this.error(n, masked) / 2;
        this.lastErrors.push(err);
        if (masked) {
          this.setMasking(true);
        }
        this.accumInto(this.newRT.texture, this.sumRT);
        if (masked) {
          this.setMasking(false);
        }
        shaded += 2 * n * live;
        full += 2 * n * T;
        n *= 3;
        const next = new Uint8Array(T);
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const i = y * tw + x;
            if (!on[i]) {
              continue;
            }
            if (max9(this.errBuf, x, y, tw, th) >= a.tol * 2) {
              next[i] = 255;
            } else {
              tileN[i] = n;
              live--;
            }
          }
        }
        on.set(next);
      }
      if (full > 0) {
        this.lastShaded = shaded / full;
        for (let i = 0; i < T; i++) {
          if (on[i]) {
            tileN[i] = n;
          }
        }
        perTile = tileN.some((c) => c !== n);
      }
    }
    this.normalize(n, perTile);
    return n;
  }

  remap(rt: THREE.WebGLRenderTarget, map: THREE.Vector4 | null): void {
    const m = this.maskedRTs.get(rt);
    if (!this.masking || !m?.moving) {
      return;
    }
    const prev = this.r.getRenderTarget();
    const x = new THREE.Vector4();
    if (map) {
      x.set(
        (map.x * PW) / rt.width,
        (map.y * PH) / rt.height,
        map.z * PW,
        map.w * PH,
      );
    }
    this.setMasking(false);
    this.drawMask(rt, m.margin, map ? x : null);
    this.setMasking(true);
    this.r.setRenderTarget(prev);
  }

  writeTileMask(): void {
    const was = this.masking;
    if (was) {
      this.setMasking(false);
    }
    this.tileTex.needsUpdate = true;
    const on = this.tileOn;
    const tw = this.maxRT.width;
    const th = this.maxRT.height;
    this.tileOnWide.set(wideMask(on, tw, th));
    this.tileTexWide.needsUpdate = true;
    for (const [rt, m] of this.maskedRTs) {
      this.drawMask(
        rt,
        m.margin,
        m.moving
          ? null
          : new THREE.Vector4(PW / rt.width, PH / rt.height, 0, 0),
      );
    }
    if (was) {
      this.setMasking(true);
    }
  }

  dispose(): void {
    for (const rt of [
      this.sumRT,
      this.newRT,
      this.avgRT,
      this.errRT,
      this.maxRT,
    ]) {
      rt.dispose();
    }
    for (const p of [
      this.accumPass,
      this.errPass,
      this.maxPass,
      this.maskPass,
      this.gainPass,
    ]) {
      p.dispose();
    }
    for (const t of [this.tileTex, this.tileTexWide, this.gainTex]) {
      t.dispose();
    }
  }

  private accumInto(tex: THREE.Texture, into: THREE.WebGLRenderTarget): void {
    this.accumPass.u.src!.value = tex;
    this.accumPass.render(this.r, into);
  }

  private normalize(n: number, perTile: boolean): void {
    const g = this.gainBuf;
    for (let i = 0; i < g.length; i++) {
      g[i] = perTile ? 1 / g[i]! : 1 / n;
    }
    this.gainTex.needsUpdate = true;
    this.gainPass.u.tex!.value = this.sumRT.texture;
    this.gainPass.render(this.r, this.avgRT);
  }

  private error(n: number, tiles: boolean): number {
    const p = this.errPass;
    p.u.a!.value = this.sumRT.texture;
    p.u.b!.value = this.newRT.texture;
    p.u.invA!.value = 1 / n;
    p.u.invB!.value = 1 / (2 * n);
    p.u.tileMask!.value = tiles;
    p.render(this.r, this.errRT);
    this.maxPass.u.e!.value = this.errRT.texture;
    this.maxPass.render(this.r, this.maxRT);
    this.r.readRenderTargetPixels(
      this.maxRT,
      0,
      0,
      this.maxRT.width,
      this.maxRT.height,
      this.errBuf,
    );
    let m = 0;
    for (let i = 0; i < this.errBuf.length; i += 4) {
      m = Math.max(m, this.errBuf[i]!);
    }
    return m;
  }

  private drawMask(
    rt: THREE.WebGLRenderTarget,
    margin: number,
    map: THREE.Vector4 | null,
  ): void {
    const { r } = this;
    const d = r.state.buffers.depth;
    r.setRenderTarget(rt);
    if (!map) {
      r.clear(false, true, false);
      return;
    }
    d.setClear(0);
    r.clear(false, true, false);
    d.setClear(1);
    this.maskPass.u.tiles!.value = margin ? this.tileTexWide : this.tileTex;
    (this.maskPass.u.map!.value as THREE.Vector4).copy(map);
    this.maskPass.render(r, rt);
  }

  private hookDepthState(): void {
    const { r } = this;
    const st = r.state;
    const d = st.buffers.depth;
    const setTest = d.setTest.bind(d);
    const setFunc = d.setFunc.bind(d);
    const setMask = d.setMask.bind(d);
    let forced = false;
    const force = (on: boolean): void => {
      if (on === forced) {
        return;
      }
      forced = on;
      if (on) {
        setTest(true);
        setFunc(THREE.LessEqualDepth);
        setMask(false);
      }
    };
    d.setTest = (v: boolean): void => {
      if (!forced) {
        setTest(v);
      }
    };
    d.setFunc = (f: THREE.DepthModes): void => {
      if (!forced) {
        setFunc(f);
      }
    };
    d.setMask = (m: boolean): void => {
      if (!forced) {
        setMask(m);
      }
    };
    const setRenderTarget = r.setRenderTarget.bind(r);
    r.setRenderTarget = (target, ...rest): void => {
      setRenderTarget(target, ...rest);
      force(
        this.masking &&
          Boolean(target) &&
          this.maskedRTs.has(target as THREE.WebGLRenderTarget),
      );
    };
    const setMaterial = st.setMaterial.bind(st);
    st.setMaterial = (m, ...rest): void => {
      if (forced && m.depthTest) {
        this.depthSeen = true;
      }
      setMaterial(m, ...rest);
    };
    this.setMasking = (on: boolean): void => {
      this.masking = on;
      const t = r.getRenderTarget();
      force(on && t !== null && this.maskedRTs.has(t));
    };
  }
}
