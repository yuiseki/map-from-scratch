// GLSL, built from the constants the tests read (light.ts SHADOW_STEPS).
import { SHADOW_STEPS } from './light.ts';

// Half width of the shadow edge in tan(altitude): 0.012 ~ 0.7° of sun, a
// little wider than the real sun's 0.53° so 31 m texels do not stair-step.
export const SHADOW_SOFT = 0.012;
// Hypsometric albedo (metres, linear RGB): lowland forest to bare scoria.
// Kept pale so the light, not the tint, carries the relief (the original
// draws a white surface).
export const ALBEDO: [number, [number, number, number]][] = [
  [700, [0.30, 0.36, 0.25]], [1500, [0.34, 0.38, 0.27]], [2300, [0.45, 0.40, 0.34]], [3200, [0.55, 0.50, 0.47]], [3800, [0.70, 0.68, 0.66]],
];
export const WATER = [0.05, 0.10, 0.16], SKY = [0.16, 0.19, 0.25], SPECULAR = 1.4, SHININESS = 120;

const v3 = (c: readonly number[]) => `vec3(${c.map((x) => x.toFixed(4)).join(', ')})`;

export const fullscreenVertex = () => `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// One fragment per height texel (the render target is the grid's size; row 0
// is the grid's north row). Marches towards the light over the height field
// and keeps the steepest rise; the texel is lit when the light stands above
// it. Run only when the light or the exaggeration changes.
export const shadowFragment = () => `#version 300 es
precision highp float;
uniform highp sampler2D u_h;
uniform vec2 u_dir;
uniform float u_tanAlt, u_growth, u_cell, u_exag;
out vec4 o;
void main() {
  vec2 size = vec2(textureSize(u_h, 0));
  vec2 p0 = gl_FragCoord.xy;
  float h0 = texelFetch(u_h, ivec2(p0), 0).r, m = -1e9, s = 1.0;
  for (int k = 0; k < ${SHADOW_STEPS}; k++) {
    vec2 p = p0 + u_dir * s;
    if (p.x < 0.0 || p.y < 0.0 || p.x >= size.x || p.y >= size.y) break;
    m = max(m, (texelFetch(u_h, ivec2(p), 0).r - h0) / s);
    s *= u_growth;
  }
  o = vec4(smoothstep(-${SHADOW_SOFT}, ${SHADOW_SOFT}, u_tanAlt - m * u_exag / u_cell));
}`;

export const terrainVertex = () => `#version 300 es
precision highp float;
uniform highp sampler2D u_h;
uniform int u_nx, u_step;
uniform float u_cell, u_exag, u_href;
uniform vec3 u_eye;
uniform mat4 u_vp;
out vec2 v_uv;
out vec3 v_pos;
out float v_h;
void main() {
  ivec2 size = textureSize(u_h, 0);
  ivec2 t = min(ivec2(gl_VertexID % u_nx, gl_VertexID / u_nx) * u_step, size - 1);
  float h = texelFetch(u_h, t, 0).r;
  vec2 c = vec2(t) + 0.5;
  v_pos = vec3((c.x - float(size.x) * 0.5) * u_cell, (float(size.y) * 0.5 - c.y) * u_cell, (h - u_href) * u_exag);
  v_uv = c / vec2(size);
  v_h = h;
  gl_Position = u_vp * vec4(v_pos - u_eye, 1.0);
}`;

export const terrainFragment = () => {
  let ramp = `vec3 a = ${v3(ALBEDO[0][1])};`;
  for (let k = 1; k < ALBEDO.length; k++)
    ramp += `\n  a = mix(a, ${v3(ALBEDO[k][1])}, clamp((h - ${ALBEDO[k - 1][0].toFixed(1)}) / ${(ALBEDO[k][0] - ALBEDO[k - 1][0]).toFixed(1)}, 0.0, 1.0));`;
  return `#version 300 es
precision highp float;
uniform sampler2D u_g, u_s;
uniform vec3 u_L, u_col, u_eye;
uniform float u_exag, u_shadowOn;
in vec2 v_uv;
in vec3 v_pos;
in float v_h;
out vec4 o;
vec3 albedo(float h) {
  ${ramp}
  return a;
}
void main() {
  vec4 g = texture(u_g, v_uv);
  vec3 n = normalize(vec3(-g.x * u_exag, -g.y * u_exag, 1.0));
  bool water = g.z > 0.5;
  float lit = mix(1.0, texture(u_s, v_uv).r, u_shadowOn);
  float diff = max(dot(n, u_L), 0.0) * lit;
  vec3 c = (water ? ${v3(WATER)} : albedo(v_h)) * (${v3(SKY)} * (0.6 + 0.4 * n.z) + u_col * diff);
  if (water) {
    vec3 hv = normalize(u_L + normalize(u_eye - v_pos));
    c += u_col * ${SPECULAR.toFixed(2)} * pow(max(dot(n, hv), 0.0), ${SHININESS.toFixed(1)}) * lit;
  }
  o = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;
};
