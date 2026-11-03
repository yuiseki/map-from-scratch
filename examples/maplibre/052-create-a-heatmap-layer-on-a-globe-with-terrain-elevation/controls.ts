// Pointer and wheel to camera changes. Drag rotates and tilts (the request),
// Shift+drag pans, the wheel zooms about the pointer.
import { frame, project, unproject, MAX_PITCH, MAX_ZOOM, MIN_ZOOM, type View } from './camera.ts';

const wrap = (b: number) => ((((b + 180) % 360) + 360) % 360) - 180;

export function orbit(v: View, dx: number, dy: number): void {
  v.bearing = wrap(v.bearing - dx * 0.4);
  v.pitch = Math.max(0, Math.min(MAX_PITCH, v.pitch - dy * 0.3));
}

// Content follows the pointer: the ground at (centre - d) becomes the new
// centre, then a few corrections bring the old centre to exactly centre + d.
export function pan(v: View, dx: number, dy: number): void {
  const cx = v.width / 2, cy = v.height / 2;
  const anchor = unproject(frame(v), cx, cy, v.centerH);
  let [mx, my] = [dx, dy];
  for (let it = 0; it < 4; it++) {
    const g = unproject(frame(v), cx - mx, cy - my, v.centerH);
    if (!g || !anchor) return;
    v.lon = g[0];
    v.lat = Math.max(-85, Math.min(85, g[1]));
    const p = project(frame(v), anchor[0], anchor[1], v.centerH);
    if (!p) return;
    const ex = cx + dx - p[0], ey = cy + dy - p[1];
    if (Math.hypot(ex, ey) < 0.05) return;
    [mx, my] = [ex, ey];
  }
}

export function zoomAt(v: View, sx: number, sy: number, dz: number): void {
  const before = unproject(frame(v), sx, sy, v.centerH);
  v.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom + dz));
  if (!before) return;
  // Move the centre on the ground by how far the ground under the pointer slid, until the
  // pointer is over the old ground point again. Correcting in ground coordinates converges
  // at any pitch; panning by the screen error (pan) overshot at pitch 70, where a step of the
  // centre moves a point low on the screen by much more than the same step in pixels.
  for (let it = 0; it < 10; it++) {
    const now = unproject(frame(v), sx, sy, v.centerH);
    if (!now) return;
    v.lon += before[0] - now[0];
    v.lat = Math.max(-85, Math.min(85, v.lat + before[1] - now[1]));
    const p = project(frame(v), before[0], before[1], v.centerH);
    if (!p || Math.hypot(sx - p[0], sy - p[1]) < 0.05) return;
  }
}

export interface DragTarget {
  addEventListener(type: string, fn: (e: { clientX: number; clientY: number; pointerId: number; shiftKey?: boolean }) => void): void;
  setPointerCapture(id: number): void;
}

/** Pointer drag on an element: move(dx, dy, shift) in CSS px per pointermove while a pointer is down. */
export function bindDrag(el: DragTarget, move: (dx: number, dy: number, shift: boolean) => void): void {
  let last: { x: number; y: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    last = { x: e.clientX, y: e.clientY };
    // Capture keeps the drag when the pointer leaves the canvas. It throws for a pointer the
    // browser does not know as active (a synthetic event); the drag must not depend on it.
    try { el.setPointerCapture(e.pointerId); } catch { /* drag without capture */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (!last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    move(dx, dy, !!e.shiftKey);
  });
  const end = () => { last = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
