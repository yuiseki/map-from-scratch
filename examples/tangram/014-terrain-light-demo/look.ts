// The look of the page in one place: the opening camera, light and height
// exaggeration, the hypsometric colour ramp, the sky and the haze. shaders.ts
// builds its GLSL from these numbers, main.ts and bench.ts start from them,
// and look.test.ts checks them, so the three cannot drift apart.
// Colours are linear RGB; the shaders apply gamma 2.2 at the end.
import type { Cam } from './camera.ts';
import { lonLatToTexel, texelToLocal, type GridMeta } from './grid.ts';

export type RGB = [number, number, number];
const RAD = Math.PI / 180;

// The opening view. The camera stands north-north-east of Fuji over the Fuji
// Five Lakes, low enough (tilt 12°) that the horizon and the sky are in the
// frame and Fuji rises against them (the summit stands about 240 px above
// its 1,000 m foot at 1280x800; the old view, 52 km out and 32° down, gave
// 75 px and no horizon). The target is on Fuji's north foot, 2 km north of
// the summit, VIEW.targetH metres above sea level before exaggeration.
export const VIEW = {
  lon: 138.735, lat: 35.38, targetH: 1000,
  bearing: 200 * RAD, tilt: 12 * RAD, dist: 25000, fovy: 38 * RAD,
};
// Heights are exaggerated by EXAG at load (the slider keeps 1 to 3); the
// panel says so.
export const EXAG = 2;
// The opening light: a late-afternoon sun in the west-north-west, 8° above
// the horizon, from the right of the opening view: the west flank glows,
// the east flank is in shade, and the ridges in front throw long shadows
// across the screen (Fuji's own reaches 2,770 m x 2 / tan 8° = 39 km).
export const LIGHT = { az: 295 * RAD, alt: 8 * RAD };

// Light colour by altitude: reddish near the horizon, white above 25°. Used
// by the Sun toggle and by the pointer-driven light alike.
const SUN_LOW: RGB = [1.0, 0.5, 0.25], SUN_HIGH: RGB = [1.0, 0.97, 0.9];
export function sunColor(alt: number): RGB {
  const k = Math.min(1, Math.max(0, alt / (25 * RAD)));
  return SUN_LOW.map((v, i) => v + (SUN_HIGH[i] - v) * k) as RGB;
}
// Direct sunlight is brighter than the sky light (an irradiance factor).
export const SUN_INTENSITY = 1.5;

// Hypsometric tint (a colour per height above sea level, not land cover):
// green lowland forest, olive at 1,500 m, the brown scoria of Fuji's upper
// slopes from 2,300 m, and white above 3,300 m. The summit texel of the z11
// grid is 3,769.8 m.
export const ALBEDO: [number, RGB][] = [
  [400, [0.07, 0.17, 0.05]],
  [1000, [0.11, 0.21, 0.07]],
  [1600, [0.20, 0.22, 0.10]],
  [2300, [0.27, 0.17, 0.10]],
  [2900, [0.32, 0.22, 0.15]],
  [3300, [0.70, 0.70, 0.72]],
  [3600, [0.90, 0.91, 0.94]],
];
// The same ramp as the shader's albedo(): linear between stops, clamped.
export function albedoAt(h: number): RGB {
  let a = ALBEDO[0][1];
  for (let k = 1; k < ALBEDO.length; k++) {
    const t = Math.min(1, Math.max(0, (h - ALBEDO[k - 1][0]) / (ALBEDO[k][0] - ALBEDO[k - 1][0])));
    a = a.map((v, i) => v + (ALBEDO[k][1][i] - v) * t) as RGB;
  }
  return a;
}
export const WATER: RGB = [0.03, 0.07, 0.13], SPECULAR = 1.4, SHININESS = 120;

// Sky: ZENITH overhead, HORIZON at and below the horizon, tinted towards
// the light's colour by SKY_TINT (a low red sun makes a warm horizon), and a
// glow around the sun. The terrain's haze fades to the same horizon colour,
// so the far edge of the 40 x 32 km block melts into the sky instead of
// ending in a hard line.
export const ZENITH: RGB = [0.07, 0.16, 0.42], HORIZON: RGB = [0.62, 0.66, 0.74], SKY_TINT = 0.45;
export const SKY_EXPONENT = 0.45;          // horizon-to-zenith blend: (elevation sine)^SKY_EXPONENT
export const GLOW = 0.8, GLOW_POWER = 24;   // sun glow: GLOW * cos(angle to the sun)^GLOW_POWER
export function horizonColor(light: RGB): RGB {
  return HORIZON.map((v, i) => v * (1 - SKY_TINT + SKY_TINT * light[i])) as RGB;
}
// Sky colour (without the sun glow) for a view direction whose elevation
// above the horizon has sine s.
export function skyAt(s: number, light: RGB): RGB {
  const hz = horizonColor(light), k = Math.max(0, s) ** SKY_EXPONENT;
  return hz.map((v, i) => v + (ZENITH[i] - v) * k) as RGB;
}
// Ambient light from the sky on the terrain, by normal z (a flat surface
// sees the whole sky, a vertical one half).
export const AMBIENT: RGB = [0.16, 0.19, 0.25];
// Haze: none up to HAZE_BEYOND metres past the camera's target (so whatever
// the camera looks at stays clear at any zoom), then approaching HAZE_MAX
// with scale HAZE_SCALE. In the opening view (target 25 km out) the summit is
// clear and the far edge of the block, 45 to 50 km out, is about 40% sky.
// An absolute start (30 km from the eye) washed out the whole block when
// zoomed out to 70 km.
export const HAZE_BEYOND = 5000, HAZE_SCALE = 25000, HAZE_MAX = 0.85;
export const hazeAt = (d: number, camDist: number): number =>
  HAZE_MAX * (1 - Math.exp(-Math.max(0, d - camDist - HAZE_BEYOND) / HAZE_SCALE));

// sRGB-ish output (gamma 2.2, as the shaders) and its luminance in 0..255,
// for the checks that compare screen pixels with these colours.
export const toScreen = (c: RGB): RGB => c.map((v) => 255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2)) as RGB;
export const luminance = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// The opening camera for a grid: target at VIEW's lon/lat, at VIEW.targetH
// above sea level (exaggerated like the terrain, which starts at hRef).
export function openingCam(g: Pick<GridMeta, 'w' | 'h' | 'z' | 'x0' | 'y0' | 'cell'>, hRef: number, exag = EXAG): Cam {
  const t = lonLatToTexel(VIEW.lon, VIEW.lat, g), p = texelToLocal(t.i, t.j, g);
  return { tx: p.x, ty: p.y, tz: (VIEW.targetH - hRef) * exag, bearing: VIEW.bearing, tilt: VIEW.tilt, dist: VIEW.dist, fovy: VIEW.fovy };
}
