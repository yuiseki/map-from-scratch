import { emit } from '../../../harness/page/bench.ts';
import type { GeoJsonLineMap } from './line.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The base tiles arrive asynchronously (the first frame must not wait for
// them), so give the network a bounded window before reading the frame.
async function waitForBase(map: GeoJsonLineMap, want: number, ms = 15000): Promise<number> {
  const until = performance.now() + ms;
  while (map.baseReady() < want && performance.now() < until) await sleep(50);
  return map.baseReady();
}

// Distinct 8-bit colours across the canvas, sampling every 4th pixel. A flat
// land/ocean fill gives a handful; an OSM Carto tile gives hundreds (roads,
// labels, land use).
function distinctColours(map: GeoJsonLineMap, step = 4): number {
  const { ctx, canvas } = map;
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const seen = new Set<number>();
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
  }
  return seen.size;
}

export async function run(map: GeoJsonLineMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixel = (x: number, y: number): Uint8ClampedArray =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;

  // Verification 0: the raster base map is drawn under the line. The first
  // frame shows the baked land polygons; once tiles arrive the frame gains the
  // road/label detail a single flat fill can never produce.
  // Every tile in view, however many the view needs (512 px tiles drawn at
  // native size: 4 to 6 at 1024x768, not a fixed 8).
  for (let t = 0; t < 300 && !map.baseLoaded(); t++) await sleep(50);
  const visible = map.baseVisible();
  const ready = await waitForBase(map, visible);
  const colours = distinctColours(map);
  emit({
    check: 'basemap-drawn',
    pass: map.baseLoaded() && visible >= 2 && ready === visible && colours > 150,
    detail: `${ready}/${visible} tiles ready, ${colours} distinct colours in the frame`,
  });

  // The line checks read exact RGB, so hide the base and keep only the baked
  // land + line: a road or label under the test point could otherwise pass for
  // the gray line.
  map.setBaseVisible(false);
  map.draw();

  // Test point on route: point 9 in the route
  const testLng = -122.48610019683838;
  const testLat = 37.82880236636284;

  // Verification 1: Line rendered with default gray color (#888888)
  const [sx0, sy0] = map.getScreenPos(testLng, testLat);
  const px0 = pixel(sx0, sy0);
  const isGray0 =
    Math.abs(px0[0] - 136) < 20 &&
    Math.abs(px0[1] - 136) < 20 &&
    Math.abs(px0[2] - 136) < 20;

  emit({
    check: 'line-rendered-gray',
    pass: isGray0,
    detail: `rgba(${px0[0]},${px0[1]},${px0[2]},${px0[3]}) at (${Math.round(sx0)},${Math.round(sy0)})`,
  });

  // Verification 2: Line moves synchronously with pan
  map.setZoom(15);
  const [baseX, baseY] = map.getScreenPos(testLng, testLat);
  map.panBy(60, 40);
  const [pannedX, pannedY] = map.getScreenPos(testLng, testLat);
  const pxPan = pixel(pannedX, pannedY);
  const isGrayPan =
    Math.abs(pxPan[0] - 136) < 20 &&
    Math.abs(pxPan[1] - 136) < 20 &&
    Math.abs(pxPan[2] - 136) < 20;

  emit({
    check: 'line-moves-with-pan',
    pass: isGrayPan && Math.round(pannedX - baseX) === 60 && Math.round(pannedY - baseY) === 40,
    detail: `dx=${Math.round(pannedX - baseX)}, dy=${Math.round(pannedY - baseY)}, rgba(${pxPan[0]},${pxPan[1]},${pxPan[2]},${pxPan[3]})`,
  });

  // Verification 3: Restyling updates stroke color and width
  map.setLineStyle('#3887be', 12);
  const pxStyled = pixel(pannedX, pannedY);
  // #3887be is r=56, g=135, b=190
  const isBlue = pxStyled[0] < 80 && pxStyled[1] > 110 && pxStyled[2] > 160;
  emit({
    check: 'line-restyled',
    pass: isBlue,
    detail: `rgba(${pxStyled[0]},${pxStyled[1]},${pxStyled[2]},${pxStyled[3]}) after setLineStyle('#3887be', 12)`,
  });

  // Verification 4: Line stays anchored to coordinates under zoom
  map.setZoom(16);
  const [zoomX, zoomY] = map.getScreenPos(testLng, testLat);
  const pxZoom = pixel(zoomX, zoomY);
  const isBlueZoom = pxZoom[0] < 80 && pxZoom[1] > 110 && pxZoom[2] > 160;
  emit({
    check: 'line-anchors-on-zoom',
    pass: isBlueZoom,
    detail: `zoom=16 pos=(${Math.round(zoomX)},${Math.round(zoomY)}), rgba(${pxZoom[0]},${pxZoom[1]},${pxZoom[2]},${pxZoom[3]})`,
  });

  // Pan benchmark from the opening view, base map and line both drawn.
  map.setBaseVisible(true);
  map.resetView();
  map.setLineStyle('#888888', 8);
  await waitForBase(map, 8);

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

  // Leave the screenshot on the opening view with the base fully loaded.
  map.resetView();
  await waitForBase(map, 8);
  emit({ done: true });
}
