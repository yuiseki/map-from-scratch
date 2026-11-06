import { BANDS, UNIT_M } from './format.js';
export const GAIN = 1.5;
export const FLOOR = 0.4;
export function levelOf(byte) {
    return Math.max(0, (byte / 255 - FLOOR) / (1 - FLOOR));
}
export const SKY = [
    0.09,
    0.12,
    0.21
];
export const GROUND = [
    0.075,
    0.082,
    0.102
];
const f = (v)=>v.toFixed(3);
const v3 = (c)=>`vec3(${c.map(f).join(', ')})`;
export const VS = `#version 300 es
layout(location = 0) in vec2 aXY;
layout(location = 1) in float aHeight;
layout(location = 2) in uint aBand;
layout(location = 3) in float aTop;
uniform mat4 uMVP;
uniform float uLevels[${BANDS}];
out vec3 vPos;
flat out float vLevel;
flat out float vGround;
void main() {
  float level = aBand < ${BANDS}u ? uLevels[aBand] : 0.0;
  float z = aTop * aHeight * (1.0 + ${f(GAIN)} * level) * ${f(UNIT_M)};
  vPos = vec3(aXY * ${f(UNIT_M)}, z);
  vLevel = level;
  vGround = aBand == 255u ? 1.0 : 0.0;
  gl_Position = uMVP * vec4(vPos, 1.0);
}`;
export const FS = `#version 300 es
precision highp float;
in vec3 vPos;
flat in float vLevel;
flat in float vGround;
uniform vec4 uLight;
uniform vec3 uEye;
uniform vec2 uFog;
out vec4 o;
void main() {
  // Flat normal from the screen derivatives: faces are planar, and the
  // vertices carry no normal (forge3d 005).
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  float diff = max(dot(n, normalize(vec3(-0.45, -0.3, 0.84))), 0.0);
  vec3 col;
  if (vGround > 0.5) col = ${v3(GROUND)};
  else {
    vec3 base = vec3(0.667);
    col = base * (0.3 + 0.4 * diff)
        + base * uLight.rgb * uLight.a * (0.1 + 0.25 * diff)
        + uLight.rgb * vLevel * 0.45;
  }
  float fog = smoothstep(uFog.x, uFog.y, distance(vPos, uEye));
  o = vec4(mix(col, ${v3(SKY)}, fog), 1.0);
}`;
function hsl(h, s, l) {
    const k = (n)=>(n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const c = (n)=>l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [
        c(0),
        c(8),
        c(4)
    ];
}
export function lightOf(nowMs, levels, out = new Float32Array(4)) {
    let sum = 0;
    for(let i = 0; i < BANDS; i++)sum += levels[i];
    const avg = sum / BANDS * 255;
    const [r, g, b] = hsl(nowMs / 100 % 360, Math.min(50 + avg / 4, 100) / 100, 0.5);
    out[0] = r;
    out[1] = g;
    out[2] = b;
    out[3] = Math.min(1, avg / 256 * 10);
    return out;
}
