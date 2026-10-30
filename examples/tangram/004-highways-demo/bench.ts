import { emit } from '../../../harness/page/bench.ts';
import type { TangramHighwaysMap } from './map.ts';


export async function run(map: TangramHighwaysMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const w = Math.round((canvas.width / dpr));
  const h = Math.round((canvas.height / dpr));
  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);

  // Verification 1: Highway rendered at center (SF highway nexus)
  const px0 = ctx.getImageData(Math.round(cx * dpr), Math.round(cy * dpr), 1, 1).data;
  const isCyan0 = px0[0] < 50 && px0[1] > 180 && px0[2] > 200;

  emit({
    check: 'highways-rendered',
    pass: isCyan0,
    detail: `center rgba(${px0.join(',')}) expected cyan (r<50, g>180, b>200)`,
  });

  // Pan benchmark: 60 frames
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

  // Verification 2: Zoom-dependent width
  // Measure thickness of the highway passing through center at z=7 vs z=9
  const countColoredPixels = (yOffsetRange: number): number => {
    let count = 0;
    for (let dy = -yOffsetRange; dy <= yOffsetRange; dy++) {
      const p = ctx.getImageData(Math.round(cx * dpr), Math.round((cy + dy) * dpr), 1, 1).data;
      if (p[1] > 120 && p[2] > 150) count++;
    }
    return count;
  };

  map.center = { lon: -122.4194, lat: 37.7749 };
  map.setZoom(7);
  const widthAtZ7 = countColoredPixels(8);

  map.setZoom(9);
  const widthAtZ9 = countColoredPixels(8);

  emit({
    check: 'zoom-dependent-width',
    pass: widthAtZ9 > widthAtZ7,
    detail: `detected highway pixel width: z7=${widthAtZ7}px, z9=${widthAtZ9}px`,
  });

  // Verification 3: Highways move synchronously with pan
  map.setZoom(8);
  map.center = { lon: -122.4194, lat: 37.7749 };
  map.draw();
  map.panBy(40, 25);

  const targetX = Math.round((cx + 40) * dpr);
  const targetY = Math.round((cy + 25) * dpr);
  const pannedPx = ctx.getImageData(targetX, targetY, 1, 1).data;
  const isPannedCyan = pannedPx[0] < 60 && pannedPx[1] > 160 && pannedPx[2] > 180;

  emit({
    check: 'highways-move-with-pan',
    pass: isPannedCyan,
    detail: `panned target (${targetX}, ${targetY}) rgba(${pannedPx.join(',')})`,
  });

  emit({ done: true });
}

// Auto-run when imported
const mapInstance = (window as unknown as { __map?: TangramHighwaysMap }).__map;
if (mapInstance) {
  void run(mapInstance, performance.now());
}
