import { emit } from '../../../harness/page/bench.ts';
import type { VectorExportMap } from './map.ts';

export async function run(map: VectorExportMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const near = (x: number, y: number, test: (p: Uint8ClampedArray) => boolean): boolean => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = ctx.getImageData(Math.round((x + dx) * dpr), Math.round((y + dy) * dpr), 1, 1).data;
        if (test(px)) return true;
      }
    }
    return false;
  };
  const isStation = (p: Uint8ClampedArray): boolean => p[0] > 180 && p[1] < 100 && p[2] < 120;
  const isRail = (p: Uint8ClampedArray): boolean => p[0] < 100 && p[1] < 140 && p[2] > 180;

  const [lx, ly] = map.stationScreen('Luxembourg')!;
  emit({
    check: 'stations-visible',
    pass: near(lx, ly, isStation),
    detail: `station red near (${Math.round(lx)},${Math.round(ly)})`,
  });

  // A point on the north line away from stations must be blue.
  const [nx, ny] = map.screenPos(...(map.data.rails[0][3] as [number, number]));
  emit({
    check: 'rails-visible',
    pass: near(nx, ny, isRail),
    detail: `rail blue near (${Math.round(nx)},${Math.round(ny)})`,
  });

  const svg = map.exportSvg();
  const paths = (svg.match(/<path /g) || []).length;
  const circles = (svg.match(/<circle /g) || []).length;
  emit({
    check: 'svg-export-geometry',
    pass: paths === map.data.rails.length + 1 && circles === map.data.stations.length && svg.includes('viewBox='),
    detail: `paths=${paths}, circles=${circles}, viewBox=${svg.includes('viewBox=')}`,
  });
  const names = map.data.stations.every((s) => svg.includes(`<title>${s.name}</title>`));
  emit({ check: 'svg-export-labels', pass: names, detail: `all ${map.data.stations.length} station names in SVG=${names}` });

  map.panBy(40, 20);
  const [px, py] = map.stationScreen('Luxembourg')!;
  emit({
    check: 'pan-moves-stations',
    pass: Math.round(px - lx) === 40 && Math.round(py - ly) === 20 && near(px, py, isStation),
    detail: `dx=${Math.round(px - lx)}, dy=${Math.round(py - ly)}`,
  });

  map.panBy(-40, -20);
  map.setCenter(6.133, 49.6);

  const zoomBefore = map.zoom;
  map.setZoom(zoomBefore + 1);
  const [zx, zy] = map.stationScreen('Luxembourg')!;
  emit({
    check: 'zoom-keeps-stations',
    pass: near(zx, zy, isStation),
    detail: `station (${Math.round(zx)},${Math.round(zy)}) at zoom ${map.zoom.toFixed(2)}`,
  });

  map.setZoom(zoomBefore);

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

  emit({ done: true });
}
