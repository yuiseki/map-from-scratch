import { emit } from '../../../harness/page/bench.ts';
import type { AttributionMap, Corner } from './attribution.ts';

const BOX_W = 222;
const BOX_H = 28;
const MARGIN = 12;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

export async function run(map: AttributionMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  const isBox = (p: number[]) => p[0] >= 242 && p[1] >= 242 && p[2] >= 242;
  const darkText = (x: number, y: number, bw: number, bh: number): number => {
    const data = ctx.getImageData(
      Math.round(x * dpr), Math.round(y * dpr), Math.round(bw * dpr), Math.round(bh * dpr),
    ).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) n++;
    }
    return n;
  };

  // Expected rects come from the viewport and corner name, not from the map's
  // own getter, so a wrong corner still fails.
  const expected = (corner: Corner): [number, number] => [
    corner.endsWith('left') ? MARGIN : w - BOX_W - MARGIN,
    corner.startsWith('top') ? MARGIN : h - BOX_H - MARGIN,
  ];
  const rectAt = (corner: Corner): boolean => {
    const [x, y] = expected(corner);
    const r = map.getAttributionRect();
    return Math.abs(r.x - x) < 0.5 && Math.abs(r.y - y) < 0.5 &&
      r.width === BOX_W && r.height === BOX_H;
  };
  const sample = (corner: Corner): { box: boolean; text: number } => {
    const [x, y] = expected(corner);
    return {
      box: isBox(rgba(x + BOX_W - 12, y + 6)),
      text: darkText(x, y, BOX_W, BOX_H),
    };
  };

  const project = (lng: number, lat: number): [number, number] => {
    const scale = 256 * Math.pow(2, map.zoom);
    const [cx, cy] = map.center;
    return [
      w / 2 + (mercX(lng) - cx) * scale,
      h / 2 + (mercY(lat) - cy) * scale,
    ];
  };
  const isLand = (p: number[]) => p[0] > 225 && p[1] > 225 && p[2] > 210;
  const isOcean = (p: number[]) => p[0] < 190 && p[1] > 190 && p[2] > 210;

  // 1. The example adds the control at top-left, so that corner is occupied
  // and the text is drawn inside a white box.
  const tl = sample('top-left');
  emit({
    check: 'attribution-visible-top-left',
    pass: map.position === 'top-left' && rectAt('top-left') && tl.box && tl.text > 20,
    detail: `rect ${JSON.stringify(map.getAttributionRect())}, text px ${tl.text}`,
  });

  // 2. The default bottom-right corner is not used any more.
  const br = sample('bottom-right');
  const bl = sample('bottom-left');
  emit({
    check: 'default-corners-free',
    pass: !br.box && !bl.box && br.text < 5 && bl.text < 5,
    detail: `bottom-right ${fmt(rgba(expected('bottom-right')[0] + BOX_W - 12, expected('bottom-right')[1] + 6))}, bottom-left box px ${bl.box}`,
  });

  // 3. The map itself is still drawn (land at the centre, Atlantic offshore).
  const [cx, cy] = project(-77.04, 38.907);
  const [ox, oy] = project(-60, 30);
  emit({
    check: 'map-rendered-at-target',
    pass: isLand(rgba(cx, cy)) && isOcean(rgba(ox, oy)),
    detail: `land ${fmt(rgba(cx, cy))}, ocean ${fmt(rgba(ox, oy))}`,
  });

  // 4. Panning moves the map but not the attribution chrome.
  const rectBeforePan = map.getAttributionRect();
  const beforeX = cx, beforeY = cy;
  map.panBy(120, 90);
  const [ax, ay] = project(-77.04, 38.907);
  const rectAfterPan = map.getAttributionRect();
  const tlAfterPan = sample('top-left');
  emit({
    check: 'attribution-fixed-on-pan',
    pass: Math.abs(ax - beforeX - 120) < 0.01 && Math.abs(ay - beforeY - 90) < 0.01 &&
      rectAfterPan.x === rectBeforePan.x && rectAfterPan.y === rectBeforePan.y &&
      tlAfterPan.box && tlAfterPan.text > 20,
    detail: `map moved (${(ax - beforeX).toFixed(1)},${(ay - beforeY).toFixed(1)}) px, rect unchanged`,
  });
  map.panBy(-120, -90);

  // 5. Zooming moves it neither.
  const rectBeforeZoom = map.getAttributionRect();
  map.setZoom(3.5);
  const rectAfterZoom = map.getAttributionRect();
  const tlAfterZoom = sample('top-left');
  emit({
    check: 'attribution-fixed-on-zoom',
    pass: map.zoom === 3.5 &&
      rectAfterZoom.x === rectBeforeZoom.x && rectAfterZoom.y === rectBeforeZoom.y &&
      tlAfterZoom.box && tlAfterZoom.text > 20,
    detail: `zoom ${map.zoom}, rect ${JSON.stringify(rectAfterZoom)}`,
  });

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

  map.resetView();

  emit({ done: true });
}
