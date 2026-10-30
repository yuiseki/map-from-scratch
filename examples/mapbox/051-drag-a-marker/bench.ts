import { emit } from '../../../harness/page/bench.ts';
import type { DraggableMarkerMap } from './marker.ts';

export async function run(map: DraggableMarkerMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  const isPinBlue = (p: number[]) => p[0] < 70 && p[1] > 80 && p[1] < 150 && p[2] > 170;

  const START_LNG = -66.324;
  const START_LAT = -16.498;
  const startMx = (START_LNG + 180) / 360;
  const startMy = (1 - Math.log(Math.tan(Math.PI / 4 + (START_LAT * Math.PI) / 360)) / Math.PI) / 2;
  const invMercY = (my: number) =>
    (Math.atan(Math.exp((1 - 2 * my) * Math.PI)) * 360) / Math.PI - 90;

  const fire = (type: string, x: number, y: number, buttons: number) => {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons, bubbles: true, cancelable: true,
    }));
  };

  const [x0, y0] = map.getMarkerScreenPos();
  const pin = rgba(x0 + 6, y0 - 32);
  const [lng0, lat0] = map.getMarkerLngLat();
  emit({
    check: 'draggable-marker-visible',
    pass: isPinBlue(pin) &&
      Math.abs(lng0 - START_LNG) < 0.01 && Math.abs(lat0 - START_LAT) < 0.01,
    detail: `${fmt(pin)} at the pin head (${Math.round(x0 + 6)},${Math.round(y0 - 32)}), lnglat=(${lng0.toFixed(3)},${lat0.toFixed(3)})`,
  });

  // 1. A real pointer drag on the pin moves it by exactly the pointer offset.
  fire('pointerdown', x0, y0 - 32, 1);
  const grabbed = map.isDraggingMarker();
  fire('pointermove', x0 + 80, y0 - 32 + 50, 1);
  fire('pointerup', x0 + 80, y0 - 32 + 50, 0);
  const [x1, y1] = map.getMarkerScreenPos();
  const afterDrag = rgba(x1 + 6, y1 - 32);
  const [lng1, lat1] = map.getMarkerLngLat();

  const scale = 256 * Math.pow(2, map.zoom);
  const expectLng = (startMx + 80 / scale) * 360 - 180;
  const expectLat = invMercY(startMy + 50 / scale);
  emit({
    check: 'marker-drags-to-pointer',
    pass: grabbed &&
      Math.round(x1 - x0) === 80 && Math.round(y1 - y0) === 50 &&
      Math.abs(lng1 - expectLng) < 0.05 && Math.abs(lat1 - expectLat) < 0.05 &&
      isPinBlue(afterDrag),
    detail: `dx=${Math.round(x1 - x0)}, dy=${Math.round(y1 - y0)}, lnglat=(${lng1.toFixed(2)},${lat1.toFixed(2)}) expected=(${expectLng.toFixed(2)},${expectLat.toFixed(2)}), ${fmt(afterDrag)}`,
  });

  // 2. Dragging the marker must not pan the map.
  const [cx0, cy0] = map.center;
  emit({
    check: 'marker-drag-does-not-pan',
    pass: Math.abs(cx0 - startMx) < 1e-9 && Math.abs(cy0 - startMy) < 1e-9,
    detail: `centre=(${cx0},${cy0}) after the pointer drag`,
  });

  // 3. Dragging empty map still pans, and the pin follows the map.
  const [bx, by] = map.getMarkerScreenPos();
  fire('pointerdown', 200, 200, 1);
  fire('pointermove', 230, 220, 1);
  fire('pointerup', 230, 220, 0);
  const [cx1, cy1] = map.center;
  const [ax, ay] = map.getMarkerScreenPos();
  emit({
    check: 'map-pans-away-from-marker',
    pass: Math.abs(cx1 - (startMx - 30 / scale)) < 1e-9 &&
      Math.abs(cy1 - (startMy - 20 / scale)) < 1e-9 &&
      Math.round(ax - bx) === 30 && Math.round(ay - by) === 20,
    detail: `centre moved to (${cx1.toFixed(6)},${cy1.toFixed(6)}), pin moved (${Math.round(ax - bx)},${Math.round(ay - by)})`,
  });

  // 4. Wheel zoom keeps the pin under the cursor fixed.
  const [zx, zy] = map.getMarkerScreenPos();
  map.zoomAtPoint(zx, zy, 3.5);
  const [wx, wy] = map.getMarkerScreenPos();
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 3.5 && Math.abs(wx - zx) < 1.5 && Math.abs(wy - zy) < 1.5,
    detail: `zoom ${map.zoom}, pin moved (${(wx - zx).toFixed(2)}, ${(wy - zy).toFixed(2)}) px`,
  });

  // 5. Pan cost and frame pacing, with the marker on screen.
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.panBy(Math.sin(i * 0.1) * 2, Math.cos(i * 0.1) * 2);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  map.resetView();

  emit({ done: true });
}
