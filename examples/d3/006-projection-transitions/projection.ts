export function morphProjection(a: readonly [number, number], b: readonly [number, number], t: number): [number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

export function orthographicDirection(x: number, y: number): [number, number, number] {
  return [Math.sqrt(Math.max(0, 1 - x * x - y * y)), x, y];
}
