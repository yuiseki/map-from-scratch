export type Panel = [number, number, number, number];
export function splitViewport(width: number, height: number, gap = 1): [Panel, Panel] {
  const left = Math.floor((width - gap) / 2);
  const rightX = left + gap;
  return [[0, 0, left, height], [rightX, 0, width - rightX, height]];
}
