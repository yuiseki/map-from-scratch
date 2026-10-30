import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { FujiScene } from './main.ts';
import type { Plan } from './labels.ts';

const DEFAULT = { az: 18, el: 36, radius: 26000 };

export async function run(scene: FujiScene, firstFrameMs: number): Promise<void> {
  const { canvas, gl } = scene;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ info: { gpu: glRenderer(gl) } });
  const relief = scene.relief!;
  const dpr = scene.dpr;
  const w = canvas.clientWidth, h = canvas.clientHeight;

  // WebGL pixels (y up); the sky is alpha 0, the terrain alpha 255.
  const terrainPixel = (x: number, y: number): number[] => {
    const out = new Uint8Array(4);
    gl.readPixels(Math.round(x * dpr), Math.round(canvas.height - 1 - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [...out];
  };
  // Label overlay pixels (y down).
  const labelPixel = (x: number, y: number): number[] =>
    [...scene.ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data];
  const placedNamed = (plan: Plan, name: string) => plan.placed.find((p) => p.label.name === name);
  const reasonOf = (plan: Plan, name: string) => plan.rejected.find((r) => r.label.name === name)?.reason ?? 'placed';

  scene.setCamera(DEFAULT);
  scene.draw();

  // 1. The terrain fills the lower view and the sky shows above the horizon.
  const sky = terrainPixel(w / 2, 4);
  const mid = terrainPixel(w / 2, h * 0.6);
  emit({ check: 'terrain-fills-view', pass: sky[3] < 10 && mid[3] > 200, detail: `sky rgba(${sky}); centre rgba(${mid})` });

  // 2. Every label is either placed or rejected with a reason, and enough
  //    of them are placed at the opening view to read the mountain.
  const plan0 = scene.plan;
  const reasons: Record<string, number> = {};
  for (const r of plan0.rejected) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  emit({
    check: 'every-label-accounted',
    pass: plan0.placed.length + plan0.rejected.length === scene.labels.length && plan0.placed.length >= 10,
    detail: `${plan0.placed.length} placed, rejected ${JSON.stringify(reasons)} of ${scene.labels.length}`,
  });

  // 3. The summit label is placed on the summit: its dot is drawn (red, on
  //    the label canvas) where the summit projects.
  const summit = placedNamed(plan0, '富士山');
  const summitAt = scene.screenOf(relief.summitU, relief.summitV, 20);
  let summitOk = false, summitDetail = 'summit label not placed';
  if (summit && summitAt) {
    const err = Math.hypot(summit.anchor[0] - summitAt[0], summit.anchor[1] - summitAt[1]);
    const dot = labelPixel(summit.anchor[0], summit.anchor[1]);
    summitOk = err < 0.5 && dot[3] > 200 && dot[0] > 150 && dot[1] < 80;
    summitDetail = `anchor ${summit.anchor.map((v) => v.toFixed(1))} vs summit ${summitAt.map((v) => v.toFixed(1))} (err ${err.toFixed(2)} px); dot rgba(${dot})`;
  }
  emit({ check: 'summit-label-on-summit', pass: summitOk, detail: summitDetail });

  // 4. Placed labels never overlap: boxes pairwise disjoint, and the text of
  //    each is actually drawn (some opaque pixel inside its box).
  let overlap = 0, blank = 0;
  for (let i = 0; i < plan0.placed.length; i++) {
    const a = plan0.placed[i].box;
    for (let j = i + 1; j < plan0.placed.length; j++) {
      const b = plan0.placed[j].box;
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) overlap++;
    }
    const img = scene.ctx.getImageData(Math.round(a.x0 * dpr), Math.round(a.y0 * dpr), Math.max(1, Math.round((a.x1 - a.x0) * dpr)), Math.max(1, Math.round((a.y1 - a.y0) * dpr))).data;
    let ink = 0;
    for (let k = 3; k < img.length; k += 4) if (img[k] > 200) ink++;
    if (ink < 20) blank++;
  }
  emit({ check: 'labels-do-not-overlap', pass: overlap === 0 && blank === 0, detail: `${plan0.placed.length} placed, ${overlap} overlapping pairs, ${blank} without ink` });

  // 5. The mountain hides the labels on its far side: Fujinomiya 5th
  //    Station (south face) seen low from the north is occluded, and seen
  //    from the south it is not.
  scene.setCamera({ az: 0, el: 10, radius: 22000 });
  scene.draw();
  const fromNorth = reasonOf(scene.plan, '富士宮口五合目');
  scene.setCamera({ az: 180, el: 10, radius: 22000 });
  scene.draw();
  const fromSouth = reasonOf(scene.plan, '富士宮口五合目');
  emit({ check: 'far-side-occluded', pass: fromNorth === 'occluded' && fromSouth !== 'occluded', detail: `Fujinomiya 5th Station from the north: ${fromNorth}; from the south: ${fromSouth}` });

  // 6. The same camera always gives the same plan.
  scene.setCamera(DEFAULT);
  scene.draw();
  const key = (p: Plan) => JSON.stringify(p.placed.map((x) => [x.label.name, x.side, x.anchor.map((v) => v.toFixed(2))]));
  const k1 = key(scene.plan);
  scene.setCamera({ az: DEFAULT.az + 90 });
  scene.draw();
  scene.setCamera(DEFAULT);
  scene.draw();
  emit({ check: 'plan-is-deterministic', pass: k1 === key(scene.plan), detail: `${scene.plan.placed.length} placed both times` });

  // 7. Orbiting moves the labels with the terrain: a 5th station's anchor
  //    swings across the screen and is redrawn there.
  const name = '須走五合目';
  const before = placedNamed(scene.plan, name);
  scene.setCamera({ az: DEFAULT.az + 40 });
  scene.draw();
  const after = placedNamed(scene.plan, name);
  const moved = before && after ? Math.hypot(after.anchor[0] - before.anchor[0], after.anchor[1] - before.anchor[1]) : 0;
  const dotAfter = after ? labelPixel(after.anchor[0], after.anchor[1]) : [0, 0, 0, 0];
  emit({ check: 'labels-follow-orbit', pass: moved > 30 && dotAfter[3] > 200, detail: `${name} moved ${moved.toFixed(0)} px for +40° azimuth; dot alpha ${dotAfter[3]}` });

  // Orbit benchmark: 120 frames, one degree each, terrain and label plan.
  scene.setCamera(DEFAULT);
  scene.draw();
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redraw: number[] = [], plans: number[] = [], intervals: number[] = [];
  let last = await raf();
  for (let i = 0; i < 120; i++) {
    scene.setCamera({ az: scene.camera.az + 1 });
    scene.draw();
    redraw.push(scene.drawMs);
    plans.push(scene.planMs);
    const now = await raf();
    intervals.push(now - last);
    last = now;
  }
  emit({ metric: 'redraw_ms', values: redraw });
  emit({ metric: 'label_ms', values: plans });
  emit({ metric: 'frame_interval_ms', values: intervals });
  scene.setCamera(DEFAULT);
  scene.draw();
  emit({ done: true });
}
