import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { CityScene } from './main.ts';

const DEFAULT = { az: 150, el: 42, radius: 900 };

export async function run(scene: CityScene, firstFrameMs: number): Promise<void> {
  const { canvas, gl } = scene;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ info: { gpu: glRenderer(gl) } });
  const mesh = scene.mesh!;
  const dpr = scene.dpr;
  const pixel = (x: number, y: number): number[] => {
    const out = new Uint8Array(4);
    gl.readPixels(Math.round(x * dpr), Math.round(canvas.height - 1 - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [...out];
  };
  // Per building: its highest vertex and the ground under it.
  const nv = mesh.vertices.length / 4;
  const top = new Map<number, number>();
  for (let i = 0; i < nv; i++) {
    const b = mesh.vertices[i * 4 + 3];
    const t = top.get(b);
    if (t === undefined || mesh.vertices[i * 4 + 2] > mesh.vertices[t * 4 + 2]) top.set(b, i);
  }
  const largest = [...scene.buildings.keys()].sort((a, b) => scene.buildings[b].volume - scene.buildings[a].volume).slice(0, 5).map((i) => i + 1);

  // 1. Picking: from straight above, the highest point of each of the five
  //    largest buildings picks that building.
  scene.setCamera({ az: 0, el: 89, radius: 1100 });
  scene.draw();
  const picks = largest.map((b) => {
    const s = scene.screenOf(scene.vertex(top.get(b)!));
    return s ? scene.pick(s[0], s[1]) : -1;
  });
  const ground = scene.pick(4, 4);
  emit({
    check: 'pick-finds-the-building',
    pass: picks.every((p, i) => p === largest[i]) && ground === 0,
    detail: `largest ${largest.join(',')} picked ${picks.join(',')}; corner picks ${ground}`,
  });

  // 2. A click selects: the panel shows the building's BAG id and year, and
  //    the building is redrawn in the highlight colour.
  scene.setCamera(DEFAULT);
  scene.draw();
  const b0 = largest[0];
  const s0 = scene.screenOf(scene.vertex(top.get(b0)!))!;
  const before = pixel(s0[0], s0[1]);
  const r = canvas.getBoundingClientRect();
  const opts = { clientX: r.left + s0[0], clientY: r.top + s0[1], pointerId: 1, bubbles: true };
  canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
  canvas.dispatchEvent(new PointerEvent('pointerup', opts));
  const text = document.getElementById('info')!.textContent ?? '';
  const want = scene.buildings[b0 - 1];
  const lit = pixel(s0[0], s0[1]);
  emit({
    check: 'click-selects-a-building',
    // The highlight is orange: almost no blue against red, where the roof
    // colour has about half as much blue as red. Shading scales both.
    pass: scene.selected === b0 && text.includes(want.id) && text.includes(String(want.year)) && before[2] / before[0] > 0.3 && lit[2] / lit[0] < 0.15,
    detail: `selected ${scene.selected} (want ${b0}); panel "${text.slice(0, 80)}"; pixel rgba(${before}) -> rgba(${lit})`,
  });
  scene.select(0);

  // 3. Heights are real: seen from the side, the tallest building's top
  //    stands above its base by about its height in screen terms.
  let tallest = 1;
  for (const [b, i] of top) if (mesh.vertices[i * 4 + 2] > mesh.vertices[top.get(tallest)! * 4 + 2]) tallest = b;
  scene.setCamera({ az: DEFAULT.az, el: 12, radius: 700 });
  scene.draw();
  const tp = scene.vertex(top.get(tallest)!);
  const base = [tp[0], tp[1], mesh.groundZ];
  const st = scene.screenOf(tp), sb = scene.screenOf(base);
  const rise = st && sb ? sb[1] - st[1] : 0;
  const heightM = tp[2] - mesh.groundZ;
  emit({
    check: 'buildings-stand-up',
    pass: heightM > 20 && rise > 20,
    detail: `tallest ${scene.buildings[tallest - 1].id}: ${heightM.toFixed(1)} m drawn ${rise.toFixed(0)} px tall at el 12`,
  });

  // 4. Roofs and walls are told apart: from above, the tallest roof is the
  //    roof colour (red over blue); from the side, the same building's wall
  //    just under the roof is greyer.
  scene.setCamera({ az: 0, el: 89, radius: 1100 });
  scene.draw();
  const sr = scene.screenOf(tp)!;
  const roofPx = pixel(sr[0], sr[1] + 1);
  emit({
    check: 'roof-colour-from-above',
    pass: roofPx[3] === 255 && roofPx[0] - roofPx[2] > 40,
    detail: `roof pixel rgba(${roofPx})`,
  });

  // 5. Orbit and zoom: a corner building moves with the azimuth, and
  //    zooming in spreads the five largest apart.
  scene.setCamera(DEFAULT);
  scene.draw();
  const p = scene.vertex(top.get(largest[0])!);
  const a0 = scene.screenOf(p);
  scene.setCamera({ az: DEFAULT.az + 45 });
  scene.draw();
  const a1 = scene.screenOf(p);
  const spread = (): number => {
    const pts = largest.map((b) => scene.screenOf(scene.vertex(top.get(b)!))!);
    return Math.max(...pts.map((q) => Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1])));
  };
  scene.setCamera(DEFAULT);
  scene.draw();
  const far = spread();
  scene.setCamera({ radius: DEFAULT.radius / 2 });
  scene.draw();
  const near = spread();
  const moved = a0 && a1 ? Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) : 0;
  emit({ check: 'orbit-and-zoom', pass: moved > 30 && near / far > 1.6, detail: `largest moved ${moved.toFixed(0)} px for +45°; spread ${far.toFixed(0)} -> ${near.toFixed(0)} px at half radius` });

  // Picking cost (an offscreen draw and a one-pixel read), then the orbit.
  scene.setCamera(DEFAULT);
  scene.draw();
  const pickMs: number[] = [];
  for (let i = 0; i < 20; i++) {
    scene.pick(canvas.clientWidth / 2 + i * 5, canvas.clientHeight / 2);
    pickMs.push(scene.pickMs);
  }
  emit({ metric: 'pick_ms', values: pickMs });
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redraw: number[] = [], intervals: number[] = [];
  let last = await raf();
  for (let i = 0; i < 120; i++) {
    scene.setCamera({ az: scene.camera.az + 1 });
    scene.draw();
    redraw.push(scene.drawMs);
    const now = await raf();
    intervals.push(now - last);
    last = now;
  }
  emit({ metric: 'redraw_ms', values: redraw });
  emit({ metric: 'frame_interval_ms', values: intervals });
  scene.setCamera(DEFAULT);
  scene.draw();
  emit({ done: true });
}
