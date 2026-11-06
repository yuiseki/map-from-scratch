import { PULSE_SIGMA_KM } from './pulse.js';
import { EARTH_R } from './land.js';
export const MAX_LINES = 12;
export const GLOW_SCALE = 2.0;
export const OCEAN = [
    0.027,
    0.051,
    0.094
];
export const LAND = [
    0.105,
    0.145,
    0.2
];
export const SPACE = [
    0.008,
    0.012,
    0.024
];
export const SUN = (()=>{
    const v = [
        -0.75,
        0.35,
        0.56
    ], l = Math.hypot(...v);
    return v.map((x)=>x / l);
})();
const f = (x)=>x.toFixed(3);
const v3 = (a)=>`vec3(${a.map(f).join(', ')})`;
export function globeShaders() {
    const vs = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;
    const fs = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP, uVP;
uniform vec3 uEye, uOrigin;
out vec4 outColor;
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w - uEye);
  vec3 oc = uEye + uOrigin;
  float b = dot(oc, d), c = dot(oc, oc) - ${f(EARTH_R)} * ${f(EARTH_R)};
  float disc = b * b - c;
  vec3 sun = ${v3(SUN)};
  if (disc < 0.0) {
    // space, with a thin limb glow (about 1% of the radius)
    float dmin = length(oc - d * b);
    float g = b < 0.0 ? exp(-(dmin - ${f(EARTH_R)}) / 60.0) : 0.0;
    outColor = vec4(${v3(SPACE)} + vec3(0.18, 0.4, 0.9) * g * 0.6, 1.0);
    gl_FragDepth = 1.0;
    return;
  }
  float t = -b - sqrt(disc);
  vec3 p = uEye + d * t;
  vec3 n = normalize(p + uOrigin);
  float lit = 0.75 + 0.25 * max(dot(n, sun), 0.0);
  float rim = pow(1.0 - max(dot(n, -d), 0.0), 4.0);
  outColor = vec4(${v3(OCEAN)} * lit + vec3(0.1, 0.25, 0.6) * rim * 0.5, 1.0);
  vec4 clip = uVP * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}`;
    return {
        vs,
        fs
    };
}
export function landShaders() {
    const vs = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
uniform vec3 uOrigin;
out vec3 vN;
void main() { vN = normalize(aPos + uOrigin); gl_Position = uVP * vec4(aPos, 1.0); }`;
    const fs = `#version 300 es
precision highp float;
in vec3 vN;
out vec4 outColor;
void main() {
  float lit = 0.8 + 0.3 * max(dot(normalize(vN), ${v3(SUN)}), 0.0);
  outColor = vec4(${v3(LAND)} * lit, 1.0);
}`;
    return {
        vs,
        fs
    };
}
export function tubeShaders() {
    const vs = `#version 300 es
layout(location = 0) in vec3 aCentre;
layout(location = 1) in vec3 aOffset;
layout(location = 2) in vec3 aNormal;
layout(location = 3) in int aLine;
layout(location = 4) in float aAlong;
uniform mat4 uVP;
uniform vec3 uOrigin, uEye;
uniform float uRadius, uMinPx, uPxPerRad, uInflate;
uniform vec3 uColour[${MAX_LINES}];
uniform float uHead[${MAX_LINES}];
out vec3 vN, vP, vCol;
out float vAlong, vHead;
void main() {
  vec3 up = normalize(aCentre + uOrigin);
  float px = uRadius * uPxPerRad / max(length(aCentre - uEye), 1e-3);
  float s = max(1.0, uMinPx / px);
  vec3 p = aCentre + up * (s - 1.0) * uRadius + aOffset * s * uInflate;
  vN = aNormal; vP = p; vCol = uColour[aLine]; vAlong = aAlong; vHead = uHead[aLine];
  gl_Position = uVP * vec4(p, 1.0);
}`;
    const common = `#version 300 es
precision highp float;
in vec3 vN, vP, vCol;
in float vAlong, vHead;
uniform vec3 uEye;
uniform float uPulse;
out vec4 outColor;
float glow() { float d = (vAlong - vHead) / ${f(PULSE_SIGMA_KM)}; return uPulse * exp(-0.5 * d * d); }
`;
    const fs = common + `void main() {
  vec3 n = normalize(vN), v = normalize(uEye - vP), l = ${v3(SUN)};
  float diff = max(dot(n, l), 0.0), head = max(dot(n, v), 0.0);
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 24.0);
  float fres = pow(1.0 - head, 3.0);
  vec3 c = vCol * (0.3 + 0.45 * diff + 0.35 * head) + vec3(spec * 0.35) + vCol * fres * 0.9;
  c += mix(vCol, vec3(1.0), 0.65) * glow() * 1.5;
  outColor = vec4(c, 1.0);
}`;
    const halo = common + `void main() {
  float a = pow(max(dot(normalize(vN), normalize(uEye - vP)), 0.0), 1.6);
  outColor = vec4(vCol * a * (0.22 + 0.6 * glow()), 1.0);
}`;
    return {
        vs,
        fs,
        halo
    };
}
