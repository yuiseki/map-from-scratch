import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZERO, GAUSS_COEF, KERNEL_K, kernelExtent, rampTexture, RAMP, RAMP_SIZE, radiusZoomFactor, heatLevel, ACCUM_FS, ACCUM_VS,
  HEAT_PERCENTILE, LOG_K, HIST_LOG2_MIN, HIST_BPO, HIST_BINS, histBin, percentileFromHistogram, heatT, histSampling,
  HEAT_T_GLSL, HIST_VS, PCT_FS,
} from './heat.ts';

test('the kernel falls to ZERO exactly at the edge of the quad the vertex shader draws', () => {
  for (const [w, i] of [[1, 1], [1, 3], [0.2, 0.5]]) {
    const s = kernelExtent(w, i);
    const atEdge = w * i * GAUSS_COEF * Math.exp(-0.5 * KERNEL_K * s * s);
    assert.ok(Math.abs(atEdge - ZERO) < 1e-12, `${atEdge}`);
  }
  assert.ok(kernelExtent(1, 3) > kernelExtent(1, 1), 'a stronger point reaches further');
});

test('the accumulation shaders are built from the same constants', () => {
  assert.ok(ACCUM_VS.includes(String(kernelExtent(1, 1))) && ACCUM_FS.includes(String(GAUSS_COEF)));
  assert.ok(ACCUM_FS.includes(String(GAUSS_COEF)) && ACCUM_FS.includes(String(KERNEL_K)));
});

test('the colour ramp texture starts transparent and ends at the original top colour', () => {
  const t = rampTexture();
  assert.equal(t.length, RAMP_SIZE * 4);
  assert.equal(t[3], 0, 'density 0 is transparent');
  assert.deepEqual([...t.subarray(t.length - 4)], [178, 24, 43, 255]);
  // Density 0.6 is the original's rgb(253,219,199).
  const k = Math.round(0.6 * (RAMP_SIZE - 1)) * 4;
  assert.ok(Math.abs(t[k] - 253) <= 2 && Math.abs(t[k + 1] - 219) <= 2 && t[k + 3] === 255);
  assert.equal(RAMP[0][0], 0);
  assert.equal(RAMP[RAMP.length - 1][0], 1);
});

test('radius follows the original zoom curve: 2 px at zoom 0 to 20 px at zoom 9 for the default 20', () => {
  assert.ok(Math.abs(20 * radiusZoomFactor(0) - 2) < 1e-9);
  assert.ok(Math.abs(20 * radiusZoomFactor(9) - 20) < 1e-9);
  assert.equal(radiusZoomFactor(12), 1);
});

test('the accumulation level halves the target until the kernel spans at most 32 texels', () => {
  assert.equal(heatLevel(10), 0);
  assert.equal(heatLevel(32), 0);
  assert.equal(heatLevel(64), 1);
  assert.equal(heatLevel(64.5), 2);
  assert.equal(heatLevel(300), 4);
  assert.equal(heatLevel(1e9), 6);
});

// Histogram of the accumulated density at the opening view (zoom 8.7, radius 15, all 23,306
// sightings, 2048 x 2730 texels), [bin, texels] in the histBin bins. Made from data/baked by
// accumulating the same kernel on the CPU; kept here because CI has no data.
const OPENING: [number, number][] = [[0,3011],[1,2933],[2,2776],[3,2601],[4,2505],[5,2387],[6,2232],[7,2104],[8,2232],[9,2597],[10,2723],[11,2700],[12,2712],[13,2796],[14,2933],[15,2987],[16,3072],[17,3114],[18,3157],[19,3261],[20,3325],[21,3374],[22,3378],[23,3478],[24,3595],[25,3586],[26,3731],[27,3810],[28,3826],[29,3943],[30,4011],[31,4138],[32,4051],[33,4219],[34,4202],[35,4552],[36,4360],[37,4478],[38,4640],[39,4740],[40,4753],[41,4876],[42,5060],[43,5125],[44,5103],[45,5379],[46,5404],[47,5531],[48,5611],[49,5802],[50,5963],[51,5976],[52,5965],[53,6278],[54,6427],[55,6465],[56,6469],[57,6806],[58,6927],[59,7004],[60,7248],[61,7253],[62,7621],[63,7655],[64,7961],[65,8143],[66,8351],[67,8743],[68,8928],[69,9215],[70,9307],[71,9812],[72,9876],[73,10325],[74,10652],[75,11045],[76,11543],[77,11797],[78,12407],[79,12967],[80,13389],[81,14181],[82,14850],[83,15140],[84,16365],[85,16686],[86,16571],[87,16631],[88,17063],[89,17428],[90,17935],[91,18810],[92,19429],[93,19403],[94,19760],[95,20081],[96,20601],[97,21334],[98,21640],[99,22072],[100,22224],[101,22506],[102,22584],[103,22766],[104,22302],[105,22064],[106,22043],[107,21485],[108,20334],[109,20236],[110,20063],[111,19555],[112,19000],[113,19287],[114,18510],[115,18269],[116,17424],[117,16508],[118,16033],[119,15144],[120,13374],[121,12743],[122,11812],[123,10852],[124,10190],[125,9188],[126,8776],[127,7514],[128,5850],[129,4745],[130,3562],[131,2983],[132,2680],[133,2339],[134,2196],[135,1969],[136,1665],[137,1300],[138,1148],[139,928],[140,668],[141,611],[142,566],[143,490],[144,480],[145,516],[146,565],[147,437],[148,209],[149,263],[150,6]];

const bandsOf = (hist: ArrayLike<number>, t: (d: number) => number) => {
  const bands = [0, 0, 0, 0, 0];
  let n = 0;
  for (let i = 0; i < HIST_BINS; i++) {
    if (!hist[i]) continue;
    const v = t(2 ** (HIST_LOG2_MIN + (i + 0.5) / HIST_BPO));
    if (v < 0.05) continue;                 // transparent end of the ramp
    n += hist[i];
    bands[Math.min(4, Math.floor(v * 5))] += hist[i];
  }
  return bands.map((b) => b / n);
};

test('at the opening view only a small share of the heat reaches the hot end, where clamping saturated', () => {
  const hist = new Float64Array(HIST_BINS);
  for (const [i, n] of OPENING) hist[i] = n;
  // The old mapping, clamp(0.2 * density), the original's default with intensity 0.2.
  const old = bandsOf(hist, (d) => Math.min(1, 0.2 * d));
  assert.ok(old[4] > 0.2, `old hot end ${old[4].toFixed(3)} (the saturation this guards against)`);
  const dref = percentileFromHistogram(hist, HEAT_PERCENTILE);
  const now = bandsOf(hist, (d) => heatT(d, dref, 1));
  assert.ok(now[4] < 0.1, `hot end ${now[4].toFixed(3)}`);
  for (const b of now) assert.ok(b > 0.05, `every fifth of the ramp is used: ${now.map((x) => x.toFixed(2))}`);
});

// A small field with a town of hundreds of sightings, a valley of a few dozen, one isolated
// sighting and an empty place. Same kernel as the GPU (radius 6 texels).
function field(): { d: Float32Array; at: Record<string, number> } {
  const N = 256, R = 6, d = new Float32Array(N * N);
  const add = (x: number, y: number) => {
    for (let j = Math.max(0, Math.floor(y - 2 * R)); j <= Math.min(N - 1, y + 2 * R); j++)
      for (let i = Math.max(0, Math.floor(x - 2 * R)); i <= Math.min(N - 1, x + 2 * R); i++) {
        const q = ((i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2) / (R * R);
        const v = GAUSS_COEF * Math.exp(-0.5 * KERNEL_K * q);
        if (v >= ZERO) d[j * N + i] += v;
      }
  };
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const g = () => rnd() + rnd() + rnd() - 1.5;
  const cluster = (x: number, y: number, n: number, spread: number) => { for (let k = 0; k < n; k++) add(x + g() * spread, y + g() * spread); };
  cluster(40, 40, 700, 24);                                         // the town
  cluster(200, 50, 400, 24);
  cluster(120, 30, 300, 24);
  for (let k = 0; k < 12; k++) cluster(20 + 18 * k, 150, 40, 18);  // a valley
  for (let k = 0; k < 120; k++) add(rnd() * 256, 180 + rnd() * 76); // scattered single sightings
  add(128.5, 100.5);                                                // one isolated sighting
  const at = (x: number, y: number) => d[Math.floor(y) * N + Math.floor(x)];
  return { d, at: { town: at(40, 40), valley: at(56, 150), single: at(128.5, 100.5), empty: at(128, 90) } };
}

test('town, valley, a single sighting and an empty place get distinct places on the ramp', () => {
  const { d, at } = field();
  const h = new Float64Array(HIST_BINS);
  for (const v of d) { const b = histBin(v); if (b >= 0) h[b]++; }
  const dref = percentileFromHistogram(h, HEAT_PERCENTILE);
  const t = (v: number) => heatT(v, dref, 1);
  assert.ok(t(at.town) >= 0.95, `town ${t(at.town)}`);
  assert.ok(t(at.valley) < t(at.town) - 0.15, `valley ${t(at.valley)} below the town`);
  assert.ok(t(at.single) > 0.1 && t(at.single) < t(at.valley) - 0.15, `a single sighting ${t(at.single)} stays visible but low`);
  assert.equal(t(at.empty), 0);
});

test('intensity still scales the density as in MapLibre: more intensity, hotter, never past the top', () => {
  const dref = 20;
  for (const v of [0.05, 1, 5, 9]) {
    assert.ok(heatT(v, dref, 2) > heatT(v, dref, 1) && heatT(v, dref, 1) > heatT(v, dref, 0.5), `${v}`);
  }
  assert.equal(heatT(dref, dref, 1), 1);
  assert.equal(heatT(1e6, dref, 5), 1);
  assert.equal(heatT(0, dref, 5), 0);
});

test('the histogram bins in log2 from the kernel cut-off and the percentile reads back from it', () => {
  assert.equal(histBin(0), -1);
  assert.equal(histBin(ZERO / 2), -1, 'below the kernel cut-off is not heat');
  assert.ok(histBin(ZERO * 1.01) >= 0);
  assert.equal(histBin(2 ** HIST_LOG2_MIN), 0);
  assert.equal(histBin(2 ** (HIST_LOG2_MIN + 1)), HIST_BPO);
  assert.equal(histBin(1e9), HIST_BINS - 1);
  const h = new Float64Array(HIST_BINS);
  h[histBin(1)] = 98; h[histBin(64)] = 2;
  const p = percentileFromHistogram(h, 0.99);
  assert.ok(p > 64 * 0.99 && p < 64 * 2 ** (1 / HIST_BPO) * 1.01, `${p}`);
  assert.ok(Math.abs(percentileFromHistogram(h, 0.5) / 1 - 1) < 2 ** (1 / HIST_BPO), 'median in the bin of 1');
  assert.equal(percentileFromHistogram(new Float64Array(HIST_BINS), 0.99), 1, 'no heat: any scale');
});

test('the histogram samples at most its budget of texels and covers the whole accumulated part', () => {
  for (const [w, h, n] of [[2048, 2730, 1 << 18], [2048, 2730, 2048], [64, 86, 1 << 18], [1, 1, 2048]]) {
    const s = histSampling(w, h, n);
    assert.ok(s.cols * s.rows <= n || s.stride === 1, `${w}x${h}`);
    assert.ok((s.cols - 1) * s.stride < w && s.cols * s.stride >= w && s.rows * s.stride >= h);
  }
});

test('the GPU passes are built from the same transfer constants', () => {
  assert.ok(HEAT_T_GLSL.includes(String(LOG_K)) && HEAT_T_GLSL.includes(Math.log1p(LOG_K).toString()));
  assert.ok(HIST_VS.includes(String(HIST_LOG2_MIN)) && HIST_VS.includes(`${HIST_BPO}.0`) && HIST_VS.includes(`${HIST_BINS}.0`));
  assert.ok(PCT_FS.includes(String(HEAT_PERCENTILE)) && PCT_FS.includes(String(HIST_BINS)));
});
