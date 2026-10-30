import { emit } from '../../../harness/page/bench.ts';
import type { MarkerPopupMap } from './marker-popup.ts';

const MONUMENT: [number, number] = [-77.0353, 38.8895];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

async function waitForBase(map: MarkerPopupMap, want: number, ms = 15000): Promise<number> {
  const until = performance.now() + ms;
  while (map.baseReady() < want && performance.now() < until) await sleep(50);
  return map.baseReady();
}

function distinctColours(map: MarkerPopupMap, step = 4): number {
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

export async function run(map: MarkerPopupMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): number[] =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p.join(',')})`;
  const isWhite = (p: number[]) => p[0] > 245 && p[1] > 245 && p[2] > 245;
  const isLand = (p: number[]) => p[0] > 225 && p[1] > 225 && p[2] > 215;
  const isSky = (p: number[]) => p[2] > 210 && p[2] - p[0] > 50 && p[1] > 180;
  const isStone = (p: number[]) => p[0] > 225 && p[1] > 215 && p[2] > 200 && p[2] < 240;

  // Independent projection: bench recomputes screen positions from the
  // exposed mercator centre and zoom instead of trusting getScreenPos.
  const project = (lng: number, lat: number): [number, number] => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const scale = 256 * Math.pow(2, map.zoom);
    const [mx, my] = map.center;
    return [w / 2 + (mercX(lng) - mx) * scale, h / 2 + (mercY(lat) - my) * scale];
  };

  const click = (x: number, y: number) => {
    for (const type of ['pointerdown', 'pointerup'] as const) {
      canvas.dispatchEvent(new PointerEvent(type, {
        clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
        button: 0, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true, cancelable: true,
      }));
    }
  };

  // 0. Regional view needs a real base map, not a flat land fill.
  for (let t = 0; t < 300 && !map.baseLoaded(); t++) await sleep(50);
  const visible = map.baseVisible();
  const ready = await waitForBase(map, visible);
  const colours = distinctColours(map);
  emit({
    check: 'basemap-drawn',
    pass: map.baseLoaded() && visible >= 2 && ready === visible && colours > 150,
    detail: `${ready}/${visible} tiles ready, ${colours} distinct colours`,
  });

  // Exact-colour checks run without the raster base: roads and labels under
  // a sampled pixel would otherwise blur the marker and popup colours.
  map.setBaseVisible(false);
  map.draw();

  const [mx, my] = project(MONUMENT[0], MONUMENT[1]);
  const stone = pixelAt(mx, my);
  const sky = pixelAt(mx + 12, my - 14);
  const outside = pixelAt(mx + 36, my);
  emit({
    check: 'marker-on-monument',
    pass: isStone(stone) && isSky(sky) && isLand(outside),
    detail: `centre ${fmt(stone)}, sky ${fmt(sky)}, outside ${fmt(outside)} at (${mx.toFixed(1)},${my.toFixed(1)})`,
  });

  const hiddenAt = pixelAt(mx, my - 25 - 40);
  emit({
    check: 'popup-hidden-initially',
    pass: !map.popupVisible && !isWhite(hiddenAt),
    detail: `popupVisible=${map.popupVisible}, above marker ${fmt(hiddenAt)}`,
  });

  click(mx, my);
  const b1 = map.getPopupBounds();
  const bubble1 = pixelAt(b1.x + 188, b1.y + 34);
  const tipX1 = b1.x + b1.width / 2, tipY1 = b1.y + b1.height + 10;
  emit({
    check: 'marker-click-opens-popup',
    pass: map.popupVisible && isWhite(bubble1) &&
      Math.abs(b1.x + b1.width / 2 - mx) < 0.5 &&
      Math.abs(tipX1 - mx) < 0.5 && Math.abs(tipY1 - (my - 25)) < 0.5,
    detail: `tip (${tipX1.toFixed(1)},${tipY1.toFixed(1)}) expected (${mx.toFixed(1)},${(my - 25).toFixed(1)}), bubble ${fmt(bubble1)}`,
  });

  const btn = b1.closeBtn;
  const oldSpot = [b1.x + 188, b1.y + 34] as const;
  click(btn.x + btn.size / 2, btn.y + btn.size / 2);
  const closedAt = pixelAt(oldSpot[0], oldSpot[1]);
  emit({
    check: 'close-button-closes-popup',
    pass: !map.popupVisible && !isWhite(closedAt),
    detail: `popupVisible=${map.popupVisible}, former bubble ${fmt(closedAt)}`,
  });

  click(mx, my);
  map.panBy(60, 40);
  const [nx, ny] = project(MONUMENT[0], MONUMENT[1]);
  const b2 = map.getPopupBounds();
  const bubble2 = pixelAt(b2.x + 188, b2.y + 34);
  emit({
    check: 'popup-follows-pan',
    pass: map.popupVisible &&
      Math.round(nx - mx) === 60 && Math.round(ny - my) === 40 &&
      Math.abs(b2.x + b2.width / 2 - nx) < 0.5 &&
      Math.abs(b2.y + b2.height + 10 - (ny - 25)) < 0.5 && isWhite(bubble2),
    detail: `marker moved (${Math.round(nx - mx)},${Math.round(ny - my)}), tip offset ${(b2.y + b2.height + 10 - (ny - 25)).toFixed(2)} px, bubble ${fmt(bubble2)}`,
  });

  map.zoomAtPoint(nx, ny, 6);
  const [zx, zy] = project(MONUMENT[0], MONUMENT[1]);
  const b3 = map.getPopupBounds();
  const bubble3 = pixelAt(b3.x + 188, b3.y + 34);
  emit({
    check: 'popup-anchors-on-zoom',
    pass: map.zoom === 6 &&
      Math.abs(zx - nx) < 1.5 && Math.abs(zy - ny) < 1.5 &&
      Math.abs(b3.x + b3.width / 2 - zx) < 0.5 &&
      Math.abs(b3.y + b3.height + 10 - (zy - 25)) < 0.5 && isWhite(bubble3),
    detail: `zoom ${map.zoom}, marker (${zx.toFixed(1)},${zy.toFixed(1)}) from (${nx.toFixed(1)},${ny.toFixed(1)}), bubble ${fmt(bubble3)}`,
  });

  // 6. Pan cost and frame pacing with the popup open.
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

  // Leave the opening view with the base loaded and the popup open.
  map.setBaseVisible(true);
  map.resetView();
  await waitForBase(map, map.baseVisible());
  click(canvas.clientWidth / 2, canvas.clientHeight / 2);

  emit({ done: true });
}
