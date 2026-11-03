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
  // Pan by how far that ground point moved, until it is back under the pointer.
  for (let it = 0; it < 10; it++) {
    const p = project(frame(v), before[0], before[1], v.centerH);
    if (!p) return;
    const ex = sx - p[0], ey = sy - p[1];
    if (Math.hypot(ex, ey) < 0.1) return;
    pan(v, ex, ey);
  }
}
