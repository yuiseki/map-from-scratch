// examples/tangram/008-road-filters-demo/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { TangramRoadMap } from './map.ts';

// Known point along I-80 in the Bay Area (Berkeley / Emeryville: -122.309, 37.898)
const I80_SAMPLE: [number, number] = [-122.30915, 37.89792];

export async function run(map: TangramRoadMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): Uint8ClampedArray =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;

  // Verification 1: roads-loaded
  emit({
    check: 'roads-loaded',
    pass: map.roadCount >= 3000,
    detail: `roadCount=${map.roadCount}, visibleRoadCount=${map.visibleRoadCount}`,
  });

  // Verification 2: interstate-roads-rendered
  // Scan a small window around I-80 point for cyan highway pixel
  const [targetX, targetY] = map.getScreenPos(I80_SAMPLE[0], I80_SAMPLE[1]);
  let foundCyan = false;
  let cyanSample: number[] = [];

  for (let dx = -15; dx <= 15; dx += 2) {
    for (let dy = -15; dy <= 15; dy += 2) {
      const px = pixelAt(targetX + dx, targetY + dy);
      // Cyan is r < 60, g > 180, b > 200
      if (px[0] < 60 && px[1] > 180 && px[2] > 200) {
        foundCyan = true;
        cyanSample = [px[0], px[1], px[2]];
        break;
      }
    }
    if (foundCyan) break;
  }

  emit({
    check: 'interstate-roads-rendered',
    pass: foundCyan,
    detail: `found cyan pixel at I-80 corridor: [${cyanSample.join(',')}]`,
  });

  // Verification 3: filter-toggles-visibility
  map.setFilters({ interstate: false });
  // Verify that cyan is no longer present around I-80 corridor
  let cyanAfterFilter = false;
  for (let dx = -15; dx <= 15; dx += 2) {
    for (let dy = -15; dy <= 15; dy += 2) {
      const px = pixelAt(targetX + dx, targetY + dy);
      if (px[0] < 60 && px[1] > 180 && px[2] > 200) {
        cyanAfterFilter = true;
        break;
      }
    }
    if (cyanAfterFilter) break;
  }

  emit({
    check: 'filter-toggles-visibility',
    pass: !cyanAfterFilter,
    detail: `cyan present after toggling Interstate off: ${cyanAfterFilter}`,
  });

  // Restore Interstate
  map.setFilters({ interstate: true });

  // Verification 4: pan-updates-road-positions
  const [xBefore, yBefore] = map.getScreenPos(I80_SAMPLE[0], I80_SAMPLE[1]);
  map.panBy(40, 20);
  const [xAfter, yAfter] = map.getScreenPos(I80_SAMPLE[0], I80_SAMPLE[1]);
  map.panBy(-40, -20);

  emit({
    check: 'pan-updates-road-positions',
    pass: Math.round(xAfter - xBefore) === 40 && Math.round(yAfter - yBefore) === 20,
    detail: `dx=${Math.round(xAfter - xBefore)}, dy=${Math.round(yAfter - yBefore)}`,
  });

  // Pan benchmark: 60 frames
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.panBy(Math.sin(i * 0.1) * 3, Math.cos(i * 0.1) * 3);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });
  emit({ done: true });
}
