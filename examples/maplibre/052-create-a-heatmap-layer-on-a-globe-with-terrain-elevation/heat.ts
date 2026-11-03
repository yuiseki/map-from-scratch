// The heatmap: a Gaussian kernel per sighting accumulated with additive
// blending into a half-float texture laid over the terrain area, then mapped
// through the colour ramp where the terrain is drawn. Because the density
// lives in the area's own coordinates and is sampled by the terrain's
// fragment shader, it lies on the mesh: ridges and valleys bend it.
//
// Kernel and constants adapted from MapLibre GL JS
// src/shaders/glsl/heatmap.vertex.glsl and heatmap.fragment.glsl
// (BSD-3-Clause): val = weight * intensity * GAUSS_COEF * exp(-0.5 * 9 * d^2),
// d in units of the radius, drawn on a quad that ends where val = ZERO.

export const ZERO = 1 / 255 / 16;
export const GAUSS_COEF = 0.3989422804014327;
export const KERNEL_K = 9;          // 3.0 * 3.0

/** Half-width of the kernel quad in radii, for one point of weight w. */
export const kernelExtent = (w: number, intensity: number): number =>
  Math.sqrt(-2 * Math.log(ZERO / w / intensity / GAUSS_COEF) / KERNEL_K);

// heatmap-color of the original, density 0..1.
export const RAMP: [number, number, number, number, number][] = [
  [0, 33, 102, 172, 0],
  [0.2, 103, 169, 207, 1],
  [0.4, 209, 229, 240, 1],
  [0.6, 253, 219, 199, 1],
  [0.8, 239, 138, 98, 1],
  [1, 178, 24, 43, 1],
];
export const RAMP_SIZE = 256;

/** RGBA8 (not premultiplied) ramp texture, one texel per density step. */
export function rampTexture(): Uint8Array {
  const out = new Uint8Array(RAMP_SIZE * 4);
  for (let i = 0; i < RAMP_SIZE; i++) {
    const t = i / (RAMP_SIZE - 1);
    let k = 0;
    while (k < RAMP.length - 2 && t > RAMP[k + 1][0]) k++;
    const a = RAMP[k], b = RAMP[k + 1], f = (t - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) out[4 * i + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
    out[4 * i + 3] = Math.round(255 * (a[4] + (b[4] - a[4]) * f));
  }
  return out;
}

/** The original's heatmap-radius curve, 2 at zoom 0 to 20 at zoom 9, as a factor on the slider. */
export const radiusZoomFactor = (zoom: number): number => Math.min(1, 0.1 + (0.9 * Math.max(0, zoom)) / 9);

/** Accumulate at 1/2^level of full size so a kernel spans at most 32 texels (cost stays flat at low zoom). */
export function heatLevel(kernelTexels: number): number {
  let k = 0;
  while (k < 6 && kernelTexels / 2 ** k > 32) k++;
  return k;
}

// Instanced quads: a_corner in [-1, 1], a_uv the point (u16 normalised).
// u_radius is the radius in area uv (x, y), u_scale maps uv to the level's
// part of the texture in clip space.
export const ACCUM_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_uv;
uniform vec2 u_radius;
uniform float u_intensity;
out vec2 v_extrude;
void main() {
  float S = sqrt(-2.0 * log(${ZERO} / u_intensity / ${GAUSS_COEF}) / ${KERNEL_K}.0);
  v_extrude = S * a_corner;
  vec2 p = a_uv + v_extrude * u_radius;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const ACCUM_FS = `#version 300 es
precision highp float;
uniform float u_intensity;
in vec2 v_extrude;
out vec4 o;
void main() {
  float d = -0.5 * ${KERNEL_K}.0 * dot(v_extrude, v_extrude);
  o = vec4(u_intensity * ${GAUSS_COEF} * exp(d), 0.0, 0.0, 1.0);
}`;
