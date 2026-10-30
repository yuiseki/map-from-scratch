import { emit } from '../../../harness/page/bench.ts';
import type { GeneratedIconMap } from './icon.ts';

export async function run(map: GeneratedIconMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;

  // 1. The generated sprite is on the canvas at [0, 0]: red end on top, the
  //    translucent blue end below (alpha comes from the red channel).
  const [ix, iy] = map.getIconScreenPos();
  const top = rgba(ix, iy - 25);
  emit({
    check: 'gradient-red-top',
    pass: top[0] > top[2] + 50 && top[0] > 150,
    detail: `${fmt(top)} 25 px above the icon centre (${Math.round(ix)},${Math.round(iy)})`,
  });

  const bottom = rgba(ix, iy + 25);
  emit({
    check: 'gradient-blue-bottom',
    pass: bottom[2] > bottom[0] + 15 && bottom[2] > 200,
    detail: `${fmt(bottom)} 25 px below the icon centre`,
  });

  // 2. Pan cost and frame pacing.
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

  // 3. The icon moves with the map: pan by a fixed offset and re-read pixels.
  map.setZoom(3);
  const [bx, by] = map.getIconScreenPos();
  map.panBy(60, 40);
  const [px, py] = map.getIconScreenPos();
  const moved = rgba(px, py - 25);
  emit({
    check: 'icon-moves-with-pan',
    pass: Math.round(px - bx) === 60 && Math.round(py - by) === 40 && moved[0] > moved[2] + 50,
    detail: `dx=${Math.round(px - bx)}, dy=${Math.round(py - by)}, ${fmt(moved)}`,
  });

  // 4. The icon stays anchored to [0, 0] when zoom changes.
  map.setZoom(5);
  const [zx, zy] = map.getIconScreenPos();
  const zoomTop = rgba(zx, zy - 25);
  emit({
    check: 'icon-anchors-on-zoom',
    pass: zoomTop[0] > zoomTop[2] + 50,
    detail: `zoom=${map.zoom} pos=(${Math.round(zx)},${Math.round(zy)}), ${fmt(zoomTop)}`,
  });

  // 5. Wheel zoom keeps the point under the cursor fixed.
  const [ax, ay] = map.getIconScreenPos();
  map.zoomAtPoint(ax, ay, 6);
  const [wx, wy] = map.getIconScreenPos();
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 6 && Math.abs(wx - ax) < 1.5 && Math.abs(wy - ay) < 1.5,
    detail: `zoom ${map.zoom}, anchor moved (${(wx - ax).toFixed(2)}, ${(wy - ay).toFixed(2)}) px`,
  });

  emit({ done: true });
}
