import { LIN } from "../palette";
import { SCALE } from "../scale";

const v3 = (c: [number, number, number]): string =>
  `vec3(${c.map((x) => x.toFixed(5)).join(",")})`;

export const GLSL_COMMON = `
const float PX_SCALE = ${SCALE.toFixed(1)};
#define FRAG_PX (gl_FragCoord.xy / PX_SCALE)
const vec3 C_BONE = ${v3(LIN.paper)};

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 sat(vec3 x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 toSRGB(vec3 c) { return mix(12.92 * c, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;
