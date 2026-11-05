// examples/htmlcanvas/002-webgpu-map-label/bench.ts
import { emit, benchFramesGpu } from '../../../harness/page/bench.ts';
import type { WebGpuLabelMap } from './map.ts';

export async function runBench(map: WebGpuLabelMap, firstFrameMs: number): Promise<void> {
  const { canvas } = map;

  await new Promise(requestAnimationFrame);
  emit({ info: { gpu: map.gpuName } });
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Check 1: HTML-in-Canvas native support
  emit({
    check: 'html-in-canvas-supported',
    pass: map.htmlInCanvas,
    detail: map.htmlInCanvas
      ? 'canvas.content reflects "drawable"; cards drawn with drawElementImageToTexture'
      : 'DOM overlay (no HTML-in-Canvas, or SwiftShader)',
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

  emit({ info: { paint_log_before_pan: JSON.stringify(map.paintLog) } });
  emit({
    check: 'zero-uploads-during-pan',
    pass: uploadsBefore === uploadsAfter && uploadsBefore === map.landmarks.length,
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

  // The browser's own hit testing finds a card where the vertex shader drew
  // it (told by updateElementGeometry each frame), follows it through a pan,
  // and a click on what it found pins the card: the paint event uploads that
  // one card again and its new colour reaches the screen.
  {
    const box = canvas.getBoundingClientRect();
    const k = box.width / canvas.width;
    const cardAt = (r: { x: number; y: number; width: number; height: number }) =>
      document.elementFromPoint(box.left + (r.x + r.width / 2) * k, box.top + (r.y + r.height / 2) * k);
    const card = map.labelElements[2];
    const name = (e: Element | null) => (e?.closest('.map-label-card')?.id ?? e?.id) || e?.tagName || '-';
    const r0 = map.getLabelScreenPos(2);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    // Not at r0's centre: elementFromPoint keeps its last answers for a point
    // even after updateElementGeometry moved the element (real clicks get the
    // new geometry), so the old place is asked only once, after the pan.
    const hit0 = document.elementFromPoint(box.left + (r0.x + 20) * k, box.top + (r0.y + 20) * k);
    await map.panBy(-90, 60);
    const r1 = map.getLabelScreenPos(2);
    await new Promise(requestAnimationFrame);
    const hit1 = cardAt(r1), hitOld = cardAt(r0);
    emit({
      check: 'card-hit-where-drawn',
      pass: card.contains(hit0) && card.contains(hit1) && !card.contains(hitOld),
      detail: `elementFromPoint at card 2: ${name(hit0)}; after a pan at its new place: ${name(hit1)}, at its old place: ${name(hitOld)}`,
    });
    const uploads = map.textureUploadCount;
    const painted = new Promise<void>((r) => canvas.addEventListener('paint', () => r(), { once: true }));
    (hit1 as HTMLElement | null)?.click();
    if (map.htmlInCanvas) await painted;
    await map.render();
    const px = await map.readPixel(r1.x + r1.width - 12, r1.y + r1.height - 10);
    const amber = px[0] > 240 && px[1] > 225 && px[2] > 170 && px[2] < 225;
    emit({
      check: 'click-pins-card',
      pass: card.classList.contains('selected') && map.textureUploadCount === uploads + 1 && amber,
      detail: `selected ${card.classList.contains('selected')}, uploads ${uploads} -> ${map.textureUploadCount}, card pixel rgba(${Array.from(px).join(',')})`,
    });
  }

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

  // Pan benchmark: 60 frames, timed from the start to the end of the pass.
  // The frames go to an offscreen texture the size of the canvas: waiting for
  // a canvas frame waits for it to be presented, which took 81 ms a frame on
  // Xvfb (webgpu-003).
  await benchFramesGpu(map.device, 60, (i, ts) => {
    void map.panBy(Math.sin(i * 0.1) * 3, Math.cos(i * 0.1) * 2, ts, true);
  });
  emit({ done: true });
}
