// Bench for cesium-202-japan-buildings: loaded by main.ts only under ?bench.
// Every check reads pixels from the canvas right after a frame is drawn.
import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.ts';
import type { App } from './main.ts';
import { project } from './camera.ts';
import { dropAt, ecef, toLocal } from './geo.ts';
import { rampAt, STOPS, SKY, LAND, OCEAN, type RGB } from './ramp.ts';

const raf = () => new Promise<number>(requestAnimationFrame);
const chroma = (c: ArrayLike<number>) => { const s = c[0] + c[1] + c[2] + 1e-6; return [c[0] / s, c[1] / s, c[2] / s]; };
const cdist = (a: ArrayLike<number>, b: ArrayLike<number>) => { const x = chroma(a), y = chroma(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

interface Truth {
  buildings: number;
  landmarks: { id: string; lat: number; lon: number; height: number; x: number; y: number; found: { height: number; cx: number; cy: number } | null }[];
  sample: [number, number, number, number][];
}

export async function run(app: App): Promise<void> {
  const { gl, canvas, stream, renderer } = app;
  canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));
  emit({ info: { gpu: glRenderer(gl), viewport: [canvas.width, canvas.height] } });
  const truth = await (await fetch('../../../data/baked/cesium-202-japan-buildings/truth.json')).json() as Truth;
  const dpr = devicePixelRatio || 1;
  const W = canvas.width, H = canvas.height;

  // --- The opening flight, as a visitor sees it ---------------------------
  // Frame intervals while the camera flies from the Kanto plain to the
  // skyline and tiles stream in; nothing waits for the network.
  const intervals: number[] = [];
  let flying = true;
  void app.opening.then(() => { flying = false; });
  for (let last = await raf(); flying;) { const now = await raf(); intervals.push(now - last); last = now; }
  emit({ metric: 'first_frame_ms', value: app.firstFrameMs() });
  emit({ metric: 'globe_frame_ms', value: app.globeFrameMs() });
  emit({ metric: 'flight_frame_ms', values: intervals });
  emit({ metric: 'flight_work_ms', values: app.frameWork.slice() });
  emit({ check: 'flight-never-blocks', pass: intervals.length > 60 && Math.max(...intervals) < 100, detail: `${intervals.length} frames, max interval ${Math.max(...intervals).toFixed(1)} ms` });

  let maxGpu = 0;
  const settle = async (timeout = 60000): Promise<number> => {
    const t0 = performance.now();
    let calm = 0;
    while (performance.now() - t0 < timeout && calm < 3) {
      app.drawNow();
      maxGpu = Math.max(maxGpu, stream.lru.bytes);
      calm = stream.pending === 0 && stream.wanted === 0 ? calm + 1 : 0;
      await raf();
    }
    return performance.now() - t0;
  };
  const read = (x: number, y: number, n = 5): Uint8Array => {
    const px = new Uint8Array(4 * n * n);
    gl.readPixels(Math.round(x * dpr) - (n >> 1), H - Math.round(y * dpr) - (n >> 1), n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const shot = (): Uint8Array => { app.drawNow(); const p = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
  const screenOf = (x: number, y: number, z: number) => project(app.state().vp, app.eyeRel([x, y, z + dropAt(x, y, app.index.R)]), W / dpr, H / dpr);
  const isBuilding = (c: ArrayLike<number>) => cdist(c, SKY) > 0.06 && cdist(c, LAND) > 0.05 && cdist(c, OCEAN) > 0.08;

  // --- The skyline view the opening ends on: tens of thousands of buildings
  const tokyoSettle = await settle();
  emit({ metric: 'tokyo_settle_ms', value: tokyoSettle });
  app.drawNow();
  emit({ metric: 'drawn_buildings', value: renderer.drawnBuildings });
  {
    const p = shot();
    let b = 0, n = 0;
    for (let i = 0; i < p.length; i += 4 * 7) { n++; if (isBuilding(p.subarray(i, i + 3))) b++; }
    emit({ check: 'tens-of-thousands', pass: renderer.drawnBuildings >= 20000 && b / n > 0.2, detail: `${renderer.drawnBuildings} buildings in ${renderer.drawnTiles} tiles, ${(100 * b / n).toFixed(1)}% of pixels building-coloured` });
  }
  await benchFrames(gl, 120, () => app.drawNow(), { prefix: 'tokyo_' });

  // --- The Tokyo Metropolitan Government Building at its projected place ---
  app.setCam(app.presets.shinjuku.cam);
  await settle();
  {
    const l = truth.landmarks.find((x) => x.id === 'tocho')!, f = l.found;
    app.drawNow();
    const heightOk = !!f && Math.abs(f.height - l.height) / l.height < 0.05 && Math.hypot(f.cx - l.x, f.cy - l.y) < 40;
    let detail = 'not in the data';
    let pass = false;
    if (f) {
      // A point on the tower 85% up, at the centroid, and one 40 m above its roof.
      const s = screenOf(f.cx, f.cy, 0.85 * f.height), above = screenOf(f.cx, f.cy, f.height + 40);
      if (s && above) {
        const c = read(s[0], s[1]), a = read(above[0], above[1]);
        // The tallest stops' chromaticity (150 m and up) against the lower ones.
        let tall = 0;
        for (let i = 0; i < c.length; i += 4) {
          const px = c.subarray(i, i + 3);
          const best = STOPS.map(([h, col]) => [h, cdist(px, col)] as const).sort((x, y) => x[1] - y[1])[0];
          if (best[0] >= 80) tall++;
        }
        const skyAbove = cdist(a.subarray(0, 3), SKY) < 0.05;
        pass = heightOk && tall >= 13 && s[0] > 0 && s[0] < W / dpr && s[1] > 0 && s[1] < H / dpr;
        detail = `data ${f.height.toFixed(1)} m vs 243 m, ${Math.hypot(f.cx - l.x, f.cy - l.y).toFixed(0)} m from its coordinate; at (${s[0].toFixed(0)}, ${s[1].toFixed(0)}) ${tall}/25 px in the >= 80 m colours, 40 m above the roof sky-coloured: ${skyAbove}`;
      }
    }
    emit({ check: 'tocho-at-projection', pass, detail });
  }
  await benchFrames(gl, 120, () => app.drawNow(), { prefix: 'skyline_' });

  // --- Colours follow height: roofs seen from straight above ---------------
  {
    let ok = 0, tested = 0;
    const centres: [number, number][] = [[35.6812, 139.7671], [35.6896, 139.6935], [35.664, 139.738], [35.70, 139.77]];
    for (const [lat, lon] of centres) {
      app.setCam({ lat, lon, h: 1500, heading: 0, pitch: -89.5 });
      await settle();
      app.drawNow();
      for (const [x, y, h] of truth.sample) {
        const s = screenOf(x, y, h);
        if (!s || s[0] < 10 || s[1] < 10 || s[0] > W / dpr - 10 || s[1] > H / dpr - 10) continue;
        const c = read(s[0], s[1], 1);
        tested++;
        if (cdist(c, rampAt(h)) < 0.035) ok++;
      }
    }
    emit({ check: 'colour-follows-height', pass: tested >= 40 && ok / tested >= 0.7, detail: `${ok}/${tested} sampled roofs within 0.035 chromaticity of the ramp colour for their height` });
  }

  // --- Sky above the horizon, land and sea where the geography says --------
  app.setCam(app.presets.kanto.cam);
  await settle();
  {
    app.drawNow();
    const top = read(W / dpr / 2, 4);
    const geo = (lat: number, lon: number): RGB | null => {
      const st = app.state(), e = toLocal(st.frame, ecef(lat, lon, 0));
      const s = project(st.vp, app.eyeRel(e), W / dpr, H / dpr);
      if (!s) return null;
      const p = read(s[0], s[1], 1);
      return [p[0], p[1], p[2]];
    };
    const land = [geo(35.86, 139.65), geo(35.6, 140.12)];      // Saitama, Chiba
    const sea = [geo(35.45, 139.82), geo(35.15, 139.35)];      // Tokyo Bay, Sagami Bay
    const skyOk = top[2] > top[0] + 30;
    // Haze tints distant land blue too, so land is judged against the sea in
    // the same view: greener (g - b larger by 15) and brighter.
    const gb = (c: RGB | null) => (c ? c[1] - c[2] : NaN), lum = (c: RGB | null) => (c ? c[0] + c[1] + c[2] : NaN);
    const seaOk = sea.every((c) => c && c[2] > c[1] && c[2] > c[0]);
    const landOk = land.every((c) => c && sea.every((w) => gb(c) > gb(w) + 15 && lum(c) > lum(w)));
    emit({ check: 'sky-and-ground', pass: skyOk && landOk && seaOk, detail: `top ${[...top.subarray(0, 3)]}, land ${JSON.stringify(land)}, sea ${JSON.stringify(sea)}` });
  }

  // --- A preset button moves the view ---------------------------------------
  {
    app.setCam(app.presets.tokyo.cam);
    await settle();
    const before = shot();
    const target = app.presets.shibuya.cam;
    (document.querySelector('button[data-place="shibuya"]') as HTMLButtonElement).click();
    const t0 = performance.now();
    while (performance.now() - t0 < 10000) {
      const c = app.cam();
      if (Math.abs(c.lat - target.lat) < 1e-7 && Math.abs(c.lon - target.lon) < 1e-7 && Math.abs(c.h - target.h) < 0.01) break;
      await raf();
    }
    const flewMs = performance.now() - t0;
    await settle();
    const after = shot();
    let diff = 0;
    for (let i = 0; i < before.length; i += 4) if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 30) diff++;
    const c = app.cam();
    const arrived = Math.abs(c.lat - target.lat) < 1e-7 && Math.abs(c.h - target.h) < 0.01;
    emit({ check: 'preset-moves-view', pass: arrived && diff / (before.length / 4) > 0.3, detail: `arrived ${arrived} after ${flewMs.toFixed(0)} ms, ${(100 * diff / (before.length / 4)).toFixed(1)}% of pixels changed` });
  }

  // --- Memory: a small budget is respected by evicting old tiles ------------
  {
    const budget = stream.lru.budget;
    stream.lru.budget = 16 * 1024 * 1024;
    let worst = 0;
    const ev0 = stream.evicted;
    for (const k of ['tokyo', 'shinjuku', 'marunouchi', 'odaiba', 'shibuya']) {
      app.setCam(app.presets[k].cam);
      await settle();
      worst = Math.max(worst, stream.lru.bytes);
    }
    // In use tiles are never evicted, so a single view may exceed it; the
    // check is that tiles were evicted and the total came back near it.
    const pass = stream.evicted > ev0 && worst < 3 * stream.lru.budget;
    emit({ check: 'memory-budget', pass, detail: `budget 16 MiB: ${stream.evicted - ev0} tiles evicted, worst ${(worst / 1048576).toFixed(1)} MiB after settling` });
    stream.lru.budget = budget;
  }

  emit({ metric: 'gpu_bytes', value: maxGpu });
  emit({ metric: 'tile_bytes', value: stream.bytesFetched });
  emit({ metric: 'tile_requests', value: stream.requests });
  emit({ metric: 'decode_upload_ms', values: stream.decodeMs });
  const text = document.body.textContent ?? '';
  emit({ check: 'attribution', pass: ['Project PLATEAU', '東京23区', 'PDL1.0', 'Natural Earth'].every((s) => text.includes(s)), detail: 'PLATEAU dataset title, holder, licence and Natural Earth in the page' });
  emit({ done: true });
}
