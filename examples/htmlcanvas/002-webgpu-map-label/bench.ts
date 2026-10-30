// examples/htmlcanvas/002-webgpu-map-label/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { WebGpuLabelMap } from './map.ts';

export async function runBench(map: WebGpuLabelMap, firstFrameMs: number): Promise<void> {
  const { canvas } = map;

  await new Promise(requestAnimationFrame);
  emit({ info: { gpu: map.gpuName } });
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Check 1: HTML-in-Canvas native support
  emit({
    check: 'html-in-canvas-supported',
    pass: map.hasDrawElementImage,
    detail: map.hasDrawElementImage
      ? 'CanvasRenderingContext2D.prototype.drawElementImage is available'
      : 'drawElementImage is missing; running in fallback mode',
  });

  // Check 2: WebGPU Initialized
  emit({
    check: 'webgpu-initialized',
    pass: Boolean(map.gpuName && map.gpuName.length > 0),
    detail: `GPU: ${map.gpuName}`,
  });

  // Check 3: Landmarks loaded
  emit({
    check: 'labels-loaded',
    pass: map.landmarks.length === 6,
    detail: `Loaded ${map.landmarks.length} landmarks for GPU instanced rendering`,
  });

  // Check 4: Labels composited onto map in WebGPU (pixel readback)
  // Check pixel at label 2 (Imperial Palace, near center of Tokyo / viewport)
  const pPos = map.getLabelScreenPos(2);
  const cardPixel = await map.readPixel(pPos.x + 100, pPos.y + 20);
  const badgePixel = await map.readPixel(pPos.x + 40, pPos.y + 10);

  const isCardWhite = cardPixel[0] > 240 && cardPixel[1] > 240 && cardPixel[2] > 240;
  const isBadgeGreen = badgePixel[1] > 140 && badgePixel[0] < 50;

  emit({
    check: 'labels-rendered-on-webgpu',
    pass: isCardWhite && isBadgeGreen,
    detail: `Card background: rgba(${Array.from(cardPixel).join(',')}), Badge: rgba(${Array.from(badgePixel).join(',')})`,
  });

  // Check 5: Zero texture uploads and zero HTML re-layout during pan/zoom
  const uploadsBefore = map.textureUploadCount;
  for (let step = 0; step < 5; step++) {
    await map.panBy(30, -20);
  }
  await map.zoomBy(0.2);
  const uploadsAfter = map.textureUploadCount;

  emit({
    check: 'zero-uploads-during-pan',
    pass: uploadsBefore === uploadsAfter && uploadsBefore === 1,
    detail: `Uploads before pan: ${uploadsBefore}, Uploads after pan: ${uploadsAfter}`,
  });

  // Check 6: Dynamic label content update uploads texture exactly once
  await map.updateLabelContent(0, '東京タワー更新', '人気電波塔', '★ 5.0');
  const uploadsAfterUpdate = map.textureUploadCount;

  emit({
    check: 'texture-updated-on-change',
    pass: uploadsAfterUpdate === uploadsAfter + 1,
    detail: `Uploads after label content update: ${uploadsAfterUpdate} (expected ${uploadsAfter + 1})`,
  });

  // Check 7: GSI Seamlessphoto aerial tiles loaded and rendered on WebGPU
  const hasTiles = await map.waitForTile(4000);
  await map.render();
  emit({
    check: 'aerial-tile-rendered',
    pass: hasTiles,
    detail: `GSI Seamlessphoto PMTiles loaded on WebGPU: ${hasTiles}`,
  });

  // Check 8: the photo covers the lower half too. The atlas held 16 tiles
  // and the draw stopped there, so the lower rows of a wide view stayed the
  // background colour. Read the lower left and right until tiles arrive.
  {
    const w = map.canvas.width, h = map.canvas.height;
    const probes = [[w * 0.2, h * 0.88], [w * 0.8, h * 0.88]];
    const isBg = (p: Uint8Array) => Math.abs(p[0] - 11) < 4 && Math.abs(p[1] - 17) < 4 && Math.abs(p[2] - 32) < 4;
    let px: Uint8Array[] = [];
    for (let t = 0; t < 80; t++) {
      px = await Promise.all(probes.map(([x, y]) => map.readPixel(x, y)));
      if (!px.some(isBg)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    emit({
      check: 'aerial-covers-the-view',
      pass: px.length === 2 && !px.some(isBg),
      detail: `lower left rgba(${Array.from(px[0] ?? []).join(',')}), lower right rgba(${Array.from(px[1] ?? []).join(',')}) at ${w}x${h}`,
    });
  }

  // Measure frame interval
  let lastTime = performance.now();
  for (let i = 0; i < 15; i++) {
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    emit({ metric: 'frame_interval_ms', value: now - lastTime });
    lastTime = now;
  }

  // Measure redraw performance
  const samples = 20;
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    await map.render();
    const dt = performance.now() - t0;
    emit({ metric: 'redraw_ms', value: dt });
  }

  emit({ done: true });
}
