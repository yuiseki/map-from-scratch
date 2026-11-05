import { benchFrames, emit, glRenderer } from '../../../../harness/page/bench.ts';
import type { HexGlobeRenderer } from './renderer.ts';

export async function run(map: HexGlobeRenderer): Promise<void> {
  const { data, gl } = map;
  // WebGL's default drawing buffer is not guaranteed to persist across tasks.
  // Redraw and read synchronously so the pixel assertions inspect this frame.
  map.draw();
  gl.finish();
  const pixels = map.pixels(), extremes = map.populationExtremes();
  const lowPixel = extremes.low ? map.readPixel(extremes.low.screen.x, extremes.low.screen.y) : null;
  const highPixel = extremes.high ? map.readPixel(extremes.high.screen.x, extremes.high.screen.y) : null;
  const dakar = map.screenForGeo(-17.45, 14.69), cairo = map.screenForGeo(31.24, 30.04);
  const externalRequests = performance.getEntriesByType('resource').filter((entry) => {
    try { return new URL(entry.name).origin !== location.origin; } catch { return true; }
  });
  emit({ metric: 'hex_cell_count', value: data.cells.length });
  emit({ metric: 'population_total', value: data.populationTotal });
  emit({ metric: 'triangle_count', value: map.triangleCount });
  emit({ metric: 'outline_edge_count', value: map.lineCount });
  emit({ metric: 'gpu_buffer_bytes', value: map.gpuMemoryBytes });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ metric: 'visible_cell_low', value: extremes.low?.candidate.cell.population ?? -1 });
  emit({ metric: 'visible_cell_high', value: extremes.high?.candidate.cell.population ?? -1 });
  emit({ info: { gpu: glRenderer(gl), cells: data.cells.length, triangles: map.triangleCount, outlineEdges: map.lineCount,
    estimatedPopulation: data.populationTotal, pixels, lowPopulationPixel: lowPixel, highPopulationPixel: highPixel,
    lowPopulation: extremes.low?.candidate.cell.population, highPopulation: extremes.high?.candidate.cell.population,
    cairoDakarScreen: { cairo, dakar }, runtimeExternalRequests: externalRequests.length, gpuBufferBytes: map.gpuMemoryBytes } });

  emit({ check: 'complete-kontur-snapshot', pass: data.release === '2023-11-01' && data.cells.length === 71_283
    && data.populationTotal === 8_031_924_024 && data.cells.every((cell) => cell.population > 0),
    detail: `${data.release}: ${data.cells.length} unique H3 cells, estimated population sum ${data.populationTotal.toLocaleString()}, no zero or missing cell rows` });
  emit({ check: 'visible-3d-globe', pass: pixels.foregroundPixels > 25_000 && pixels.limbPixels > 1000
    && map.triangleCount > 700_000 && map.gl.getError() === gl.NO_ERROR,
    detail: `${pixels.foregroundPixels} colored pixels, ${pixels.limbPixels} limb pixels, ${map.triangleCount.toLocaleString()} indexed triangles, WebGL ${gl.getError()}` });
  emit({ check: 'low-and-high-population-pixels', pass: !!extremes.low && !!extremes.high && !!lowPixel && !!highPixel
    && extremes.low.candidate.cell.population < extremes.high.candidate.cell.population
    && highPixel[0]! + highPixel[1]! + highPixel[2]! > lowPixel[0]! + lowPixel[1]! + lowPixel[2]! + 90,
    detail: `visible low ${extremes.low?.candidate.cell.population} RGB ${lowPixel?.join(',')}; high ${extremes.high?.candidate.cell.population} RGB ${highPixel?.join(',')}` });
  emit({ check: 'geographic-east-north-orientation', pass: dakar.z > 0.2 && cairo.z > 0.2 && cairo.x > dakar.x && cairo.y < dakar.y,
    detail: `Cairo (${cairo.x.toFixed(1)},${cairo.y.toFixed(1)}) should be east and north of Dakar (${dakar.x.toFixed(1)},${dakar.y.toFixed(1)}) on screen` });
  emit({ check: 'source-and-estimate-disclosures', pass: document.body.innerText.includes('Kontur')
    && document.body.innerText.includes('モデル推計') && document.body.innerText.includes('国勢調査の実測値ではありません')
    && document.body.innerText.includes('CC BY') && document.body.innerText.includes('約22 km'),
    detail: 'Kontur attribution, CC BY, approximate H3 scale and estimated-not-census disclosure are visible.' });
  emit({ check: 'no-runtime-external-requests', pass: externalRequests.length === 0,
    detail: `${externalRequests.length} cross-origin runtime resource requests` });

  const camera = { ...map.camera };
  const prior = map.projectCell(extremes.high!.candidate.cell.h3)!;
  const beforePixel = map.readPixel(prior.x, prior.y);
  map.rotateBy(24, 12);
  const rotated = { ...map.camera }, after = map.projectCell(extremes.high!.candidate.cell.h3)!;
  map.zoomBy(-100);
  const zoomed = { ...map.camera };
  map.reset();
  emit({ check: 'drag-rotation-and-zoom-controls', pass: rotated.yaw !== camera.yaw && rotated.pitch !== camera.pitch
    && zoomed.zoom > camera.zoom && Math.hypot(after.x - prior.x, after.y - prior.y) > 10
    && map.camera.yaw === camera.yaw && map.camera.zoom === camera.zoom,
    detail: `drag changed yaw/pitch; projected selected cell moved ${Math.hypot(after.x - prior.x, after.y - prior.y).toFixed(1)} px; zoom changed ${camera.zoom.toFixed(2)}→${zoomed.zoom.toFixed(2)}; reset restored view` });
  const clickTarget = map.projectCell(extremes.high!.candidate.cell.h3)!;
  const canvas = document.getElementById('map') as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 25, clientX: rect.left + clickTarget.x, clientY: rect.top + clickTarget.y, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 25, clientX: rect.left + clickTarget.x, clientY: rect.top + clickTarget.y, bubbles: true }));
  emit({ check: 'click-inspects-original-grid-value', pass: map.selected?.h3 === extremes.high!.candidate.cell.h3
    && map.selected.population === extremes.high!.candidate.cell.population,
    detail: `selected ${map.selected?.h3 ?? 'none'} with original estimate ${map.selected?.population ?? 'none'}` });
  map.select(null);

  await benchFrames(gl, 72, (i) => {
    map.rotateBy(1.1, Math.sin(i / 9) * 0.45);
    if (i % 8 === 0) map.zoomBy(i % 16 === 0 ? -8 : 8);
  });
  map.reset();
  const errors: number[] = [];
  for (let i = 0; i < 8; i++) { map.draw(); const error = gl.getError(); if (error !== gl.NO_ERROR) errors.push(error); }
  emit({ check: 'camera-frames-no-webgl-errors', pass: errors.length === 0,
    detail: `72 camera frames; GL errors ${errors.length ? errors.join(',') : 'none'}` });
  emit({ done: true });
}
