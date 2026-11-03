export function interpolateCoordinates(a: readonly [number, number], b: readonly [number, number], t: number): [number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
