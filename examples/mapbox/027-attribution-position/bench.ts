import { emit } from '../../../harness/page/bench.ts';
import type { AttributionMap, Corner } from './attribution.ts';

const BOX_W = 222;
const BOX_H = 28;
const MARGIN = 12;

export async function run(map: AttributionMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  const isBox = (p: number[]) => p[0] >= 242 && p[1] >= 242 && p[2] >= 242;
  const darkText = (x: number, y: number, w: number, h: number): number => {
    const data = ctx.getImageData(
      Math.round(x * dpr), Math.round(y * dpr), Math.round(w * dpr), Math.round(h * dpr),
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
    corner.endsWith('left') ? MARGIN : canvas.clientWidth - BOX_W - MARGIN,
    corner.startsWith('top') ? MARGIN : canvas.clientHeight - BOX_H - MARGIN,
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
  const click = (corner: Corner) => {
    (document.getElementById(`pos-${corner}`) as HTMLButtonElement).click();
  };

  // 1. Default corner is bottom-left, with a white box and legible dark text.
  const bl = sample('bottom-left');
  emit({
    check: 'attribution-visible-bottom-left',
    pass: map.position === 'bottom-left' && rectAt('bottom-left') && bl.box && bl.text > 20,
    detail: `rect ${JSON.stringify(map.getAttributionRect())}, text px ${bl.text}`,
  });

  // 2. Clicking TR moves the box to the top-right and frees the bottom-left.
  const blSpot: [number, number] = [expected('bottom-left')[0] + BOX_W - 12, expected('bottom-left')[1] + 6];
  click('top-right');
  const oldBl = rgba(blSpot[0], blSpot[1]);
  const tr = sample('top-right');
  emit({
    check: 'attribution-moves-to-top-right',
    pass: map.position === 'top-right' && rectAt('top-right') && tr.box && tr.text > 20 && !isBox(oldBl),
    detail: `top-right rect ${JSON.stringify(map.getAttributionRect())}, old px ${fmt(oldBl)}`,
  });

  // 3. Clicking BR moves it to the bottom-right.
  const trSpot: [number, number] = [expected('top-right')[0] + BOX_W - 12, expected('top-right')[1] + 6];
  click('bottom-right');
  const oldTr = rgba(trSpot[0], trSpot[1]);
  const br = sample('bottom-right');
  emit({
    check: 'attribution-moves-to-bottom-right',
    pass: map.position === 'bottom-right' && rectAt('bottom-right') && br.box && br.text > 20 && !isBox(oldTr),
    detail: `bottom-right rect ${JSON.stringify(map.getAttributionRect())}, old px ${fmt(oldTr)}`,
  });

  // 4. Panning the map must not move the attribution chrome.
  const rectBeforePan = map.getAttributionRect();
  const anchorBefore = map.getScreenPos(-96, 37.8);
  map.panBy(120, 90);
  const rectAfterPan = map.getAttributionRect();
  const brAfterPan = sample('bottom-right');
  const anchorAfter = map.getScreenPos(-96, 37.8);
  const mapMoved = Math.abs(anchorAfter[0] - anchorBefore[0] - 120) < 0.01 &&
    Math.abs(anchorAfter[1] - anchorBefore[1] - 90) < 0.01;
  emit({
    check: 'attribution-fixed-on-pan',
    pass: mapMoved &&
      rectAfterPan.x === rectBeforePan.x && rectAfterPan.y === rectBeforePan.y &&
      brAfterPan.box && brAfterPan.text > 20,
    detail: `map moved ${(anchorAfter[0] - anchorBefore[0]).toFixed(1)},${(anchorAfter[1] - anchorBefore[1]).toFixed(1)} px, rect unchanged`,
  });
  map.panBy(-120, -90);

  // 5. Zooming must not move it either.
  const rectBeforeZoom = map.getAttributionRect();
  map.setZoom(4.5);
  const rectAfterZoom = map.getAttributionRect();
  const brAfterZoom = sample('bottom-right');
  emit({
    check: 'attribution-fixed-on-zoom',
    pass: map.zoom === 4.5 &&
      rectAfterZoom.x === rectBeforeZoom.x && rectAfterZoom.y === rectBeforeZoom.y &&
      brAfterZoom.box && brAfterZoom.text > 20,
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
