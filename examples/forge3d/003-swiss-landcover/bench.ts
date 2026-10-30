import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { SwissScene } from './main.ts';
import { classAt, uvOf, worldOf } from './terrain.ts';

const DEFAULT = { az: 180, el: 58, radius: 430000 };

export async function run(scene: SwissScene, firstFrameMs: number): Promise<void> {
  const { canvas, gl } = scene;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ info: { gpu: glRenderer(gl) } });
  const r = scene.relief!;
  const dpr = scene.dpr;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const centre = scene.target.slice();
  const pixel = (x: number, y: number): number[] => {
    const out = new Uint8Array(4);
    gl.readPixels(Math.round(x * dpr), Math.round(canvas.height - 1 - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [...out];
  };
  const at = (lon: number, lat: number): number[] => {
    const [u, v] = uvOf(r, lon, lat);
    const s = scene.screenOf(u, v);
    return s ? pixel(s[0], s[1]) : [0, 0, 0, -1];
  };
  scene.setCamera(DEFAULT);
  scene.draw();

  // 1. Inside the border is drawn, outside it is not: Bern and Lucerne are
  //    opaque; Mulhouse (France) and Annecy (France), inside the grid's
  //    rectangle but outside Switzerland, are transparent.
  const inside = [['Bern', 7.447, 46.948], ['Luzern', 8.31, 47.05]].map(([n, lon, lat]) => [n, at(lon as number, lat as number)[3]]);
  const outside = [['Mulhouse', 7.339, 47.75], ['Annecy', 6.129, 45.9]].map(([n, lon, lat]) => [n, at(lon as number, lat as number)[3]]);
  emit({
    check: 'drawn-inside-the-border',
    pass: inside.every(([, a]) => (a as number) > 200) && outside.every(([, a]) => a === 0),
    detail: [...inside, ...outside].map(([n, a]) => `${n} alpha ${a}`).join(', '),
  });

  // 2. The drape shows the right class. For each class, the uniform 9x9
  //    block of cells nearest the centre is brought close to the camera and
  //    its middle pixel is matched against the palette (each colour scaled
  //    to its best fit, since the hillshade scales it).
  const pal = scene.legend.map((c) => ({ c, rgb: [1, 3, 5].map((i) => parseInt(c.colour.slice(i, i + 2), 16)) }));
  const nearest = (p: number[]): string => {
    let best = '', err = Infinity;
    for (const { c, rgb } of pal) {
      const s = Math.min(1.2, Math.max(0.45, (p[0] * rgb[0] + p[1] * rgb[1] + p[2] * rgb[2]) / (rgb[0] ** 2 + rgb[1] ** 2 + rgb[2] ** 2)));
      const e = rgb.reduce((acc, v, i) => acc + (Math.min(255, v * s) - p[i]) ** 2, 0);
      if (e < err) { err = e; best = c.name; }
    }
    return best;
  };
  const uniformBlock = (k: number): [number, number] | null => {
    let best: [number, number] | null = null, bestD = Infinity;
    for (let y = 4; y < r.height - 4; y += 2) {
      for (let x = 4; x < r.width - 4; x += 2) {
        if (r.classes[y * r.width + x] !== k) continue;
        const d = (x - r.width / 2) ** 2 + (y - r.height / 2) ** 2;
        if (d >= bestD) continue;
        let ok = true;
        for (let dy = -4; dy <= 4 && ok; dy++) for (let dx = -4; dx <= 4 && ok; dx++) ok = r.classes[(y + dy) * r.width + x + dx] === k;
        if (ok) { best = [(x + 0.5) / r.width, (y + 0.5) / r.height]; bestD = d; }
      }
    }
    return best;
  };
  const results: string[] = [];
  let matched = 0, tried = 0;
  for (const { c } of pal) {
    const uv = uniformBlock(c.index);
    if (!uv) continue;
    tried++;
    scene.target = worldOf(r, uv[0], uv[1]);
    scene.setCamera({ az: 180, el: 75, radius: 30000 });
    scene.draw();
    const s = scene.screenOf(uv[0], uv[1])!;
    const got = nearest(pixel(s[0], s[1]));
    if (got === c.name && classAt(r, uv[0], uv[1]) === c.index) matched++;
    results.push(`${c.name}->${got}`);
  }
  scene.target = centre;
  emit({ check: 'drape-shows-the-class', pass: tried >= 5 && matched === tried, detail: `${matched}/${tried}: ${results.join(', ')}` });

  // 3. The legend lists exactly the classes present, in their colours, and
  //    their shares add up to the whole country.
  const items = [...document.querySelectorAll<HTMLLIElement>('#legend li')];
  const swatches = items.map((li) => getComputedStyle(li.querySelector('i')!).backgroundColor);
  const want = scene.legend.map((c) => `rgb(${[1, 3, 5].map((i) => parseInt(c.colour.slice(i, i + 2), 16)).join(', ')})`);
  const present = new Set<number>();
  for (const k of r.classes) if (k) present.add(k);
  const shareSum = scene.legend.reduce((a, c) => a + c.share, 0);
  emit({
    check: 'legend-matches-data',
    pass: items.length === present.size && scene.legend.every((c) => present.has(c.index)) && swatches.every((s, i) => s === want[i]) && Math.abs(shareSum - 1) < 0.002,
    detail: `${items.length} legend rows, ${present.size} classes in the grid, shares sum ${shareSum.toFixed(4)}`,
  });

  // 4. Orbiting turns the country: Geneva swings across the screen.
  scene.setCamera(DEFAULT);
  scene.draw();
  const geneva = uvOf(r, 6.143, 46.204);
  const g0 = scene.screenOf(geneva[0], geneva[1]);
  scene.setCamera({ az: DEFAULT.az + 45 });
  scene.draw();
  const g1 = scene.screenOf(geneva[0], geneva[1]);
  const swing = g0 && g1 ? Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) : 0;
  emit({ check: 'orbit-turns-the-country', pass: swing > 100 && at(7.447, 46.948)[3] > 200, detail: `Geneva moved ${swing.toFixed(0)} px for +45° azimuth` });

  // 5. Zooming in enlarges the country: Geneva to Zurich on screen.
  const zurich = uvOf(r, 8.541, 47.377);
  const span = (): number => {
    const a = scene.screenOf(geneva[0], geneva[1]), b = scene.screenOf(zurich[0], zurich[1]);
    return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0;
  };
  scene.setCamera(DEFAULT);
  scene.draw();
  const far = span();
  scene.setCamera({ radius: DEFAULT.radius / 2 });
  scene.draw();
  const near = span();
  emit({ check: 'zoom-changes-scale', pass: far > 0 && near / far > 1.6 && near < Math.hypot(w, h) * 2, detail: `Geneva-Zurich ${far.toFixed(0)} px at r=430 km, ${near.toFixed(0)} px at r=215 km` });

  // Orbit benchmark: 120 frames, one degree each.
  scene.setCamera(DEFAULT);
  scene.draw();
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
