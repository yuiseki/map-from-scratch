// Building colour by height, and the background colours. The fragment
// shader's ramp() is generated from STOPS (rampGlsl), the legend from the
// same table (rampCss): one table, no second copy of the logic.
//
// Ramp (height of the building's top above its base, linear between stops):
//   0 m pale stone, 12 m sand, 30 m orange, 80 m red, 150 m magenta, 250 m+ purple.
// Luminance falls with height, so tall towers read dark and saturated.
export type RGB = [number, number, number];

export const STOPS: [number, RGB][] = [
  [0, [214, 208, 196]],
  [12, [236, 196, 120]],
  [30, [238, 146, 78]],
  [80, [212, 80, 74]],
  [150, [166, 48, 120]],
  [250, [98, 40, 140]],
];

export const SKY: RGB = [118, 168, 222];     // at the horizon; the zenith is darker
export const LAND: RGB = [96, 120, 84];
export const OCEAN: RGB = [28, 58, 92];

const f3 = (v: number) => (v / 255).toFixed(4);
export const vec3Of = (c: RGB): string => `vec3(${f3(c[0])}, ${f3(c[1])}, ${f3(c[2])})`;
export const rgbOf = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;

export function rampGlsl(): string {
  const lines = [`vec3 ramp(float h) {`, `  vec3 c = ${vec3Of(STOPS[0][1])};`];
  for (let i = 1; i < STOPS.length; i++) {
    const h0 = STOPS[i - 1][0], span = STOPS[i][0] - h0;
    lines.push(`  c = mix(c, ${vec3Of(STOPS[i][1])}, clamp((h - ${h0.toFixed(1)}) / ${span.toFixed(1)}, 0.0, 1.0));`);
  }
  lines.push('  return c;', '}');
  return lines.join('\n');
}

export function rampCss(max: number): string {
  return `linear-gradient(to right, ${STOPS.map(([h, c]) => `${rgbOf(c)} ${(Math.min(h, max) / max * 100).toFixed(1)}%`).join(', ')})`;
}

// The ramp colour for a height, for the bench to compare screen pixels
// against what the shader was asked to draw.
export function rampAt(h: number): RGB {
  let c: number[] = STOPS[0][1].slice();
  for (let i = 1; i < STOPS.length; i++) {
    const t = Math.min(1, Math.max(0, (h - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0])));
    c = c.map((v, k) => v + (STOPS[i][1][k] - v) * t);
  }
  return c as RGB;
}
