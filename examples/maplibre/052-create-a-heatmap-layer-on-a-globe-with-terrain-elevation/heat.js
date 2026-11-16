export const ZERO = 1 / 255 / 16;
export const GAUSS_COEF = 0.3989422804014327;
export const KERNEL_K = 9;
export const kernelExtent = (w, intensity)=>Math.sqrt(-2 * Math.log(ZERO / w / intensity / GAUSS_COEF) / KERNEL_K);
export const RAMP = [
    [
        0,
        33,
        102,
        172,
        0
    ],
    [
        0.2,
        103,
        169,
        207,
        1
    ],
    [
        0.4,
        209,
        229,
        240,
        1
    ],
    [
        0.6,
        253,
        219,
        199,
        1
    ],
    [
        0.8,
        239,
        138,
        98,
        1
    ],
    [
        1,
        178,
        24,
        43,
        1
    ]
];
export const RAMP_SIZE = 256;
export function rampTexture() {
    const out = new Uint8Array(RAMP_SIZE * 4);
    for(let i = 0; i < RAMP_SIZE; i++){
        const t = i / (RAMP_SIZE - 1);
        let k = 0;
        while(k < RAMP.length - 2 && t > RAMP[k + 1][0])k++;
        const a = RAMP[k], b = RAMP[k + 1], f = (t - a[0]) / (b[0] - a[0]);
        for(let c = 0; c < 3; c++)out[4 * i + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
        out[4 * i + 3] = Math.round(255 * (a[4] + (b[4] - a[4]) * f));
    }
    return out;
}
export const radiusZoomFactor = (zoom)=>Math.min(1, 0.1 + 0.9 * Math.max(0, zoom) / 9);
export function heatLevel(kernelTexels) {
    let k = 0;
    while(k < 6 && kernelTexels / 2 ** k > 32)k++;
    return k;
}
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
export const HEAT_PERCENTILE = 0.99;
export const LOG_K = 100;
export const HIST_LOG2_MIN = -12;
export const HIST_BPO = 8;
export const HIST_BINS = 224;
export const HIST_SAMPLES_FLOAT = 1 << 18;
export const HIST_SAMPLES_HALF = 2048;
export const heatT = (d, dref, intensity)=>Math.min(1, Math.max(0, Math.log1p(LOG_K * intensity * d / dref) / Math.log1p(LOG_K)));
export function histBin(d) {
    if (!(d > 0)) return -1;
    const b = Math.floor((Math.log2(d) - HIST_LOG2_MIN) * HIST_BPO);
    return b < 0 ? -1 : Math.min(HIST_BINS - 1, b);
}
export function percentileFromHistogram(h, p) {
    let total = 0;
    for(let i = 0; i < HIST_BINS; i++)total += h[i];
    if (total <= 0) return 1;
    const target = p * total;
    let below = 0;
    for(let i = 0; i < HIST_BINS; i++){
        if (h[i] > 0 && below + h[i] >= target) return 2 ** (HIST_LOG2_MIN + (i + (target - below) / h[i]) / HIST_BPO);
        below += h[i];
    }
    return 2 ** (HIST_LOG2_MIN + HIST_BINS / HIST_BPO);
}
export function histSampling(w, h, samples) {
    const stride = Math.max(1, Math.ceil(Math.sqrt(w * h / samples)));
    return {
        stride,
        cols: Math.ceil(w / stride),
        rows: Math.ceil(h / stride)
    };
}
export const HEAT_T_GLSL = `
float heatT(float d, float dref, float intensity) {
  return clamp(log(1.0 + ${LOG_K}.0 * intensity * d / dref) / ${Math.log1p(LOG_K)}, 0.0, 1.0);
}`;
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
export const PCT_VS = `#version 300 es
void main() {
  gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0);
}`;
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
