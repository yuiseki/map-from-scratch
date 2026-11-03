export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }

export function projectWorld(x: number, y: number, centerX: number, centerY: number, width: number, height: number): Point {
  return { x: width / 2 + (x - centerX), y: height / 2 + (y - centerY) };
}

export function unprojectWorld(px: number, py: number, centerX: number, centerY: number, width: number, height: number, worldSize: number): { lon: number; lat: number } {
  const mx = centerX + (px - width / 2), my = centerY + (py - height / 2);
  return {
    lon: (mx / worldSize) * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * my) / worldSize))) * (180 / Math.PI),
  };
}

export function popupRectAtAnchor(x: number, y: number, width: number, height: number): Rect {
  return { x: Math.round(x - width / 2), y: Math.round(y - height - 14), width, height };
}
