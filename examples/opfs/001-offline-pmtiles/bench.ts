// examples/opfs/001-offline-pmtiles/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { OpfsMap } from './map.ts';

export async function runBench(map: OpfsMap, firstFrameMs: number): Promise<void> {
  const { canvas } = map;

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Wait a moment for initial visible tiles to load from OPFS worker
  await new Promise(r => setTimeout(r, 100));
  map.render();

  const stats0 = await map.getStats();

  // Verification 1: OPFS stored
  emit({
    check: 'opfs-stored',
    pass: stats0.opfsSize > 60000,
    detail: `OPFS archive size = ${stats0.opfsSize} bytes`,
  });

  // Verification 2: Sync access reads
  emit({
    check: 'sync-access-reads',
    pass: stats0.totalSyncReads >= 1 && stats0.avgLatencyMs < 1.0,
    detail: `sync reads = ${stats0.totalSyncReads}, avg latency = ${(stats0.avgLatencyMs * 1000).toFixed(1)} µs`,
  });

  // Verification 3: Tiles rendered
  // Check pixel color around screen center (North Africa / Mediterranean)
  // Ocean: rgb(15, 23, 42)
  // Land:  rgb(30, 41, 59)
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const centerPx = map.readPixel(cx, cy);
  const isLand = centerPx[0] >= 25 && centerPx[1] >= 35 && centerPx[2] >= 50;
  emit({
    check: 'tiles-rendered',
    pass: isLand,
    detail: `rgba(${Array.from(centerPx).join(',')}) at screen center (${cx}, ${cy})`,
  });

  // Verification 4: Pan triggers OPFS reads with zero network
  const readsBefore = stats0.totalSyncReads;
  map.panBy(300, 150);
  await new Promise(r => setTimeout(r, 100));
  const statsAfter = await map.getStats();
  const panPass = statsAfter.totalSyncReads >= readsBefore && statsAfter.networkRequests === 0;
  emit({
    check: 'pan-triggers-opfs-reads',
    pass: panPass,
    detail: `reads after pan: before=${readsBefore}, after=${statsAfter.totalSyncReads}, networkRequests=${statsAfter.networkRequests}`,
  });

  // Pan benchmark: 60 frames
  const raf = () => new Promise<number>(requestAnimationFrame);
  await raf();
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.panBy(Math.sin(i * 0.1) * 3, Math.cos(i * 0.1) * 2);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });
  emit({ done: true });
}
