import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import { colorForMag, radiusForMag, type DataDrivenCirclesMap } from './map.ts';

export async function run(map: DataDrivenCirclesMap, firstFrameMs: number): Promise<void> {
  const { gl } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ info: { gpu: glRenderer(gl), quakes: map.count } });

  const w = map.canvas.width / map.dpr;
  const h = map.canvas.height / map.dpr;
  const rgba = (px: Uint8Array): string => `rgba(${px[0]},${px[1]},${px[2]},${px[3]})`;

  emit({
    check: 'quakes-loaded',
    pass: map.count > 5000 && map.points.length === map.count * 3 && map.magMin < 1.5 && map.magMax > 7,
    detail: `${map.count} quakes, M${map.magMin.toFixed(2)}-${map.magMax.toFixed(2)}`,
  });

  const low = colorForMag(1);
  const mid = colorForMag(3);
  const high = colorForMag(6);
  emit({
    check: 'colour-ramp-matches-stops',
    pass:
      low[0] === 252 && low[1] === 161 && low[2] === 7 &&
      mid[0] === 46 && mid[1] === 83 && mid[2] === 255 &&
      high[0] === 255 && high[1] === 0 && high[2] === 64 &&
      radiusForMag(1) === 3 && radiusForMag(6) === 14,
    detail: `M1 ${low}, M3 ${mid}, M6 ${high}; r M1=3, M6=14`,
  });

  map.setZoom(6);
  const isolated = (index: number, minGap: number): boolean => {
    const p = map.screenOf(index);
    if (p.x < 50 || p.x > w - 50 || p.y < 50 || p.y > h - 50) return false;
    for (let j = 0; j < map.count; j++) {
      if (j === index) continue;
      const q = map.screenOf(j);
      if (Math.hypot(q.x - p.x, q.y - p.y) < minGap) return false;
    }
    return true;
  };
  const pick = (lo: number, hi: number): number => {
    let seen = 0;
    for (let i = 0; i < map.count; i++) {
      const m = map.magOf(i);
      if (m < lo || m > hi) continue;
      map.centerOn(i);
      if (isolated(i, 40)) return i;
      if (++seen > 400) break;
    }
    return -1;
  };

  const small = pick(0.95, 1.2);
  const smallPx = small >= 0 ? map.readPixel(w / 2, h / 2) : new Uint8Array(4);
  emit({
    check: 'low-magnitude-circle-colour',
    pass: small >= 0 && smallPx[0] > 200 && smallPx[1] > 100 && smallPx[1] < 210 && smallPx[2] < 90 && smallPx[3] > 200,
    detail: `M${small >= 0 ? map.magOf(small).toFixed(2) : '?'} ${rgba(smallPx)} at centre`,
  });

  const big = pick(5.5, 9);
  const bigR = big >= 0 ? radiusForMag(map.magOf(big)) : 0;
  const insidePx = big >= 0 ? map.readPixel(w / 2 + bigR * 0.5, h / 2) : new Uint8Array(4);
  const outsidePx = big >= 0 ? map.readPixel(w / 2 + bigR + 8, h / 2) : new Uint8Array(4);
  emit({
    check: 'high-magnitude-circle-colour',
    pass: big >= 0 && insidePx[0] > 200 && insidePx[1] < 90 && insidePx[2] >= 20 && insidePx[2] <= 140 && insidePx[3] > 200,
    detail: `M${big >= 0 ? map.magOf(big).toFixed(2) : '?'} ${rgba(insidePx)} at 0.5R, R=${bigR.toFixed(1)}px`,
  });
  emit({
    check: 'radius-follows-magnitude',
    pass:
      big >= 0 &&
      bigR > radiusForMag(1) * 3 &&
      insidePx[3] > 200 &&
      outsidePx[3] < 60,
    detail: `inside ${rgba(insidePx)}, outside ${rgba(outsidePx)} at R+8`,
  });

  if (big >= 0) {
    map.centerOn(big);
    const before = map.screenOf(big);
    map.panBy(40, 20);
    const after = map.screenOf(big);
    const movedPx = map.readPixel(after.x, after.y);
    emit({
      check: 'pan-moves-circles',
      pass:
        Math.round(after.x - before.x) === 40 &&
        Math.round(after.y - before.y) === 20 &&
        movedPx[3] > 200 && movedPx[0] > 200,
      detail: `dx=${Math.round(after.x - before.x)}, dy=${Math.round(after.y - before.y)}, ${rgba(movedPx)}`,
    });
    map.centerOn(big);
    map.setZoom(7);
    const zoomPx = map.readPixel(w / 2, h / 2);
    emit({
      check: 'zoom-keeps-circles',
      pass: zoomPx[3] > 200 && zoomPx[0] > 200,
      detail: `${rgba(zoomPx)} at zoom 6 (the maximum)`,
    });

    // Wheel zoom must keep the place under the pointer, not the screen centre.
    map.setZoom(3);
    map.centerOn(big);
    map.panBy(120, -60);
    const anchor = map.screenOf(big);
    map.zoomAt(4, anchor.x, anchor.y);
    const held = map.screenOf(big);
    emit({
      check: 'wheel-zoom-keeps-point',
      pass: map.cam.zoom === 4 && Math.abs(held.x - anchor.x) < 1.5 && Math.abs(held.y - anchor.y) < 1.5,
      detail: `quake at (${anchor.x.toFixed(1)}, ${anchor.y.toFixed(1)}) before, (${held.x.toFixed(1)}, ${held.y.toFixed(1)}) after zoom 4`,
    });
  }

  map.setZoom(2);
  map.setCenter(0, 20);
  const initial = { ...map.cam };
  await benchFrames(gl, 300, (i) => {
    const t = i / 299;
    map.cam.x = initial.x + 0.025 * Math.sin(t * Math.PI * 2);
    map.cam.y = initial.y + 0.018 * Math.sin(t * Math.PI * 4);
    map.cam.zoom = initial.zoom + 2 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
    map.draw();
  });
  Object.assign(map.cam, initial);
  map.draw();

  emit({ done: true });
}
