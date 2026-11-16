export interface Viewport { width: number; height: number; imageWidth: number; imageHeight: number }
export interface View { zoom: number; panX: number; panY: number }

const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

export function initialView(): View { return { zoom: 1, panX: 0, panY: 0 }; }

export function fitScale(viewport: Viewport): number {
  if (![viewport.width, viewport.height, viewport.imageWidth, viewport.imageHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Viewport and image dimensions must be positive and finite');
  }
  return Math.min(viewport.width / viewport.imageWidth, viewport.height / viewport.imageHeight);
}

export function screenPoint(imageX: number, imageY: number, viewport: Viewport, view: View): [number, number] {
  const scale = fitScale(viewport) * view.zoom;
  return [
    viewport.width / 2 + view.panX + (imageX - viewport.imageWidth / 2) * scale,
    viewport.height / 2 + view.panY + (imageY - viewport.imageHeight / 2) * scale,
  ];
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, panX: view.panX + dx, panY: view.panY + dy };
}

export function zoomAt(view: View, factor: number, x: number, y: number, viewport: Viewport): View {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(x + y)) throw new Error('Invalid zoom input');
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
  const ratio = zoom / view.zoom;
  const anchorX = x - viewport.width / 2;
  const anchorY = y - viewport.height / 2;
  return {
    zoom,
    panX: anchorX - (anchorX - view.panX) * ratio,
    panY: anchorY - (anchorY - view.panY) * ratio,
  };
}
