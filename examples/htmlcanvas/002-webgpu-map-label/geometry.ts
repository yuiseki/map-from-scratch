export interface LabelRect { x: number; y: number; width: number; height: number }

export function labelScreenRect(
  mx: number, my: number, centerMx: number, centerMy: number,
  zoom: number, viewWidth: number, viewHeight: number,
  width = 150, height = 60, gap = 12,
): LabelRect {
  const scale = 256 * 2 ** zoom;
  const screenX = viewWidth / 2 + (mx - centerMx) * scale;
  const screenY = viewHeight / 2 + (my - centerMy) * scale;
  return { x: Math.round(screenX - width / 2), y: Math.round(screenY - height - gap), width, height };
}
