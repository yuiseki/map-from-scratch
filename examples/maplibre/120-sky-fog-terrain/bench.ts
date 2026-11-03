// Bench for maplibre-120-sky-fog-terrain (loaded only with ?bench).
// Pixels are read from the default framebuffer right after a synchronous
// draw (gl.readPixels): what the compositor shows. The whole frame is read
// once per state and sampled on a grid.
import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import { eyeOf, horizonY, CLEARANCE, MIN_DIST, MAX_DIST, MAX_PITCH, type Cam } from './camera.ts';
import { hexToRgb, NO_SKY } from './sky.ts';

interface Page {
  gl: WebGL2RenderingContext;
  ui: Record<string, HTMLInputElement>;
  firstFrame: number; triangles: number;
  ground: (x: number, y: number) => number | null;
  getCam: () => Cam; setCam: (c: Cam) => void; draw: () => void;
}

type Px = [number, number, number];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rgb255 = (hex: string): Px => hexToRgb(hex).map((v) => v * 255) as Px;
const frame = () => new Promise(requestAnimationFrame);

export async function run(p: Page): Promise<void> {
  const { gl, ui } = p;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));
  emit({ info: { gpu: glRenderer(gl), triangles: p.triangles, dpr: devicePixelRatio } });
  emit({ metric: 'first_frame_ms', value: p.firstFrame });

  const W = gl.canvas.width, H = gl.canvas.height, dpr = devicePixelRatio;
  const buf = new Uint8Array(W * H * 4);
  // snapshot: draw now, read the whole frame; at(x, y) in CSS px from the top
  const snap = () => {
    p.draw();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const copy = buf.slice();
    return (x: number, y: number): Px => {
      const i = ((H - 1 - Math.min(H - 1, Math.round(y * dpr))) * W + Math.min(W - 1, Math.round(x * dpr))) * 4;
      return [copy[i], copy[i + 1], copy[i + 2]];
    };
  };
  const cssW = W / dpr, cssH = H / dpr;
  const set = (el: HTMLInputElement, v: string | boolean) => {
    if (typeof v === 'boolean') el.checked = v; else el.value = v;
  };
  const defaults = Object.fromEntries(Object.entries(ui).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
  const reset = () => { for (const [k, v] of Object.entries(defaults)) set(ui[k], v); };
  const cam0 = p.getCam();
  const hy = horizonY(cam0.pitch, cssH);
  // The horizon checks need the eye above every summit in the data, or a
  // peak could stand above the horizon row. Highest Mapterhorn sample in the
  // far grid: 3,662 m (Fuji, z7 mean).
  const eyeZ = eyeOf(cam0)[2];
  emit({ info: { pitch: cam0.pitch, horizon_css_y: hy, eye_m: eyeZ } });

  // Terrain mask: with the sky disabled nothing but the terrain is drawn on
  // the white background and there is no fog. The horizon fill (no data
  // beyond the far grid) is not terrain and does not take fog.
  set(ui.enabled, false);
  const bare = snap();
  reset();
  const white = rgb255(NO_SKY);
  const isTerrain = (x: number, y: number) => dist(bare(x, y), white) > 20;
  const r1 = (v: number) => Math.round(v * 10) / 10;

  // 1. top rows are the sky colour. MapLibre's band (sky-horizon-blend * half
  //    the height above the horizon) reaches the top at the default 0.5 here
  //    (200 px band, horizon 145 px from the top), so the top is 92% sky
  //    there; with the band at 0.1 (40 px) the top rows must be the sky colour
  //    itself, and at the default still nearer to it than to the horizon colour.
  {
    const sky = rgb255(ui.skyColor.value), hor = rgb255(ui.horizonColor.value);
    const def = snap();
    set(ui.skyHorizonBlend, '0.1');
    const narrow = snap();
    reset();
    let worst = 0, nearer = 0, n = 0;
    for (let x = 4; x < cssW; x += cssW / 32) for (const y of [1, 3, 5]) {
      n++;
      worst = Math.max(worst, dist(narrow(x, y), sky));
      if (dist(def(x, y), sky) < dist(def(x, y), hor)) nearer++;
    }
    emit({ check: 'top-rows-sky-color', pass: worst <= 6 && nearer === n && hy > 45, detail: `band 0.1: worst distance to sky ${r1(worst)}; band 0.5: ${nearer}/${n} nearer sky than horizon; horizon y ${r1(hy)} px` });
  }
  // 2. the row just above the horizon is the horizon colour
  {
    const at = snap(), hor = rgb255(ui.horizonColor.value);
    let ok = 0, n = 0, worst = 0;
    for (let x = 4; x < cssW; x += cssW / 64) { const d = dist(at(x, hy - 2), hor); n++; if (d <= 12) ok++; worst = Math.max(worst, d); }
    emit({ check: 'horizon-row-horizon-color', pass: eyeZ > 3700 && ok / n >= 0.95, detail: `${ok}/${n} within 12, worst ${r1(worst)}, eye ${Math.round(eyeZ)} m` });
  }
  // 3. distant terrain approaches the fog colour. The fog mixes the ground
  //    towards fog-color, and over the last part of fog depth towards
  //    horizon-color (horizon-fog-blend): measured with only the fog red, the
  //    band just below the horizon (terrain beyond ~109 km, fog depth > 0.99)
  //    was 164.8 from red against 128 for the band below it, because it had
  //    turned to the horizon colour as designed. So both are red here and the
  //    claim is: the further the terrain (the higher on the screen), the
  //    nearer to the fog colour. Bands: A = horizon to 10% of the height below
  //    it, B = 10-25%, bottom = in front of the fog's near plane.
  {
    set(ui.fogColor, '#ff0000'); set(ui.horizonColor, '#ff0000');
    const at = snap(), red: Px = [255, 0, 0];
    const band = (y0: number, y1: number, terrainOnly: boolean): [number, number] => {
      let s = 0, n = 0;
      for (let x = 4; x < cssW; x += cssW / 64) for (let y = y0; y < y1; y += 0.01 * cssH) {
        if (terrainOnly && !isTerrain(x, y)) continue;
        s += dist(at(x, y), red); n++;
      }
      return [n ? s / n : Infinity, n];
    };
    const [dA, nA] = band(hy + 2, hy + 0.1 * cssH, true);
    const [dB, nB] = band(hy + 0.1 * cssH, hy + 0.25 * cssH, true);
    const [dN, nN] = band(cssH - 0.03 * cssH, cssH - 1, false);
    emit({ check: 'distant-terrain-fog-color', pass: nA >= 50 && nB >= 50 && dA < dB && dB < dN && dA < 0.5 * dN, detail: `mean distance to the red fog: band A ${r1(dA)} (${nA} px), band B ${r1(dB)} (${nB} px), bottom ${r1(dN)} (${nN} px)` });
    reset();
  }
  // 4. each control changes the pixels it should and only those.
  //    Regions, with sky-horizon-blend 0.1 (a 40 px band): top = sky above
  //    the band; band = the band; fogged = terrain pixels from the horizon to
  //    25% of the height below it; near = the bottom 3% (in front of the
  //    fog's near plane, no fog).
  {
    set(ui.skyHorizonBlend, '0.1');
    const bandPx = 0.1 * cssH / 2;
    const base = snap();
    const pts: { x: number; y: number; r: string }[] = [];
    for (let x = 4; x < cssW; x += cssW / 40) {
      for (let y = 2; y < hy - bandPx - 4; y += (hy - bandPx - 6) / 6) pts.push({ x, y, r: 'top' });
      for (let y = hy - bandPx + 4; y < hy - 3; y += (bandPx - 7) / 4) pts.push({ x, y, r: 'band' });
      for (let y = hy + 2; y < hy + 0.25 * cssH; y += 0.015 * cssH) if (isTerrain(x, y)) pts.push({ x, y, r: 'fogged' });
      for (let y = cssH - 0.03 * cssH; y < cssH - 1; y += 4) pts.push({ x, y, r: 'near' });
    }
    const cases: { id: string; el: HTMLInputElement; v: string; change: string[]; keep: string[] }[] = [
      { id: 'sky-color', el: ui.skyColor, v: '#ff00ff', change: ['top', 'band'], keep: ['fogged', 'near'] },
      { id: 'horizon-color', el: ui.horizonColor, v: '#ff8000', change: ['band', 'fogged'], keep: ['top', 'near'] },
      { id: 'fog-color', el: ui.fogColor, v: '#00ff00', change: ['fogged'], keep: ['top', 'band', 'near'] },
      // 0.6 widens the band past the top, so the top may change too
      { id: 'sky-horizon-blend', el: ui.skyHorizonBlend, v: '0.6', change: ['band'], keep: ['fogged', 'near'] },
      { id: 'horizon-fog-blend', el: ui.horizonFogBlend, v: '0.95', change: ['fogged'], keep: ['top', 'band', 'near'] },
      { id: 'fog-ground-blend', el: ui.fogGroundBlend, v: '0.6', change: ['fogged'], keep: ['top', 'band', 'near'] },
    ];
    const lines: string[] = [];
    let all = true;
    for (const c of cases) {
      const old = c.el.value;
      set(c.el, c.v);
      const at = snap();
      set(c.el, old);
      const changed: Record<string, number> = {}, total: Record<string, number> = {};
      for (const q of pts) {
        total[q.r] = (total[q.r] ?? 0) + 1;
        if (dist(at(q.x, q.y), base(q.x, q.y)) > 3) changed[q.r] = (changed[q.r] ?? 0) + 1;
      }
      const pass = c.change.every((r) => total[r] > 0 && (changed[r] ?? 0) / total[r] >= 0.3) && c.keep.every((r) => (changed[r] ?? 0) === 0);
      all &&= pass;
      lines.push(`${c.id} ${pass ? 'ok' : 'FAIL'} [${Object.keys(total).map((r) => `${r} ${changed[r] ?? 0}/${total[r]}`).join(', ')}]`);
    }
    emit({ check: 'controls-change-only-their-pixels', pass: all, detail: lines.join('; ') });
    reset();
  }
  // 5. with the sky disabled the sky area changes (to the page background)
  //    and the fog is gone
  {
    const on = snap();
    set(ui.enabled, false);
    const off = snap();
    reset();
    const bg = rgb255(NO_SKY);
    let skyChanged = 0, skyBg = 0, n = 0, fogGone = 0, m = 0;
    for (let x = 4; x < cssW; x += cssW / 32) {
      for (const y of [2, hy / 2, hy - 3]) { n++; if (dist(on(x, y), off(x, y)) > 30) skyChanged++; if (dist(off(x, y), bg) <= 6) skyBg++; }
      m++; if (dist(on(x, hy + 0.05 * cssH), off(x, hy + 0.05 * cssH)) > 10) fogGone++;
    }
    emit({ check: 'sky-disabled-changes-sky', pass: skyChanged / n >= 0.95 && skyBg / n >= 0.95 && fogGone / m >= 0.5, detail: `sky changed ${skyChanged}/${n}, background ${skyBg}/${n}, fog gone ${fogGone}/${m}` });
  }
  // 6. every control redraws within one frame of its input event
  {
    const ms: number[] = [];
    let ok = 0;
    const els = [ui.skyColor, ui.horizonColor, ui.fogColor, ui.skyHorizonBlend, ui.horizonFogBlend, ui.fogGroundBlend, ui.enabled];
    const vals = ['#ff00ff', '#ff8000', '#00ff00', '0.9', '0.05', '0.6', false] as const;
    for (let i = 0; i < els.length; i++) {
      await frame();
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const before = buf.slice();
      const t0 = performance.now();
      set(els[i], vals[i]);
      els[i].dispatchEvent(new Event('input'));
      await frame();          // the page's rAF callback was queued first and has drawn
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      ms.push(performance.now() - t0);
      let diff = 0;
      for (let k = 0; k < buf.length; k += 4 * 97) if (Math.abs(buf[k] - before[k]) + Math.abs(buf[k + 1] - before[k + 1]) + Math.abs(buf[k + 2] - before[k + 2]) > 6) diff++;
      if (diff > 20) ok++;
      reset();
    }
    p.draw();
    emit({ metric: 'control_redraw_ms', values: ms });
    emit({ check: 'controls-redraw-next-frame', pass: ok === els.length, detail: `${ok}/${els.length} inputs redrawn` });
  }
  // 7. the camera never goes under the terrain: extreme drags and zooms in
  //    every direction, measured against the CPU heights
  {
    let worst = Infinity;
    const c0 = p.getCam();
    for (let b = 0; b < 360; b += 15) {
      p.setCam({ ...c0, bearing: b, pitch: MAX_PITCH, distance: MIN_DIST });
      for (const d of [MIN_DIST, 2000, 5000, MAX_DIST]) {
        p.setCam({ ...p.getCam(), distance: d, pitch: MAX_PITCH });
        const e = eyeOf(p.getCam()), g = p.ground(e[0], e[1]) ?? 0;
        worst = Math.min(worst, e[2] - g);
      }
    }
    p.setCam(c0);
    emit({ check: 'camera-above-terrain', pass: worst >= CLEARANCE - 1, detail: `worst clearance ${Math.round(worst)} m` });
  }
  // 8. orbit: a full turn with pitch and distance moving, then the fixed
  //    opening view
  {
    const c0 = p.getCam();
    await benchFrames(gl, 180, (i) => {
      const u = i / 180;
      p.setCam({ ...c0, bearing: (c0.bearing + 360 * u) % 360, pitch: 74 + 5 * Math.sin(2 * Math.PI * u), distance: c0.distance * (1 + 0.4 * Math.sin(4 * Math.PI * u)) });
      p.draw();
    });
    p.setCam(c0);
    await benchFrames(gl, 60, () => p.draw(), { prefix: 'whole_' });
    p.draw();
  }
  await frame();
  emit({ done: true });
}
