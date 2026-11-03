// Bench branch, loaded only with ?bench after the first frame (not part of
// the page's code or of first_frame_ms). Every check reads back what was
// drawn to the canvas (gl.readPixels in the same task as the draw), at
// places taken from geography the renderer does not compute: OSM station
// nodes, Natural Earth sea and land points, the sharpest vertex of the
// baked centrelines.
import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.ts';
import { JAPAN, FUJI, project, onNearSide, FOV_Y, type Cam } from './camera.ts';
import { toEcef } from './land.ts';
import { LINES, hexToRgb } from './lines.ts';
import { TUBE_RADIUS_KM, MITRE_LIMIT } from './tubes.ts';
import { pulseHead } from './pulse.ts';
import type { App } from './main.ts';
import type { Shape, Corner } from './sweep.ts';

const frameEnd = () => new Promise<number>((r) => requestAnimationFrame(r));

export async function run(app: App): Promise<void> {
  const { renderer, state, meta } = app;
  const gl = renderer.gl, canvas = gl.canvas as HTMLCanvasElement;
  canvas.addEventListener('webglcontextlost', () => emit({ error: 'webgl context lost' }));
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, dpr = W / canvas.clientWidth;
  const check = (id: string, pass: boolean, detail: unknown) => emit({ check: id, pass, detail });
  emit({ metric: 'first_frame_ms', value: app.firstFrame() });
  emit({ info: { gpu: glRenderer(gl), canvas: [W, H], dpr, lines: meta.lines.map((l) => `${l.en} ${l.km} km ${l.points} pts ${l.speed_kmh} km/h`) } });

  const colours = LINES.map((l) => hexToRgb(l.colour));
  const setStyle = (shape: Shape, corner: Corner) => {
    if (state.shape !== shape || state.corner !== corner) { state.shape = shape; state.corner = corner; app.rebuild(); }
  };
  // draw and read the whole canvas; rows top-down in `at`
  const shot = (cam: Cam, t = 0, pulse = false) => {
    state.cam = { ...cam }; state.pulse = pulse;
    app.draw(t);
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const at = (img: Uint8Array, x: number, y: number) => { const i = ((H - 1 - y) * W + x) * 4; return [img[i], img[i + 1], img[i + 2]]; };
  const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  // a lit tube pixel of this line: bright, and the hue of the line's colour
  const tubeOf = (c: number[], line: number) => {
    const k = colours[line], m = Math.max(...c);
    if (m < 80) return false;
    const cos = (c[0] * k[0] + c[1] * k[1] + c[2] * k[2]) / (Math.hypot(...c) * Math.hypot(...k));
    return cos > 0.95;
  };
  const anyTube = (c: number[]) => colours.some((_, i) => tubeOf(c, i));
  const screen = (cam: Cam, lon: number, lat: number) => {
    const p = toEcef(lon, lat, 0);
    if (!onNearSide(cam, p)) return null;
    const s = project(cam, canvas.clientWidth, canvas.clientHeight, p);
    return s ? [Math.floor(s[0] * dpr), Math.floor(s[1] * dpr)] : null;
  };
  const inside = (s: number[] | null) => !!s && s[0] >= 0 && s[1] >= 0 && s[0] < W && s[1] < H;
  const search = (img: Uint8Array, s: number[], r: number, pred: (c: number[]) => boolean) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = s[0] + dx, y = s[1] + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && pred(at(img, x, y))) return true;
    }
    return false;
  };

  // ---- tubes at stations, base map, at the opening view ----
  setStyle('circle', 'round');
  {
    const img = shot(JAPAN);
    const r = Math.ceil(3 * dpr);
    const res = meta.stations.map((s) => {
      const p = screen(JAPAN, s.lon, s.lat);
      return { st: s.en, m: s.m_from_line, on: inside(p), hit: inside(p) && search(img, p!, r, (c) => tubeOf(c, s.line)) };
    });
    const visible = res.filter((x) => x.on);
    check('tube-at-stations', visible.length >= 12 && visible.every((x) => x.hit), { visible: visible.length, missed: visible.filter((x) => !x.hit).map((x) => x.st) });
    const sea = [[134, 40], [139.5, 33], [131, 37.5]].map(([lon, lat]) => at(img, ...(screen(JAPAN, lon, lat) as [number, number])));
    const landPts = [[142.8, 43.5], [127.8, 36.5], [137.3, 35.9], [131.2, 34.2]].map(([lon, lat]) => at(img, ...(screen(JAPAN, lon, lat) as [number, number])));
    const seaL = Math.max(...sea.map(lum)), landL = Math.min(...landPts.map(lum));
    check('base-map-visible', landL > seaL + 6 && sea.every((c) => c[2] > c[0] && !anyTube(c)) && landPts.every((c) => !anyTube(c)) && seaL > 2,
      { sea: sea.map((c) => c.join(',')), land: landPts.map((c) => c.join(',')), sea_max_lum: +seaL.toFixed(1), land_min_lum: +landL.toFixed(1) });
  }

  // ---- the cross-section shape changes the silhouette (close to Shin-Fuji) ----
  {
    const close: Cam = { lon: 138.62, lat: 35.13, range: 18, heading: 0, tilt: (60 * Math.PI) / 180 };
    const sf = meta.stations.find((s) => s.en === 'Shin-Fuji')!;
    const c = screen(close, sf.lon, sf.lat)!;
    const half = Math.round(220 * dpr);
    const masks: Record<string, Uint8Array> = {};
    for (const shape of ['circle', 'box', 'star'] as const) {
      setStyle(shape, 'round');
      const img = shot(close);
      const m = new Uint8Array((2 * half) ** 2);
      for (let y = 0; y < 2 * half; y++) for (let x = 0; x < 2 * half; x++) {
        const X = c[0] - half + x, Y = c[1] - half + y;
        if (X >= 0 && Y >= 0 && X < W && Y < H) m[y * 2 * half + x] = tubeOf(at(img, X, Y), sf.line) ? 1 : 0;
      }
      masks[shape] = m;
    }
    const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);
    const diff = (a: Uint8Array, b: Uint8Array) => { let x = 0, u = 0; for (let i = 0; i < a.length; i++) { x += a[i] ^ b[i]; u += a[i] | b[i]; } return u ? x / u : 0; };
    const pairs = { circle_box: diff(masks.circle, masks.box), circle_star: diff(masks.circle, masks.star), box_star: diff(masks.box, masks.star) };
    const counts = { circle: count(masks.circle), box: count(masks.box), star: count(masks.star) };
    check('shape-changes-silhouette', Object.values(pairs).every((d) => d > 0.08) && Object.values(counts).every((n) => n > 2000),
      { xor_over_union: Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, +v.toFixed(3)])), tube_px: counts });
  }

  // ---- the sharpest bend of the baked data: no gap, no spike ----
  {
    let best = { a: 0, line: 0, i: 0 };
    app.lines.forEach((l, li) => {
      for (let i = 1; i + 1 < l.length / 2; i++) {
        const c = Math.cos((l[2 * i + 1] * Math.PI) / 180);
        const ax = (l[2 * i] - l[2 * i - 2]) * c, ay = l[2 * i + 1] - l[2 * i - 1], bx = (l[2 * i + 2] - l[2 * i]) * c, by = l[2 * i + 3] - l[2 * i + 1];
        const a = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / Math.hypot(ax, ay) / Math.hypot(bx, by))));
        if (a > best.a) best = { a, line: li, i };
      }
    });
    const l = app.lines[best.line], P = (k: number) => [l[2 * k], l[2 * k + 1]];
    const cam: Cam = { lon: P(best.i)[0], lat: P(best.i)[1], range: 14, heading: 0, tilt: 0 };
    const pxPerKm = H / (2 * Math.tan(FOV_Y / 2) * cam.range);
    const rPx = TUBE_RADIUS_KM * pxPerKm;
    const detail: Record<string, unknown> = { bend_deg: +((best.a * 180) / Math.PI).toFixed(1), line: LINES[best.line].en, at: P(best.i).map((v) => +v.toFixed(4)), radius_px: +rPx.toFixed(1) };
    let pass = true;
    for (const corner of ['round', 'mitre'] as const) {
      setStyle('circle', corner);
      const img = shot(cam);
      // gap: every pixel along the centreline 1.5 km either side of the vertex is tube
      const pts = [P(best.i - 1), P(best.i), P(best.i + 1)].map(([lon, lat]) => screen(cam, lon, lat)!);
      let gaps = 0, samples = 0;
      for (const [a, b] of [[pts[0], pts[1]], [pts[1], pts[2]]]) {
        const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
        for (let k = 0; k <= n; k++) {
          const s = [Math.round(a[0] + ((b[0] - a[0]) * k) / n), Math.round(a[1] + ((b[1] - a[1]) * k) / n)];
          if (!inside(s) || Math.hypot(s[0] - pts[1][0], s[1] - pts[1][1]) > 1.5 * pxPerKm) continue;
          samples++;
          if (!search(img, s, 1, (c) => tubeOf(c, best.line))) gaps++;
        }
      }
      // spike: tube pixels farther from the projected line than radius x mitre limit
      const segs: number[][][] = [];
      for (let k = 0; k + 1 < l.length / 2; k++) {
        const a = screen(cam, ...(P(k) as [number, number])), b = screen(cam, ...(P(k + 1) as [number, number]));
        if (a && b && (inside(a) || inside(b) || Math.hypot(a[0] - W / 2, a[1] - H / 2) < 2 * W)) segs.push([a, b]);
      }
      const dist = (x: number, y: number) => Math.min(...segs.map(([a, b]) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
        return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      }));
      const limit = rPx * MITRE_LIMIT + 3;
      let spikes = 0, tube = 0, worst = 0;
      const box = Math.round(3 * pxPerKm);
      for (let y = Math.max(0, pts[1][1] - box); y < Math.min(H, pts[1][1] + box); y++) for (let x = Math.max(0, pts[1][0] - box); x < Math.min(W, pts[1][0] + box); x++) {
        if (!tubeOf(at(img, x, y), best.line)) continue;
        tube++;
        const d = dist(x, y);
        worst = Math.max(worst, d);
        if (d > limit) spikes++;
      }
      detail[corner] = { samples, gaps, tube_px: tube, spikes, worst_px: +worst.toFixed(1), limit_px: +limit.toFixed(1) };
      pass &&= samples > 20 && gaps === 0 && spikes === 0 && tube > 0;
    }
    check('sharp-bend-joined', pass, detail);
  }
  setStyle('circle', 'round');

  // ---- the pulse: brighter at its head ----
  {
    const tok = 0, speed = meta.lines[tok].speed_kmh;
    const m = app.mesh();
    const len = Math.max(...m.ringAlong.filter((_, r) => m.ringLine[r] === tok));
    const t = (200 + 40) / ((speed * 360) / 3600);    // head at 200 km
    const head = pulseHead(t, speed, len);
    let ring = 0;
    for (let r = 0; r < m.ringLine.length; r++) if (m.ringLine[r] === tok && Math.abs(m.ringAlong[r] - head) < Math.abs(m.ringAlong[ring] - head)) ring = r;
    const pc = m.frameCentre.slice(ring * 3, ring * 3 + 3);
    const lon = (Math.atan2(pc[1], pc[0]) * 180) / Math.PI, lat = (Math.asin(pc[2] / Math.hypot(pc[0], pc[1], pc[2])) * 180) / Math.PI;
    const cam: Cam = { lon, lat, range: 120, heading: 0, tilt: 0 };
    const s = screen(cam, lon, lat)!;
    const on = at(shot(cam, t, true), s[0], s[1]), off = at(shot(cam, t, false), s[0], s[1]);
    check('pulse-at-head', lum(on) > lum(off) + 30, { head_km: +head.toFixed(1), on: on.join(','), off: off.join(',') });
  }

  // ---- drag follows the pointer ----
  {
    state.cam = { ...JAPAN, range: 900, lon: 139.5, lat: 35.7 };
    app.draw(0);
    const tokyo = meta.stations.find((s) => s.en === 'Tokyo')!;
    const before = project(state.cam, canvas.clientWidth, canvas.clientHeight, toEcef(tokyo.lon, tokyo.lat, 0))!;
    const r = canvas.getBoundingClientRect(), x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const ev = (type: string, x: number, y: number) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true }));
    ev('pointerdown', x0, y0); ev('pointermove', x0 + 120, y0 + 60); ev('pointerup', x0 + 120, y0 + 60);
    const after = project(state.cam, canvas.clientWidth, canvas.clientHeight, toEcef(tokyo.lon, tokyo.lat, 0))!;
    const d = [after[0] - before[0], after[1] - before[1]];
    check('drag-follows-pointer', Math.abs(d[0] - 120) < 8 && Math.abs(d[1] - 60) < 8, { moved_css_px: d.map((v) => +v.toFixed(1)) });
  }

  // ---- the fly button reaches the close oblique view of the Tokaido line ----
  {
    state.cam = { ...JAPAN };
    (document.getElementById('fuji') as HTMLButtonElement).click();
    const t0 = performance.now();
    while (performance.now() - t0 < 4200) await frameEnd();
    const cam = { ...state.cam };
    const same = (Object.keys(FUJI) as (keyof Cam)[]).every((k) => Math.abs(cam[k] - FUJI[k]) < 1e-9);
    const img = shot(cam);
    const sf = meta.stations.find((s) => s.en === 'Shin-Fuji')!, s = screen(cam, sf.lon, sf.lat)!;
    // the tube's height on screen in the Shin-Fuji column
    let run = 0;
    for (let y = Math.max(0, s[1] - 150); y < Math.min(H, s[1] + 150); y++) if (tubeOf(at(img, s[0], y), sf.line)) run++;
    check('fly-to-fuji', same && inside(s) && run > 12 * dpr, { cam_reached: same, shin_fuji_px: s, tube_px_in_column: run });
  }

  // ---- timing ----
  setStyle('circle', 'round');
  state.pulse = true;
  // drag-rotate the globe: the target swings 6° east and back over all of Japan
  await benchFrames(gl, 120, (i) => {
    state.cam = { ...JAPAN, lon: JAPAN.lon + 6 * Math.sin((i / 120) * 2 * Math.PI), lat: JAPAN.lat + 2 * Math.sin((i / 60) * Math.PI) };
    app.draw(i / 60);
  });
  await benchFrames(gl, 60, (i) => { state.cam = { ...JAPAN }; app.draw(i / 60); }, { prefix: 'japan_' });
  await benchFrames(gl, 60, (i) => { state.cam = { ...FUJI }; app.draw(i / 60); }, { prefix: 'fuji_' });
  const tris: number[] = [], rebuild: number[] = [];
  for (const shape of ['circle', 'box', 'star'] as const) for (const corner of ['round', 'mitre'] as const) {
    const t0 = performance.now();
    setStyle(shape, corner);
    rebuild.push(performance.now() - t0);
    tris.push(renderer.triangles);
  }
  emit({ metric: 'triangles', value: Math.max(...tris) });
  emit({ metric: 'rebuild_ms', values: rebuild });
  emit({ info: { triangles_by_style: tris } });
  setStyle('circle', 'round');
  emit({ done: true });
}
