import * as THREE from "three";
import { FSPass, H, SCALE, W, makeRT } from "./gl";

export const SHOULDER_GLSL = `
vec3 shoulder(vec3 x) {
  const float k = 0.72;
  vec3 y = mix(x, k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))), step(k, x));
  float over = max(max(x.r, x.g), x.b);
  return mix(y, vec3(1.0), smoothstep(2.0, 12.0, over) * 0.85);
}`;

export interface PostParams {
  exposure: number;
  bloom: number;
  bloomThreshold: number;
  bloomKnee: number;
  bloomRadius: number;
  halation: number;
  ca: number;
  grain: number;
  vignette: number;
  fade: number;
  flash: number;
  shake: [number, number];
  zoom: number;
  invert: number;
  mono: number;
  scan: number;
  curve: number;
}

export const DEFAULT_POST: PostParams = {
  exposure: 1,
  bloom: 0.55,
  bloomThreshold: 0.85,
  bloomKnee: 0.5,
  bloomRadius: 0.75,
  halation: 0.25,
  ca: 0,
  grain: 0.055,
  vignette: 0.35,
  fade: 0,
  flash: 0,
  shake: [0, 0],
  zoom: 1,
  invert: 0,
  mono: 1,
  scan: 0,
  curve: 0,
};

const MIPS = 7;

const num =
  (k: keyof PostParams, scale = 1) =>
  (u: THREE.IUniform, p: PostParams) => {
    u.value = (p[k] as number) * scale;
  };
const FINAL_SETTERS: Record<
  string,
  (u: THREE.IUniform, p: PostParams) => void
> = {
  exposure: num("exposure"),
  bloom: num("bloom", 1 / 3),
  halation: num("halation"),
  ca: num("ca"),
  grain: num("grain"),
  vignette: num("vignette"),
  fade: num("fade"),
  flash: num("flash"),
  zoom: num("zoom"),
  invert: num("invert"),
  mono: num("mono"),
  scan: num("scan"),
  curve: num("curve"),
  shake: (u, p) => (u.value as THREE.Vector2).set(p.shake[0], p.shake[1]),
};

export class Post {
  private prefilter: FSPass;
  private down: FSPass;
  private up: FSPass;
  private final: FSPass;
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];

  constructor() {
    let w = W >> 1,
      h = H >> 1;
    for (let i = 0; i < MIPS; i++) {
      this.mips.push(
        makeRT(Math.max(2, w), Math.max(2, h), {
          depthBuffer: false,
          pxScale: 1,
        }),
      );
      this.ups.push(
        makeRT(Math.max(2, w), Math.max(2, h), {
          depthBuffer: false,
          pxScale: 1,
        }),
      );
      w >>= 1;
      h >>= 1;
    }
    this.prefilter = new FSPass(
      `
      uniform sampler2D src; uniform vec2 texel; uniform float threshold, knee;
      void main() {
        vec3 c = vec3(0.0);
${
  SCALE === 1
    ? `        c += texture(src, vUv + texel * vec2(-1, -1)).rgb; c += texture(src, vUv + texel * vec2(1, -1)).rgb;
        c += texture(src, vUv + texel * vec2(-1, 1)).rgb;  c += texture(src, vUv + texel * vec2(1, 1)).rgb;
        c *= 0.25;`
    : `
        const int N = ${SCALE * 2};
        for (int j = 0; j < N; j++) for (int i = 0; i < N; i++)
          c += texture(src, vUv + texel * (vec2(float(i), float(j)) * 2.0 - float(N - 1)) / PX_SCALE).rgb;
        c /= float(N * N);`
}
        c = min(c, vec3(40.0));
        float l = max(c.r, max(c.g, c.b));
        float rq = clamp(l - threshold + knee, 0.0, 2.0 * knee);
        rq = rq * rq / (4.0 * knee + 1e-5);
        float w = max(rq, l - threshold) / max(l, 1e-5);
        fragColor = vec4(c * w, 1.0);
      }`,
      {
        src: { value: null },
        texel: { value: new THREE.Vector2() },
        threshold: { value: 1 },
        knee: { value: 0.5 },
      },
    );
    this.down = new FSPass(
      `
      uniform sampler2D src; uniform vec2 texel;
      void main() {
        vec3 a = texture(src, vUv + texel * vec2(-2, -2)).rgb, b = texture(src, vUv + texel * vec2(0, -2)).rgb, c = texture(src, vUv + texel * vec2(2, -2)).rgb;
        vec3 d = texture(src, vUv + texel * vec2(-1, -1)).rgb, e = texture(src, vUv + texel * vec2(1, -1)).rgb;
        vec3 f = texture(src, vUv + texel * vec2(-2, 0)).rgb, g = texture(src, vUv).rgb, h = texture(src, vUv + texel * vec2(2, 0)).rgb;
        vec3 i = texture(src, vUv + texel * vec2(-1, 1)).rgb, j = texture(src, vUv + texel * vec2(1, 1)).rgb;
        vec3 k = texture(src, vUv + texel * vec2(-2, 2)).rgb, l = texture(src, vUv + texel * vec2(0, 2)).rgb, m = texture(src, vUv + texel * vec2(2, 2)).rgb;
        vec3 o = (d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125 + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125;
        fragColor = vec4(o, 1.0);
      }`,
      { src: { value: null }, texel: { value: new THREE.Vector2() } },
    );
    this.up = new FSPass(
      `
      uniform sampler2D src; uniform sampler2D prev; uniform vec2 texel; uniform float radius;
      void main() {
        vec2 o = texel * radius;
        vec3 s = texture(src, vUv - o).rgb + 2.0 * texture(src, vUv + vec2(0, -o.y)).rgb + texture(src, vUv + vec2(o.x, -o.y)).rgb
          + 2.0 * texture(src, vUv + vec2(-o.x, 0)).rgb + 4.0 * texture(src, vUv).rgb + 2.0 * texture(src, vUv + vec2(o.x, 0)).rgb
          + texture(src, vUv + vec2(-o.x, o.y)).rgb + 2.0 * texture(src, vUv + vec2(0, o.y)).rgb + texture(src, vUv + o).rgb;
        fragColor = vec4(texture(prev, vUv).rgb + s / 16.0, 1.0);
      }`,
      {
        src: { value: null },
        prev: { value: null },
        texel: { value: new THREE.Vector2() },
        radius: { value: 1 },
      },
    );
    this.final = new FSPass(
      `
      uniform sampler2D src; uniform sampler2D bloomTex; uniform sampler2D haloTex;
      uniform float exposure, bloom, halation, ca, grain, vignette, fade, flash, time, zoom, invert, mono, scan, curve;
      uniform vec2 shake; uniform vec2 res;
      ${SHOULDER_GLSL}
      void main() {
        vec2 uv = (vUv - 0.5) / zoom + 0.5 - shake / res;
        vec2 dc = uv - 0.5;
        float rr = dot(dc, dc);
        uv = 0.5 + dc * (1.0 + curve * 0.09 * rr);
        dc = uv - 0.5;
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
          fragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        float r2 = dot(dc * vec2(res.x / res.y, 1.0), dc * vec2(res.x / res.y, 1.0));
        vec2 off = dc * r2 * ca / res.x * 4.0;
        vec3 col;
        col.r = texture(src, uv + off).r;
        col.g = texture(src, uv).g;
        col.b = texture(src, uv - off).b;
        vec3 bl = texture(bloomTex, uv).rgb;
        vec3 ha = texture(haloTex, uv).rgb;
        col += bl * bloom;
        col += vec3(luma(ha)) * halation;
        col *= exposure;
        col = shoulder(col);
        col = mix(col, vec3(0.8515) - col * 0.84, invert);
        col += C_BONE * flash;
        float v = smoothstep(0.95, 0.25, length(dc * vec2(1.0, 0.8)));
        col *= mix(1.0, v, vignette);
        col *= (1.0 - fade);
        vec3 s = toSRGB(sat(col));
        s = mix(s, vec3(luma(s)), mono);
${
  SCALE === 1
    ? `        float g1 = hash12(gl_FragCoord.xy + fract(time * 13.37) * 1000.0) - 0.5;
        float g2 = hash12(floor(gl_FragCoord.xy / 2.0) + fract(time * 7.13) * 1000.0) - 0.5;`
    : `
        float g1 = (hash12(gl_FragCoord.xy + fract(time * 13.37) * 1000.0) - 0.5) * PX_SCALE;
        float g2 = hash12(floor(FRAG_PX / 2.0) + fract(time * 7.13) * 1000.0) - 0.5;`
}
        float row = vUv.y * res.y;
        s *= 1.0 - scan * 0.22 * (0.5 - 0.5 * cos(row * 3.14159265));
        s *= 1.0 + (hash12(vec2(floor(row), 7.77)) - 0.5) * 0.03;
        s *= 1.0 + 0.005 * sin(time * 3.14159265 + 1.3);
        float lm = luma(s);
        float amt = grain * (0.55 + 1.2 * lm * (1.0 - lm));
        s += (g1 * 0.6 + g2 * 0.4) * amt;
        s += (hash12(gl_FragCoord.xy * 1.37 + time) - 0.5) / 255.0;
        fragColor = vec4(sat(s), 1.0);
      }`,
      {
        src: { value: null },
        bloomTex: { value: null },
        haloTex: { value: null },
        exposure: { value: 1 },
        bloom: { value: 0.5 },
        halation: { value: 0.2 },
        ca: { value: 1 },
        grain: { value: 0.05 },
        vignette: { value: 0.3 },
        fade: { value: 0 },
        flash: { value: 0 },
        time: { value: 0 },
        zoom: { value: 1 },
        invert: { value: 0 },
        mono: { value: 1 },
        scan: { value: 0 },
        curve: { value: 0 },
        shake: { value: new THREE.Vector2() },
        res: { value: new THREE.Vector2(W, H) },
      },
    );
  }

  render(
    renderer: THREE.WebGLRenderer,
    src: THREE.Texture,
    out: THREE.WebGLRenderTarget | null,
    p: PostParams,
    time: number,
  ): void {
    this.prefilter.u.src!.value = src;
    (this.prefilter.u.texel!.value as THREE.Vector2).set(1 / W, 1 / H);
    this.prefilter.u.threshold!.value = p.bloomThreshold;
    this.prefilter.u.knee!.value = p.bloomKnee;
    this.prefilter.render(renderer, this.mips[0]!);
    for (let i = 1; i < MIPS; i++) {
      const s = this.mips[i - 1]!;
      this.down.u.src!.value = s.texture;
      (this.down.u.texel!.value as THREE.Vector2).set(
        1 / s.width,
        1 / s.height,
      );
      this.down.render(renderer, this.mips[i]!);
    }
    let prevTex = this.mips[MIPS - 1]!.texture;
    for (let i = MIPS - 2; i >= 0; i--) {
      const small = i === MIPS - 2 ? this.mips[MIPS - 1]! : this.ups[i + 1]!;
      this.up.u.src!.value = prevTex;
      this.up.u.prev!.value = this.mips[i]!.texture;
      (this.up.u.texel!.value as THREE.Vector2).set(
        1 / small.width,
        1 / small.height,
      );
      this.up.u.radius!.value = 0.5 + p.bloomRadius;
      this.up.render(renderer, this.ups[i]!);
      prevTex = this.ups[i]!.texture;
    }
    const f = this.final.u;
    f.src!.value = src;
    f.bloomTex!.value = this.ups[0]!.texture;
    f.haloTex!.value = this.ups[3]!.texture;
    for (const [name, set] of Object.entries(FINAL_SETTERS)) {
      set(f[name]!, p);
    }
    f.time!.value = time;
    this.final.render(renderer, out);
  }

  dispose(): void {
    for (const rt of [...this.mips, ...this.ups]) {
      rt.dispose();
    }
    for (const p of [this.prefilter, this.down, this.up, this.final]) {
      p.dispose();
    }
  }
}
