// examples/webgpu/001-gpu-driven-culling/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { CullingMap } from './map.ts';

export async function runBench(map: CullingMap, firstFrameMs: number): Promise<void> {
  const { canvas } = map;

  await new Promise(requestAnimationFrame);
  emit({ info: { gpu: map.gpu } });
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Verification 1: Buildings loaded
  emit({
    check: 'buildings-loaded',
    pass: map.buildingCount === 3992,
    detail: `total building count = ${map.buildingCount}`,
  });

  // Verification 1b: heights and footprints come from the data. The bake
  // once read the footprint area (m2) as the height in cm, so the widest
  // buildings stood tallest. The tallest instance must be 16's tallest
  // building (DuckDB on the GML), and its footprints must add up to 16's.
  const base = '../../../data/baked';
  const ab = await (await fetch(`${base}/webgpu-001-gpu-driven-culling/buildings.bin`)).arrayBuffer();
  const q = new Int16Array(ab, 32, map.buildingCount * 4);
  const inst = Float32Array.from(q, (v) => v / 10); // [x, y, height, size] per building
  const truth = await (await fetch(`${base}/16-plateau-buildings-3d/truth.json`)).json();
  let top = 0, areaSum = 0;
  for (let i = 0; i < map.buildingCount; i++) {
    if (inst[i * 4 + 2] > inst[top * 4 + 2]) top = i;
    areaSum += inst[i * 4 + 3] ** 2;
  }
  const truthArea = (truth.points as number[][]).reduce((s, p) => s + p[2], 0);
  const dist = Math.hypot(inst[top * 4] - truth.tallest.x, inst[top * 4 + 1] - truth.tallest.y);
  const h = inst[top * 4 + 2];
  emit({
    check: 'heights-from-plateau',
    pass: dist < 60 && h > truth.tallest.maxz - 15 && h <= truth.tallest.maxz && Math.abs(areaSum / truthArea - 1) < 0.01,
    detail: `tallest instance ${h.toFixed(1)} m, ${dist.toFixed(0)} m from 16's tallest (maxz ${truth.tallest.maxz} m); footprints ${Math.round(areaSum)} / ${truthArea} m2`,
  });

  // Verification 2: GPU Compute Culling
  const visibleCount = await map.getVisibleCount();
  const cullingPass = visibleCount > 0 && visibleCount < map.buildingCount;
  emit({
    check: 'gpu-compute-culling',
    pass: cullingPass,
    detail: `GPU visible count = ${visibleCount} / ${map.buildingCount} (${((visibleCount / map.buildingCount) * 100).toFixed(1)}% in frustum)`,
  });

  // Verification 3: Buildings rendered
  // Read pixel from center of screen (where Tokyo station building cluster is centered)
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const centerPx = await map.readPixel(cx, cy);
  // Background clear color is vec4(0.05, 0.07, 0.09, 1.0) => ~[13, 18, 23]
  // Buildings are shaded with diffuse lighting [80~220, 80~220, 80~220]
  const isRendered = centerPx[0] > 30 || centerPx[1] > 30 || centerPx[2] > 30;
  emit({
    check: 'buildings-rendered',
    pass: isRendered,
    detail: `rgba(${Array.from(centerPx).join(',')}) at screen center (${cx}, ${cy})`,
  });

  // Verification 4: Camera orbit updates visible count
  const countBefore = visibleCount;
  map.orbitBy(0.8, 0.2);
  const countAfter = await map.getVisibleCount();
  const orbitPass = countAfter !== countBefore && countAfter > 0;
  emit({
    check: 'camera-orbit-updates-count',
    pass: orbitPass,
    detail: `visible count changed on camera rotation: before=${countBefore}, after=${countAfter}`,
  });

  // Orbit Benchmark: 60 frames
  const raf = () => new Promise<number>(requestAnimationFrame);
  await raf();
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.orbitBy(0.015, 0.003 * Math.sin(i * 0.1));
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });
  emit({ done: true });
}
