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
// u_radius is the radius in area uv (x, y). Accumulated at intensity 1:
// intensity is applied when the density is coloured (heatT), so the slider
// does not re-accumulate and does not move the percentile it is measured against.
export const ACCUM_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_uv;
uniform vec2 u_radius;
out vec2 v_extrude;
void main() {
  v_extrude = ${kernelExtent(1, 1)} * a_corner;
  vec2 p = a_uv + v_extrude * u_radius;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const ACCUM_FS = `#version 300 es
precision highp float;
in vec2 v_extrude;
out vec4 o;
void main() {
  float d = -0.5 * ${KERNEL_K}.0 * dot(v_extrude, v_extrude);
  o = vec4(${GAUSS_COEF} * exp(d), 0.0, 0.0, 1.0);
}`;

// ---- Density to ramp position -------------------------------------------
// MapLibre colours clamp(intensity * density). With 23,306 sightings packed
// into a few towns that saturates: at the opening view 24% of the heat pixels
// were in the hot end (density >= 0.8), the plains one red. Here the density
// is first divided by a high percentile of the accumulated density (Dref, the
// HEAT_PERCENTILE of the texels with heat, measured on the GPU from a log2
// histogram, so it follows the radius, the zoom and the year filter), then
// passed through a log: t = log(1 + K x) / log(1 + K), x = intensity * d / Dref.
// At intensity 1 only the texels above the percentile reach the top colour;
// a valley with a few dozen sightings sits mid-ramp and one sighting stays a
// faint blue. Intensity still multiplies the density, as in MapLibre.
export const HEAT_PERCENTILE = 0.99;
export const LOG_K = 100;
// Histogram: HIST_BPO bins per octave from 2^HIST_LOG2_MIN (just under ZERO,
// the kernel cut-off, so every drawn texel counts and an empty one does not).
export const HIST_LOG2_MIN = -12;
export const HIST_BPO = 8;
export const HIST_BINS = 224;                 // 28 octaves: up to 65536
// Texels sampled per histogram: a float32 target counts exactly; a half-float
// one (no EXT_float_blend) only up to 2048, so it samples fewer.
export const HIST_SAMPLES_FLOAT = 1 << 18;
export const HIST_SAMPLES_HALF = 2048;

/** Ramp position (0..1) of an accumulated density. */
export const heatT = (d: number, dref: number, intensity: number): number =>
  Math.min(1, Math.max(0, Math.log1p((LOG_K * intensity * d) / dref) / Math.log1p(LOG_K)));

/** Histogram bin of a density, -1 for no heat. */
export function histBin(d: number): number {
  if (!(d > 0)) return -1;
  const b = Math.floor((Math.log2(d) - HIST_LOG2_MIN) * HIST_BPO);
  return b < 0 ? -1 : Math.min(HIST_BINS - 1, b);
}

/** The density at quantile p of a histogram, interpolated in log2 inside its bin; 1 when empty. */
export function percentileFromHistogram(h: ArrayLike<number>, p: number): number {
  let total = 0;
  for (let i = 0; i < HIST_BINS; i++) total += h[i];
  if (total <= 0) return 1;
  const target = p * total;
  let below = 0;
  for (let i = 0; i < HIST_BINS; i++) {
    if (h[i] > 0 && below + h[i] >= target) return 2 ** (HIST_LOG2_MIN + (i + (target - below) / h[i]) / HIST_BPO);
    below += h[i];
  }
  return 2 ** (HIST_LOG2_MIN + HIST_BINS / HIST_BPO);
}

/** Grid of texels the histogram samples in a w x h accumulation: every stride-th, centred. */
export function histSampling(w: number, h: number, samples: number): { stride: number; cols: number; rows: number } {
  const stride = Math.max(1, Math.ceil(Math.sqrt((w * h) / samples)));
  return { stride, cols: Math.ceil(w / stride), rows: Math.ceil(h / stride) };
}

/** GLSL twin of heatT, for the terrain shader. */
export const HEAT_T_GLSL = `
float heatT(float d, float dref, float intensity) {
  return clamp(log(1.0 + ${LOG_K}.0 * intensity * d / dref) / ${Math.log1p(LOG_K)}, 0.0, 1.0);
}`;

// One point per sampled texel into its log2 bin (additive blend into a
// HIST_BINS x 1 target). Texels without heat fall outside the clip volume.
export const HIST_VS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_heat;
uniform ivec2 u_size;
uniform int u_stride, u_cols;
void main() {
  ivec2 p = ivec2(gl_VertexID % u_cols, gl_VertexID / u_cols) * u_stride + u_stride / 2;
  p = min(p, u_size - 1);
  float d = texelFetch(u_heat, p, 0).r;
  float b = d > 0.0 ? floor((log2(d) - ${HIST_LOG2_MIN}.0) * ${HIST_BPO}.0) : -1.0;
  gl_PointSize = 1.0;
  gl_Position = b < 0.0 ? vec4(2.0, 2.0, 0.0, 1.0) : vec4((min(b, ${HIST_BINS}.0 - 1.0) + 0.5) / ${HIST_BINS}.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);
}`;

export const HIST_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(1.0, 0.0, 0.0, 1.0); }`;

// Full-screen triangle for the 1 x 1 percentile pass.
export const PCT_VS = `#version 300 es
void main() {
  gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0);
}`;

/** GLSL twin of percentileFromHistogram, written to a 1 x 1 float target. */
export const PCT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_hist;
out vec4 o;
void main() {
  float total = 0.0;
  for (int i = 0; i < ${HIST_BINS}; i++) total += texelFetch(u_hist, ivec2(i, 0), 0).r;
  float r = 1.0;
  if (total > 0.0) {
    float target = ${HEAT_PERCENTILE} * total, below = 0.0;
    r = exp2(${HIST_LOG2_MIN}.0 + ${HIST_BINS}.0 / ${HIST_BPO}.0);
    for (int i = 0; i < ${HIST_BINS}; i++) {
      float h = texelFetch(u_hist, ivec2(i, 0), 0).r;
      if (h > 0.0 && below + h >= target) { r = exp2(${HIST_LOG2_MIN}.0 + (float(i) + (target - below) / h) / ${HIST_BPO}.0); break; }
      below += h;
    }
  }
  o = vec4(r, 0.0, 0.0, 1.0);
}`;
