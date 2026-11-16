import { FOVY } from './camera.js';
export const DEFAULTS = {
    attenuation: true,
    geometricErrorScale: 1,
    maximumAttenuation: 0,
    baseResolution: 0,
    eyeDomeLighting: true,
    eyeDomeLightingStrength: 1,
    eyeDomeLightingRadius: 1
};
export const EDL = {
    responseScale: 300,
    neighbours: [
        [
            -1,
            0
        ],
        [
            1,
            0
        ],
        [
            0,
            -1
        ],
        [
            0,
            1
        ]
    ],
    clearDepth: 1
};
export function nodeGeometricError(node, s) {
    if (node.geometricError > 0) return node.geometricError;
    if (s.baseResolution > 0) return s.baseResolution;
    const volume = (node.max[0] - node.min[0]) * (node.max[1] - node.min[1]) * (node.max[2] - node.min[2]);
    return Math.cbrt(volume / Math.max(1, node.count));
}
export function pointUniforms(node, s, maximumScreenSpaceError, bufferHeight, pixelRatio) {
    if (!s.attenuation) return {
        attenuate: false,
        maxSize: 1,
        geometricError: 0,
        depthMultiplier: 0
    };
    return {
        attenuate: true,
        maxSize: (s.maximumAttenuation > 0 ? s.maximumAttenuation : maximumScreenSpaceError) * pixelRatio,
        geometricError: nodeGeometricError(node, s) * s.geometricErrorScale,
        depthMultiplier: bufferHeight / (2 * Math.tan(FOVY / 2))
    };
}
export const edlActive = (s)=>s.attenuation && s.eyeDomeLighting;
export const edlUniforms = (s, pixelRatio)=>({
        radius: s.eyeDomeLightingRadius * pixelRatio,
        strength: s.eyeDomeLightingStrength
    });
const f1 = (v)=>v.toFixed(1);
export const POINT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_q;
layout(location=1) in vec3 a_color;
uniform mat4 u_viewProj;
uniform vec3 u_eye, u_forward, u_min, u_extent;
uniform vec3 u_point;   // maximum size, geometric error, depth multiplier
uniform bool u_attenuate;
out vec3 v_color;
void main() {
  vec3 p = u_min + a_q * u_extent;
  gl_Position = u_viewProj * vec4(p, 1.0);
  float depth = dot(p - u_eye, u_forward);
  gl_PointSize = u_attenuate ? max(1.0, min(u_point.y / depth * u_point.z, u_point.x)) : u_point.x;
  v_color = a_color;
}`;
export const POINT_FS = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 o;
void main() { o = vec4(v_color, 1.0); }`;
export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;
export const EDL_FS = `#version 300 es
precision highp float;
uniform sampler2D u_color, u_depth;
uniform vec2 u_nearFar;
uniform float u_radius, u_strength;
uniform bool u_edl;
out vec4 o;
float eyeDepth(float d) {
  float n = u_nearFar.x, f = u_nearFar.y, z = d * 2.0 - 1.0;
  return 2.0 * n * f / (f + n - z * (f - n));
}
float depthAt(ivec2 p) {
  return texelFetch(u_depth, clamp(p, ivec2(0), textureSize(u_depth, 0) - 1), 0).r;
}
vec2 neighbour(ivec2 p, float logDepth, vec2 dir) {
  float d0 = depthAt(p + ivec2(dir * floor(u_radius)));
  float d1 = depthAt(p + ivec2(dir * ceil(u_radius)));
  if (d0 >= ${f1(EDL.clearDepth)} || d1 >= ${f1(EDL.clearDepth)}) return vec2(0.0);
  float d = mix(d0, d1, fract(u_radius));
  return vec2(max(0.0, logDepth - log2(eyeDepth(d))), 1.0);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(u_color, p, 0);
  float d = depthAt(p);
  if (!u_edl || d >= ${f1(EDL.clearDepth)}) { o = c; return; }
  float logDepth = log2(eyeDepth(d));
  vec2 sum = vec2(0.0);
${EDL.neighbours.map(([x, y])=>`  sum += neighbour(p, logDepth, vec2(${f1(x)}, ${f1(y)}));`).join('\n')}
  float response = sum.y > 0.0 ? sum.x / sum.y : 0.0;
  o = vec4(c.rgb * exp(-response * ${f1(EDL.responseScale)} * u_strength), 1.0);
}`;
