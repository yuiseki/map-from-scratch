import { emit } from '../../../harness/page/bench.ts';
import type { ShadowRelief } from './relief.ts';

const lum = (p: Uint8ClampedArray): number => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

export async function run(relief: ShadowRelief, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = relief;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const px = (x: number, y: number): Uint8ClampedArray =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;

  // Verification 0: the opening view shows the summit, whatever the window.
  {
    const m = relief.meta!;
    const [sx, sy] = relief.screenOf(m.peakU, m.peakV);
    const w = canvas.width / dpr, h = canvas.height / dpr;
    emit({
      check: 'summit-on-screen',
      pass: sx > 20 && sx < w - 20 && sy > 20 && sy < h - 20,
      detail: `summit u=${m.peakU} v=${m.peakV} at (${Math.round(sx)}, ${Math.round(sy)}) in ${w}x${h}`,
    });
  }

  // Verification 1: the DEM is drawn, and it is shaded relief rather than a
  // flat fill: the summit texel is snow-white (near-neutral) while low forest
  // is green, so the two cannot be confused.
  // The slider is the share of the hillshade pane: 1 is all hillshade,
  // 0 is all cast shadows.
  relief.setSplit(1);
  const meta = relief.meta;
  if (!meta) {
    emit({ check: 'relief-drawn', pass: false, detail: 'relief metadata missing' });
    return;
  }
  const [peakX, peakY] = relief.screenOf(meta.peakU, meta.peakV);
  const peak = px(peakX, peakY);
  const [lowX, lowY] = relief.screenOf(0.08, 0.8);
  const low = px(lowX, lowY);
  const spread = Math.max(peak[0], peak[1], peak[2]) - Math.min(peak[0], peak[1], peak[2]);
  const isSnow = lum(peak) > 60 && spread < 30;
  const isForest = low[1] > low[0] + 10 && low[1] > low[2];

  emit({
    check: 'relief-drawn',
    pass: isSnow && isForest,
    detail: `peak u=${meta.peakU} v=${meta.peakV} at (${Math.round(peakX)}, ${Math.round(peakY)}) rgba(${peak.join(',')}) spread=${spread}; lowland rgba(${low.join(',')})`,
  });

  // Verification 2: the right pane darkens exactly the texels the bake marked
  // as cast shadow, and leaves a lit texel alone.
  const samples = relief.shadowSamples(3);
  let dropped = 0;
  const drops: string[] = [];
  for (const [u, v] of samples) {
    const [x, y] = relief.screenOf(u, v);
    relief.setSplit(1);
    const lit = Array.from(px(x, y));
    relief.setSplit(0);
    const dark = Array.from(px(x, y));
    const diff = lum(new Uint8ClampedArray(lit)) - lum(new Uint8ClampedArray(dark));
    if (diff > 15) dropped++;
    drops.push(`(${u.toFixed(2)},${v.toFixed(2)}) ${Math.round(diff)}`);
  }

  // A lit texel on screen (a probe off screen compares background with
  // background and passes whatever the panes do).
  const [vu0, vv0] = relief.uvAtScreen(0, 0);
  const [vu1, vv1] = relief.uvAtScreen(canvas.width / dpr, canvas.height / dpr);
  let litU = 0.5, litV = 0.5;
  outer: for (let gy = 1; gy <= 5; gy++) {
    for (let gx = 1; gx <= 5; gx++) {
      const u = Math.max(0, vu0) + (gx / 6) * (Math.min(1, vu1) - Math.max(0, vu0));
      const v = Math.max(0, vv0) + (gy / 6) * (Math.min(1, vv1) - Math.max(0, vv0));
      if (relief.shadowAt(u, v) === 1 && relief.shadowAt(u + 0.02, v) === 1) { litU = u; litV = v; break outer; }
    }
  }
  const [lx, ly] = relief.screenOf(litU, litV);
  relief.setSplit(1);
  const litBefore = lum(px(lx, ly));
  relief.setSplit(0);
  const litAfter = lum(px(lx, ly));

  emit({
    check: 'cast-shadows-darken',
    pass: samples.length === 3 && dropped === 3 && litBefore > 20 && Math.abs(litAfter - litBefore) < 6,
    detail: `shadow drops [${drops.join(' ')}] lit (${litU.toFixed(2)},${litV.toFixed(2)}) ${litBefore.toFixed(1)}->${litAfter.toFixed(1)}`,
  });

  // Verification 3: panning moves the terrain one-for-one with the cursor:
  // after panBy(40, 30) the texel that was at (x, y) is at (x+40, y+30).
  relief.setSplit(1);
  relief.center = { u: 0.5, v: 0.5 };
  relief.setZoom(1);
  const probes: [number, number][] = [];
  for (let i = 0; i < 6; i++) probes.push([0.2 + (i % 3) * 0.3, 0.25 + Math.floor(i / 3) * 0.4]);
  const before = probes.map(([u, v]) => {
    const [x, y] = relief.screenOf(u, v);
    return { x, y, rgb: Array.from(px(x, y)) };
  });
  relief.panBy(40, 30);
  let matched = 0;
  for (const p of before) {
    const now = Array.from(px(p.x + 40, p.y + 30));
    if (now.every((c, i) => Math.abs(c - p.rgb[i]) <= 2)) matched++;
  }
  emit({
    check: 'pan-moves-terrain',
    pass: matched >= 5,
    detail: `panBy(40,30): ${matched}/6 probe colours matched at the shifted position`,
  });

  // Verification 4: zooming at the pointer keeps the terrain under it fixed.
  const [fx, fy] = relief.screenOf(0.5, 0.5);
  relief.zoomAtPoint(fx, fy, 2);
  const [ax, ay] = relief.screenOf(0.5, 0.5);
  emit({
    check: 'zoom-keeps-point',
    pass: Math.hypot(ax - fx, ay - fy) < 1.5,
    detail: `centre stayed at (${ax.toFixed(2)}, ${ay.toFixed(2)}) from (${fx.toFixed(2)}, ${fy.toFixed(2)}), zoom 2`,
  });

  // Pan benchmark: 60 frames of 6x4 CSS px, split at 50% so both panes draw.
  relief.setZoom(1);
  relief.setSplit(0.5);
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    relief.panBy(Math.sin(i * 0.2) * 6, Math.cos(i * 0.13) * 4);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  // Leave the view framed for the screenshot.
  relief.frame();
  relief.setSplit(0.5);
  emit({ done: true });
}
