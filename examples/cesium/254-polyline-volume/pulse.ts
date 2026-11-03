// The light pulse on each line: where its head is at a given page time.
// Computed on the CPU (one float per line per frame) and handed to the tube
// shader as a uniform; the shader only evaluates the glow about the head,
// with the same PULSE_SIGMA_KM (shaders.ts builds its source from it).

export const TIME_SCALE = 360;      // 1 s on the page = 6 min of running
export const PULSE_GAP_KM = 40;     // the pulse runs this far off each end before it wraps
export const PULSE_SIGMA_KM = 5;

export function pulseHead(tSec: number, speedKmh: number, lengthKm: number): number {
  const km = (tSec * speedKmh * TIME_SCALE) / 3600;
  return (km % (lengthKm + 2 * PULSE_GAP_KM)) - PULSE_GAP_KM;
}

export function pulseGlow(along: number, head: number): number {
  const d = (along - head) / PULSE_SIGMA_KM;
  return Math.exp(-0.5 * d * d);
}
