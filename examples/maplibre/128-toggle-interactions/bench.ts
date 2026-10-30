import { emit } from '../../../harness/page/bench.ts';
import type { ToggleMap } from './controls.ts';

const LANDMARK: [number, number] = [-95, 40];
const OCEAN_POINT: [number, number] = [-60, 30];

const ACCENT = [42, 122, 226];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

export async function run(map: ToggleMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): number[] =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p.join(',')})`;
  const is = (p: number[], rgb: number[]) =>
    p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2];
  const isLand = (p: number[]) => p[0] > 225 && p[1] > 225 && p[2] > 210;
  const isOcean = (p: number[]) => p[0] < 190 && p[1] > 195 && p[2] > 205;

  const w = canvas.clientWidth, h = canvas.clientHeight;

  // Independent projection: the bench never trusts map.getScreenPos.
  const project = (lon: number, lat: number): [number, number] => {
    const scale = 256 * Math.pow(2, map.zoom);
    const [cx, cy] = map.center;
    return [w / 2 + (mercX(lon) - cx) * scale, h / 2 + (mercY(lat) - cy) * scale];
  };
  const camera = (): [number, number] => [map.center[0], map.center[1]];

  const pointer = (type: string, x: number, y: number): void => {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', bubbles: true,
      buttons: type === 'pointerup' ? 0 : 1,
    }));
  };
  const drag = (x: number, y: number, dx: number, dy: number): void => {
    pointer('pointerdown', x, y);
    pointer('pointermove', x + dx / 2, y + dy / 2);
    pointer('pointermove', x + dx, y + dy);
    pointer('pointerup', x + dx, y + dy);
  };
  const wheel = (x: number, y: number, deltaY: number): void => {
    canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: x, clientY: y, deltaY, bubbles: true, cancelable: true,
    }));
  };
  const dblclick = (x: number, y: number): void => {
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true }));
  };
  const clickRow = (i: number): void => {
    const r = map.getRowRect(i);
    pointer('pointerdown', r.x + r.width / 2, r.y + r.height / 2);
    pointer('pointerup', r.x + r.width / 2, r.y + r.height / 2);
  };
  const tickAt = (i: number): number[] => {
    const b = map.getCheckboxRect(i);
    return pixelAt(b.x + 12, b.y + 12);
  };
  const darkPixels = (x: number, y: number, cw: number, ch: number): number => {
    const data = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr),
      Math.round(cw * dpr), Math.round(ch * dpr)).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) n++;
    }
    return n;
  };

  // 0. The control panel is drawn on the canvas: three ticked checkboxes and
  // readable labels.
  const panel = map.getPanelRect();
  const ticks = [0, 1, 2].map(tickAt);
  const labelDark = [0, 1, 2].map((i) => {
    const r = map.getRowRect(i);
    return darkPixels(r.x + 34, r.y + 4, 150, r.height - 8);
  });
  emit({
    check: 'controls-visible',
    pass: ticks.every((p) => is(p, ACCENT)) && labelDark.every((n) => n > 20),
    detail: `panel (${panel.x},${panel.y},${panel.width},${panel.height}), ticks ` +
      `${ticks.map(fmt).join(' ')}, label dark px ${labelDark.join('/')}`,
  });

  // 1. Geography at the default camera: Washington DC is land, the Atlantic is
  // water. This also proves the panel did not cover the centre.
  const centre = pixelAt(w / 2, h / 2);
  const ocean = project(OCEAN_POINT[0], OCEAN_POINT[1]);
  const oceanPx = pixelAt(ocean[0], ocean[1]);
  emit({
    check: 'map-rendered-at-target',
    pass: map.zoom === 3 && isLand(centre) && isOcean(oceanPx),
    detail: `zoom ${map.zoom}, centre ${fmt(centre)}, ocean ${fmt(oceanPx)}`,
  });

  // 2. Drag pan is on by default: a 120×60 px drag moves the camera by exactly
  // that many pixels, so a fixed landmark moves by (120, 60).
  const lmBefore = project(LANDMARK[0], LANDMARK[1]);
  const camBefore = camera();
  drag(700, 400, 120, 60);
  const lmAfter = project(LANDMARK[0], LANDMARK[1]);
  const camAfter = camera();
  const scale0 = 256 * Math.pow(2, 3);
  emit({
    check: 'drag-pans-by-default',
    pass: Math.abs(lmAfter[0] - lmBefore[0] - 120) < 1e-6 &&
      Math.abs(lmAfter[1] - lmBefore[1] - 60) < 1e-6 &&
      Math.abs(camAfter[0] - (camBefore[0] - 120 / scale0)) < 1e-12 &&
      Math.abs(camAfter[1] - (camBefore[1] - 60 / scale0)) < 1e-12,
    detail: `landmark (${lmBefore[0].toFixed(1)},${lmBefore[1].toFixed(1)}) -> ` +
      `(${lmAfter[0].toFixed(1)},${lmAfter[1].toFixed(1)})`,
  });

  map.resetView();
  // 3. Click the drag row: the check clears and draggging no longer moves the
  // camera (or the landmark pixels).
  clickRow(0);
  const offTick = tickAt(0);
  const lmStill = project(LANDMARK[0], LANDMARK[1]);
  const camStill = camera();
  drag(700, 400, 150, 60);
  const lmStillAfter = project(LANDMARK[0], LANDMARK[1]);
  const camStillAfter = camera();
  emit({
    check: 'drag-disabled-stops-pan',
    pass: map.toggles.dragPan === false && offTick[0] > 245 && offTick[1] > 245 &&
      offTick[2] > 245 &&
      camStillAfter[0] === camStill[0] && camStillAfter[1] === camStill[1] &&
      Math.abs(lmStillAfter[0] - lmStill[0]) < 1e-9 &&
      Math.abs(lmStillAfter[1] - lmStill[1]) < 1e-9,
    detail: `dragPan=${map.toggles.dragPan}, tick ${fmt(offTick)}, ` +
      `camera ${camStill[0].toFixed(9)},${camStill[1].toFixed(9)} unchanged`,
  });

  // 4. Clicking again restores drag pan.
  clickRow(0);
  const onTick = tickAt(0);
  drag(700, 400, 80, 40);
  emit({
    check: 'drag-reenabled-works',
    pass: map.toggles.dragPan === true && is(onTick, ACCENT) &&
      Math.abs(camera()[0] - (camStill[0] - 80 / scale0)) < 1e-12 &&
      Math.abs(camera()[1] - (camStill[1] - 40 / scale0)) < 1e-12,
    detail: `tick ${fmt(onTick)}, camera moved by (80,40) px`,
  });

  map.resetView();
  // 5. Scroll zoom is on: one wheel step about the cursor scales the map by
  // sqrt(2) and keeps the point under the cursor fixed.
  const zoomStart = map.zoom;
  const lmWheel = project(LANDMARK[0], LANDMARK[1]);
  const cursor: [number, number] = [500, 400];
  const k = Math.pow(2, 0.5);
  wheel(cursor[0], cursor[1], -100);
  const lmZoomed = project(LANDMARK[0], LANDMARK[1]);
  emit({
    check: 'scroll-zooms-by-default',
    pass: Math.abs(map.zoom - (zoomStart + 0.5)) < 1e-12 &&
      Math.abs((lmZoomed[0] - cursor[0]) - (lmWheel[0] - cursor[0]) * k) < 1e-6 &&
      Math.abs((lmZoomed[1] - cursor[1]) - (lmWheel[1] - cursor[1]) * k) < 1e-6,
    detail: `zoom ${zoomStart} -> ${map.zoom}, landmark ${lmWheel[0].toFixed(1)} -> ${lmZoomed[0].toFixed(1)}`,
  });

  // 6. With the scroll row unticked the wheel is ignored.
  clickRow(1);
  const zoomHeld = map.zoom;
  wheel(cursor[0], cursor[1], -100);
  const lmHeld = project(LANDMARK[0], LANDMARK[1]);
  emit({
    check: 'scroll-disabled-stops-zoom',
    pass: map.toggles.scrollZoom === false &&
      map.zoom === zoomHeld &&
      Math.abs(lmHeld[0] - lmZoomed[0]) < 1e-9 &&
      Math.abs(lmHeld[1] - lmZoomed[1]) < 1e-9,
    detail: `zoom stays ${map.zoom}, landmark ${fmt(pixelAt(lmHeld[0], lmHeld[1]))}`,
  });

  map.resetView();
  // 7. Double click zooms one level about the cursor.
  const lmDbl = project(LANDMARK[0], LANDMARK[1]);
  dblclick(cursor[0], cursor[1]);
  const lmDblAfter = project(LANDMARK[0], LANDMARK[1]);
  emit({
    check: 'dblclick-zooms-by-default',
    pass: map.zoom === 4 &&
      Math.abs((lmDblAfter[0] - cursor[0]) - (lmDbl[0] - cursor[0]) * 2) < 1e-6 &&
      Math.abs((lmDblAfter[1] - cursor[1]) - (lmDbl[1] - cursor[1]) * 2) < 1e-6,
    detail: `zoom ${map.zoom}, landmark ${lmDbl[1].toFixed(1)} -> ${lmDblAfter[1].toFixed(1)}`,
  });

  // 8. With the double-click row unticked the double click is ignored.
  clickRow(2);
  const zoomDblHeld = map.zoom;
  dblclick(cursor[0], cursor[1]);
  emit({
    check: 'dblclick-disabled-stops-zoom',
    pass: map.toggles.dblClickZoom === false && map.zoom === zoomDblHeld,
    detail: `dblClickZoom=${map.toggles.dblClickZoom}, zoom stays ${map.zoom}`,
  });

  // 9. resetView restores the camera and every control.
  map.resetView();
  const resetTicks = [0, 1, 2].map(tickAt);
  emit({
    check: 'reset-restores-controls',
    pass: map.zoom === 3 && map.toggles.dragPan && map.toggles.scrollZoom &&
      map.toggles.dblClickZoom && resetTicks.every((p) => is(p, ACCENT)),
    detail: `zoom ${map.zoom}, ticks ${resetTicks.map(fmt).join(' ')}`,
  });

  // 10. Pan cost with the panel drawn on every frame.
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
  await sleep(50);

  emit({ done: true });
}
