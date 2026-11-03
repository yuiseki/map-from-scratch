// Bake-time glow texture from populated places. This is not satellite night
// imagery: each GeoNames populated place adds a Gaussian whose weight and
// width grow with its population, so the picture is "where people live",
// drawn as light.

export interface Place { lon: number; lat: number; pop: number }

const RAD = Math.PI / 180;

/** Accumulate the places into an equirectangular float image (x from lon -180, y from lat 90). */
export function splatLights(places: readonly Place[], width: number, height: number): Float32Array {
  const acc = new Float32Array(width * height);
  const pxDeg = width / 360;
  for (const { lon, lat, pop } of places) {
    if (!(pop > 0) || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const weight = Math.pow(pop, 0.6) / 1000;
    // Sigma 6 km for a place of 1,000 people, 42 km for 10 million.
    const sigmaKm = 6 + 9 * Math.max(0, Math.log10(pop / 1000));
    const sy = Math.max(0.5, sigmaKm / 111.32 * pxDeg);
    const sx = sy / Math.max(0.05, Math.cos(lat * RAD));
    const cx = (lon + 180) * pxDeg - 0.5, cy = (90 - lat) / 180 * height - 0.5;
    const rx = Math.ceil(3 * sx), ry = Math.ceil(3 * sy);
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(height - 1, Math.ceil(cy + ry)); y++) {
      const gy = Math.exp(-0.5 * ((y - cy) / sy) ** 2);
      for (let xi = Math.floor(cx - rx); xi <= Math.ceil(cx + rx); xi++) {
        const g = gy * Math.exp(-0.5 * ((xi - cx) / sx) ** 2);
        if (g < 1e-4) continue;
        const x = ((xi % width) + width) % width;
        acc[y * width + x] += weight * g;
      }
    }
  }
  return acc;
}

/** The q-quantile of the nonzero values. */
export function percentile(acc: Float32Array, q: number): number {
  const values = Array.from(acc).filter((v) => v > 0).sort((a, b) => a - b);
  if (!values.length) return 1;
  return values[Math.min(values.length - 1, Math.floor(q * values.length))];
}

/**
 * 8-bit glow: 1 - exp(-acc / scale) compresses the range, and the square root
 * keeps faint towns above zero (the shader squares it back).
 */
export function encodeLights(acc: Float32Array, scale: number): Uint8Array {
  const out = new Uint8Array(acc.length);
  for (let i = 0; i < acc.length; i++) {
    const v = 1 - Math.exp(-acc[i] / scale);
    out[i] = Math.min(255, Math.ceil(Math.sqrt(v) * 255));
  }
  return out;
}
