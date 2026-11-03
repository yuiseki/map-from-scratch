// The style of this map: the sky/fog controls of MapLibre's setSky, the
// colour relief and the CPU half of the sky and fog (uniforms). The GPU half
// is built here from the same constants, so the page and the tests read one
// table.
import { horizonY } from './camera.ts';

export interface Sky {
  enabled: boolean;
  skyColor: string; horizonColor: string; fogColor: string;
  skyHorizonBlend: number; horizonFogBlend: number; fogGroundBlend: number;
}

// The original uses #0000ff / #00ff00 / #ff0000 to make each colour's reach
// obvious; this page starts from a daylight sky over the Alps. The blends are
// the original's.
export const DEFAULT_SKY: Sky = {
  enabled: true, skyColor: '#1f5fbf', horizonColor: '#dce8f2', fogColor: '#aebfd0',
  skyHorizonBlend: 0.5, horizonFogBlend: 0.5, fogGroundBlend: 0.1,
};
// Background when the sky is disabled (MapLibre then draws nothing there and
// the page's white shows through).
export const NO_SKY = '#ffffff';

// Distance (view depth, m) where the fog reaches 1: about the edge of the
// far grid (126 km from the centre), so the data ends in the horizon colour.
export const FOG_FAR = 120000;

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

// MapLibre style/sky.ts calculateFogBlendOpacity: the fog is for views that
// show the horizon, so it fades in between pitch 60 and 70.
export function fogOpacity(pitch: number): number {
  if (pitch < 60) return 0;
  if (pitch < 70) return (pitch - 60) / 10;
  return 1;
}

export interface SkyUniforms {
  sky: [number, number, number]; horizon: [number, number, number]; fog: [number, number, number];
  horizonFrag: number;      // horizon row in gl_FragCoord.y (device px from the bottom)
  skyBlendPx: number;       // sky-horizon-blend * half the height, device px (MapLibre sky_program)
  fogNear: number; fogFar: number; fogOpacity: number;
  horizonFogBlend: number; fogGroundBlend: number;
}

// heightCss: canvas height in CSS px; dpr: device pixels per CSS px;
// centreDistance: eye to target, m (the fog's near plane, as MapLibre's
// fog matrix puts its near plane at the map centre).
export function skyUniforms(s: Sky, pitch: number, heightCss: number, dpr: number, centreDistance: number): SkyUniforms {
  return {
    sky: hexToRgb(s.skyColor), horizon: hexToRgb(s.horizonColor), fog: hexToRgb(s.fogColor),
    horizonFrag: (heightCss - horizonY(pitch, heightCss)) * dpr,
    skyBlendPx: s.skyHorizonBlend * (heightCss / 2) * dpr,
    fogNear: centreDistance, fogFar: Math.max(FOG_FAR, centreDistance * 1.5),
    fogOpacity: s.enabled ? fogOpacity(pitch) : 0,
    horizonFogBlend: s.horizonFogBlend, fogGroundBlend: s.fogGroundBlend,
  };
}

// Colour relief: [metres, colour]. Sea level (Mapterhorn has no
// bathymetry: the sea is exactly 0 m) gets the first colour.
export const RELIEF: [number, string][] = [
  [0, '#7f9fb8'], [2, '#a3b98a'], [500, '#7fa463'], [1200, '#557f45'], [1900, '#6f7d4f'],
  [2400, '#8f8573'], [2800, '#b0a99f'], [3200, '#f4f4f2'],
];
// MapLibre's hillshade-shadow-color in the original
export const SHADOW = '#473b24';
// Sun from the north-west (MapLibre hillshade-illumination-direction 335),
// 45 degrees up
export const SUN = (() => {
  const a = (335 * Math.PI) / 180, e = Math.PI / 4;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
})();

const vec3 = (hex: string) => `vec3(${hexToRgb(hex).map((v) => v.toFixed(4)).join(', ')})`;

export function reliefGlsl(): string {
  let s = `vec3 relief(float h) {\n  vec3 c = ${vec3(RELIEF[0][1])};\n`;
  for (let i = 1; i < RELIEF.length; i++) {
    s += `  c = mix(c, ${vec3(RELIEF[i][1])}, smoothstep(${RELIEF[i - 1][0].toFixed(1)}, ${RELIEF[i][0].toFixed(1)}, h));\n`;
  }
  return s + '  return c;\n}\n' +
    `const vec3 SHADOW = ${vec3(SHADOW)};\nconst vec3 SUN = vec3(${SUN.map((v) => v.toFixed(5)).join(', ')});\n`;
}

// MapLibre's v_fog_depth: z/w of a perspective whose near plane is the map
// centre and far plane FOG_FAR, mapped to 0..1, for view depth d.
export const fogDepthGlsl =
  'float fogDepth(float d) { return clamp(u_fog_far * (d - u_fog_near) / ((u_fog_far - u_fog_near) * d), 0.0, 1.0); }\n';
