// Population to colour and height. One place for both, read by the renderer
// (per-country texture), the legend in the page and the tests.
//
// Scale: t = sqrt(POP_EST / largest POP_EST). Square root, not log: a log
// scale makes 10 million and 1 billion look alike, a linear one leaves all
// but China and India flat. With sqrt the United States stands at half of
// China's height and Japan at a third.

// Viridis at 0, 0.25, 0.5, 0.75, 1 (matplotlib _cm_listed.py, entries 0,
// 64, 128, 191, 255).
export const STOPS: [number, number, number][] = [
  [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
];

// Heights in Earth radii: 0.004 R = 25 km floor, 0.16 R = 1,020 km for China.
export const H_MIN = 0.004;
export const H_MAX = 0.16;

export function scaleT(pop: number, popMax: number): number {
  return Math.sqrt(Math.max(0, pop) / popMax);
}

export function heightOf(pop: number, popMax: number): number {
  return H_MIN + H_MAX * scaleT(pop, popMax);
}

export function ramp(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
}

export function legendTicks(popMax: number): { t: number; pop: number }[] {
  return [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, pop: t * t * popMax }));
}
