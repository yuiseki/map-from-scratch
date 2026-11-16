import { emit, readBack } from '../../../../harness/page/bench.ts';
import { cellBounds, cellGreenShare, GREEN_BAND_COLORS, greenShareBand, GREEN_CLASS_CODES, NO_DATA_COLOR, WORLD_COVER_CLASSES } from './feeling.ts';
import { frameIntervals } from './frame-metrics.ts';
import type { GreenRenderer } from './renderer.ts';

export function canvasPalette(canvas: HTMLCanvasElement): { counts: number[]; noData: number; extent: [number, number, number, number] } {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas readback unavailable');
  const { data, width, height } = readBack(ctx, 0, 0, canvas.width, canvas.height);
  const counts = Array.from({ length: 6 }, () => 0);
  const byColor = new Map<string, number>();
  const extent: [number, number, number, number] = [width, height, -1, -1];
  const colors = new Map<string, number>(GREEN_BAND_COLORS.map((color, i): [string, number] => [color, i]));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const color = `#${[data[i]!, data[i + 1]!, data[i + 2]!].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    byColor.set(color, (byColor.get(color) ?? 0) + 1);
    const band = colors.get(color);
    if (band !== undefined) {
      counts[band]!++;
      extent[0] = Math.min(extent[0], x); extent[1] = Math.min(extent[1], y);
      extent[2] = Math.max(extent[2], x); extent[3] = Math.max(extent[3], y);
    }
  }
  return { counts, noData: byColor.get(NO_DATA_COLOR) ?? 0, extent };
}

function sourceStats(renderer: GreenRenderer) {
  const classPixels = Object.fromEntries(WORLD_COVER_CLASSES.map((code, i) => [code,
    renderer.data.cells.reduce((sum, cell) => sum + cell[i + 2]!, 0),
  ]));
  const validPixels = renderer.data.cells.reduce((sum, cell) => sum + cell[0]!, 0);
  const nodataPixels = renderer.data.cells.reduce((sum, cell) => sum + cell[1]!, 0);
  const greenPixels = GREEN_CLASS_CODES.reduce((sum, code) => sum + classPixels[code]!, 0);
  const bands = Array.from({ length: 7 }, () => 0);
  for (const cell of renderer.data.cells) bands[greenShareBand(cellGreenShare(cell))]!++;
  return { classPixels, validPixels, nodataPixels, greenPixels, bands };
}

export async function run(renderer: GreenRenderer): Promise<void> {
  const stats = sourceStats(renderer);
  const pixels = canvasPalette(renderer.canvas);
  emit({ metric: 'source_cells', value: renderer.data.cells.length });
  emit({ metric: 'source_valid_pixels', value: stats.validPixels });
  emit({ metric: 'source_nodata_pixels', value: stats.nodataPixels });
  emit({ metric: 'source_green_pixels', value: stats.greenPixels });
  emit({ metric: 'no_data_cells', value: stats.bands[6] });
  for (let i = 0; i < stats.bands.length; i++) emit({ metric: `green_band_${i}_cells`, value: stats.bands[i] });
  emit({ metric: 'rendered_band_0_pixels', value: pixels.counts[0] });
  emit({ metric: 'rendered_band_1_pixels', value: pixels.counts[1] });
  emit({ metric: 'rendered_band_2_pixels', value: pixels.counts[2] });
  emit({ metric: 'rendered_band_3_pixels', value: pixels.counts[3] });
  emit({ metric: 'rendered_band_4_pixels', value: pixels.counts[4] });
  emit({ metric: 'rendered_band_5_pixels', value: pixels.counts[5] });
  emit({ metric: 'rendered_nodata_pixels', value: pixels.noData });
  emit({ metric: 'first_frame_ms', value: renderer.firstFrameMs });

  const sourcePass = renderer.data.grid.rows === 168 && renderer.data.grid.cols === 204
    && renderer.data.cells.length === 34_272 && stats.validPixels === 3_427_200 && stats.nodataPixels === 0
    && stats.greenPixels === 308_135 && stats.classPixels[10] === 273_652 && stats.classPixels[20] === 0
    && stats.classPixels[30] === 34_282 && stats.classPixels[40] === 9_964 && stats.classPixels[50] === 2_779_755
    && stats.classPixels[60] === 17_594 && stats.classPixels[70] === 0 && stats.classPixels[80] === 311_752
    && stats.classPixels[90] === 201 && stats.classPixels[95] === 0 && stats.classPixels[100] === 0;
  emit({ check: 'source-counts-and-green-formula', pass: sourcePass,
    detail: `${renderer.data.cells.length} cells; valid=${stats.validPixels}; NoData=${stats.nodataPixels}; green=${stats.greenPixels}; source class pixels=${JSON.stringify(stats.classPixels)}` });

  const bandPass = pixels.counts.every((n, i) => i === 0 ? n > 0 : n > 0)
    && pixels.noData === 0 && stats.bands[6] === 0
    && document.body.innerText.includes('NoData · 対象範囲 0セル');
  emit({ check: 'rendered-green-bands-and-no-data', pass: bandPass,
    detail: `canvas pixels by green band=${pixels.counts.join(',')}; genuine source NoData cells/pixels=${stats.bands[6]}/${stats.nodataPixels}; no-data colour pixels=${pixels.noData}` });

  const sampleIndex = renderer.data.cells.reduce((best, cell, i, cells) => {
    const score = cellGreenShare(cell) ?? -1, bestScore = cellGreenShare(cells[best]!) ?? -1;
    return score > bestScore ? i : best;
  }, 0);
  const sampleRow = Math.floor(sampleIndex / renderer.data.grid.cols), sampleCol = sampleIndex % renderer.data.grid.cols;
  const sampleBounds = cellBounds(renderer.data.grid, renderer.data.grid.firstRow + sampleRow, renderer.data.grid.firstCol + sampleCol);
  const samplePoint: [number, number] = [(sampleBounds.west + sampleBounds.east) / 2, (sampleBounds.south + sampleBounds.north) / 2];
  const [sampleX, sampleY] = renderer.screenPositionFor(samplePoint);
  renderer.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: sampleX, clientY: sampleY, pointerId: 91, bubbles: true }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: sampleX, clientY: sampleY, pointerId: 91, bubbles: true }));
  const sample = renderer.data.cells[sampleIndex]!;
  const selected = document.getElementById('selection')!.innerText;
  const sourceCellPass = selected.includes(`row ${renderer.data.grid.firstRow + sampleRow}`)
    && selected.includes(`col ${renderer.data.grid.firstCol + sampleCol}`)
    && selected.includes(String(sample[2]!)) && selected.includes(String(sample[6]!));
  emit({ check: 'selected-cell-preserves-raw-class-counts', pass: sourceCellPass,
    detail: `source row/col=${renderer.data.grid.firstRow + sampleRow}/${renderer.data.grid.firstCol + sampleCol}; green=${cellGreenShare(sample)}; tree=${sample[2]}, built=${sample[6]}` });

  const legendPass = [0, 10, 25, 50, 75, 100].every((number) => document.body.innerText.includes(String(number)))
    && document.body.innerText.includes('農地 40 は含めません')
    && document.body.innerText.includes('感情、休息の感じ方、公園の境界');
  emit({ check: 'legend-formula-and-interpretation', pass: legendPass,
    detail: 'Ordered share legend, exact numerator, cropland exclusion, and proxy caveat are visible.' });
  emit({ check: 'source-attribution-license', pass: document.body.innerText.includes('© ESA WorldCover project 2021')
    && document.body.innerText.includes('Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium')
    && document.body.innerText.includes('CC BY 4.0')
    && document.querySelector('a[href*="10.5281/zenodo.7254221"]') !== null,
    detail: 'ESA/Copernicus attribution, licence and source DOI are visible.' });

  const zoomBefore = renderer.camera.zoom;
  document.getElementById('zoom-in')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const buttonZoom = renderer.camera.zoom > zoomBefore;
  document.getElementById('reset')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const buttonReset = renderer.camera.zoom === 1 && renderer.camera.panX === 0 && renderer.camera.panY === 0;
  const wheelBefore = renderer.camera.zoom;
  renderer.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -35, deltaMode: 0, clientX: 900, clientY: 500, bubbles: true, cancelable: true }));
  const wheelZoom = renderer.camera.zoom > wheelBefore;
  renderer.resetView();
  const beforePan = renderer.camera.panX;
  const dragX = renderer.canvas.clientWidth * .9, dragY = renderer.canvas.clientHeight * .78;
  renderer.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: dragX, clientY: dragY, pointerId: 93, bubbles: true }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: dragX + 24, clientY: dragY + 16, pointerId: 93, bubbles: true }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: dragX + 24, clientY: dragY + 16, pointerId: 93, bubbles: true }));
  const panWorks = renderer.camera.panX !== beforePan;
  renderer.resetView();
  emit({ check: 'pan-zoom-reset-controls', pass: buttonZoom && buttonReset && wheelZoom && panWorks
    && document.getElementById('scale')!.textContent!.includes('縮尺'),
    detail: `button zoom=${buttonZoom}; wheel zoom=${wheelZoom}; pan=${panWorks}; reset=${buttonReset}; scale present` });

  const keyboardBefore = document.getElementById('selection')!.innerText;
  renderer.canvas.focus(); renderer.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const keyboardPass = document.getElementById('selection')!.innerText !== keyboardBefore;
  emit({ check: 'keyboard-cell-inspection', pass: keyboardPass && renderer.canvas.tabIndex >= 0,
    detail: `canvas is focusable and arrow navigation changed the selected source cell=${keyboardPass}` });

  const offOrigin = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-requests', pass: offOrigin.length === 0, detail: `${offOrigin.length} off-origin requests` });

  const idleTimestamps: number[] = [];
  for (let i = 0; i < 61; i++) idleTimestamps.push(await new Promise<number>((resolve) => requestAnimationFrame(resolve)));
  const idleFrames = frameIntervals(idleTimestamps);
  emit({ metric: 'idle_frame_ms', values: idleFrames });

  const frames: number[] = [], draws: number[] = [];
  let previousFrame = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
  for (let i = 0; i < 60; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame((frameTime) => {
      frames.push(frameTime - previousFrame);
      previousFrame = frameTime;
      renderer.camera.panX = (i % 2 ? 1 : -1) * 9;
      renderer.camera.panY = Math.sin(i / 9) * 5;
      const start = performance.now(); renderer.draw(); draws.push(performance.now() - start);
      resolve();
    }));
  }
  renderer.resetView();
  emit({ metric: 'frame_ms', values: frames });
  emit({ metric: 'draw_cpu_ms', values: draws });
  emit({ info: { renderer: 'Dedicated Canvas 2D row-major raster of WorldCover cells', cellCount: renderer.data.cells.length,
    sourceGrid: renderer.data.grid, sourceClassPixels: stats.classPixels, greenNumerator: '10+20+30+90', greenShare: stats.greenPixels / stats.validPixels,
    interpretation: 'physical land-cover proxy only; no emotion, access, safety, or experience' } });
  emit({ done: true });
}
