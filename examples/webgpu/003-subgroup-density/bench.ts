// examples/webgpu/003-subgroup-density/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { DensityMap } from './map.ts';

export async function runBench(map: DensityMap, firstFrameMs: number): Promise<void> {
  const { canvas } = map;

  await new Promise(requestAnimationFrame);
  emit({ info: { gpu: map.gpu } });
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Verification 1: Points loaded
  emit({
    check: 'points-loaded',
    pass: map.pointCount === 1048576,
    detail: `pointCount = ${map.pointCount} (1,048,576 nodes)`,
  });

  // Verification 2: Subgroups feature enabled
  emit({
    check: 'subgroups-enabled',
    pass: map.hasSubgroups,
    detail: `hasSubgroups = ${map.hasSubgroups}`,
  });

  // Verification 3: Density grid populated via GPU compute
  const initialPeak = await map.getMaxDensity();
  emit({
    check: 'density-grid-populated',
    pass: initialPeak >= 20,
    detail: `peakDensity = ${initialPeak} / cell`,
  });

  // Verification 4: Heatmap pixels rendered (True pixel readback)
  // Check center of Tokyo (approx 512, 384 on 1024x768 viewport)
  const centerPx = await map.readPixel(Math.round(canvas.width / 2), Math.round(canvas.height / 2));
  const isBackground = centerPx[0] <= 15 && centerPx[1] <= 15 && centerPx[2] <= 25;
  emit({
    check: 'heatmap-pixels-rendered',
    pass: !isBackground,
    detail: `center pixel = rgba(${Array.from(centerPx).join(',')}) (colored by Turbo colormap)`,
  });

  // Verification 5: Pan updates density distribution dynamically
  map.zoomBy(1.5);
  const zoomedPeak = await map.getMaxDensity();
  map.panBy(400, 400);
  const pannedPeak = await map.getMaxDensity();
  emit({
    check: 'pan-updates-density',
    pass: pannedPeak !== zoomedPeak,
    detail: `peakDensity zoomed = ${zoomedPeak}, after pan = ${pannedPeak}`,
  });

  // Pan benchmark scenario: 60 frames
  const frameTimes: number[] = [];
  const redrawTimes: number[] = [];
  let lastTimestamp = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.panBy(Math.sin(i * 0.1) * 5, Math.cos(i * 0.1) * 5);
    const redrawMs = performance.now() - t0;
    redrawTimes.push(redrawMs);

    await new Promise(requestAnimationFrame);
    const now = performance.now();
    frameTimes.push(now - lastTimestamp);
    lastTimestamp = now;
  }

  for (const r of redrawTimes) emit({ metric: 'redraw_ms', value: r });
  for (const f of frameTimes) emit({ metric: 'frame_interval_ms', value: f });

  emit({ done: true });
}
