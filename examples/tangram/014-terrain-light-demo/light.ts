// The light: a direction (azimuth clockwise from north, altitude above the
// horizon), its colour, and the day cycle that the Sun toggle plays.
import { sunColor, type RGB } from './look.ts';
export type { RGB };

export const lightDir = (az: number, alt: number): [number, number, number] =>
  [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];

// One day takes SUN_DAY_MS: sunrise in the east (az 90°), noon in the south
// at SUN_MAX_ALT, sunset in the west. Like the original's DEMO mode the
// light's colour changes with the time of day (look.ts sunColor); it stays
// 1° above the horizon so the terrain is never unlit.
export const SUN_DAY_MS = 20000, SUN_MAX_ALT = (55 * Math.PI) / 180;

export function sunAt(phase: number): { az: number; alt: number; color: RGB } {
  const alt = Math.max(Math.PI / 180, SUN_MAX_ALT * Math.sin(Math.PI * phase));
  return { az: Math.PI / 2 + Math.PI * phase, alt, color: sunColor(alt) };
}

export const sunPhase = (now: number, start: number, startPhase: number, day = SUN_DAY_MS): number =>
  (((startPhase + (now - start) / day) % 1) + 1) % 1;

// Cast shadows march from each texel towards the light: step k is growth^k
// texels out, so SHADOW_STEPS steps reach maxDist (the grid's diagonal) with
// fine steps near the texel, where small ridges matter, and coarse ones far
// away, where only big mountains can still reach above the sun.
export const SHADOW_STEPS = 96;
export const marchGrowth = (steps: number, maxDist: number): number => maxDist ** (1 / (steps - 1));
