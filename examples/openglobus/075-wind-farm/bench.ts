// Bench for 075: loaded by main.ts only under ?bench. Every check reads back
// pixels of the drawn frame (readPixels on the default framebuffer right
// after drawing), comparing renders that differ in one thing only.
import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import { project, type OrbitView } from './camera.ts';
import { heightAt, toLocal, type Terrain } from './terrain.ts';
import { RotorState, buildTurbineMesh } from './turbine.ts';
import type { WindFarmRenderer, TurbineInstance } from './render.ts';

interface Ctx { renderer: WindFarmRenderer; terrain: Terrain; rotors: RotorState; view: () => OrbitView; firstFrame: () => number }
type Box = { x: number; y: number; w: number; h: number };

const WIND = 290;

function changed(a: Uint8Array, b: Uint8Array, thr = 24): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > thr) n++;
  return n;
}

export async function run(c: Ctx): Promise<void> {
  const { renderer, rotors } = c, gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); emit({ error: 'webglcontextlost' }); });
  for (let i = 0; i < 60 && !c.firstFrame(); i++) await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: c.firstFrame() });
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const view = c.view();
  const angles = Float32Array.from(rotors.gpu);
  emit({ metric: 'draw_calls', value: renderer.render(view, WIND, angles) });
  emit({ metric: 'turbines_drawn', value: renderer.turbines.length });
  emit({ info: { gpu: glRenderer(gl), turbines: renderer.turbines.length, mesh_triangles: buildTurbineMesh().count / 3, viewport: [W, H] } });

  const read = (b: Box) => renderer.read(b.x, b.y, b.w, b.h);
  const clip = (b: Box): Box | null => {
    const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
    const x1 = Math.min(W, Math.ceil(b.x + b.w)), y1 = Math.min(H, Math.ceil(b.y + b.h));
    return x1 - x >= 1 && y1 - y >= 1 ? { x, y, w: x1 - x, h: y1 - y } : null;
  };
  // screen box of a whole turbine (base to blade tip, rotor width)
  const turbineBox = (t: TurbineInstance, m: Float32Array): Box | null => {
    const base = project(m, [t.x, t.y, t.z], W, H), top = project(m, [t.x, t.y, t.z + t.hub + t.diameter / 2], W, H);
    const hub = project(m, [t.x, t.y, t.z + t.hub], W, H);
    if (!base || !top || !hub) return null;
    const r = Math.abs(base[1] - top[1]) * (t.diameter / 2) / (t.hub + t.diameter / 2) + 2;
    return { x: hub[0] - r, y: top[1] - 2, w: 2 * r, h: base[1] - top[1] + 4 };
  };

  // 1. turbines-at-known-positions: three isolated turbines, near, middle, far
  {
    renderer.render(view, WIND, angles);
    const m = renderer.camera!.viewProj, eye = renderer.camera!.eye;
    const boxes = renderer.turbines.map((t) => ({ t, b: turbineBox(t, m) }));
    const onScreen = boxes.filter((e) => e.b && e.b.x > 0 && e.b.y > 0 && e.b.x + e.b.w < W && e.b.y + e.b.h < H);
    const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const isolated = onScreen.filter((e) => !boxes.some((o) => o !== e && o.b && overlaps(e.b!, o.b)));
    const dist = (t: TurbineInstance) => Math.hypot(t.x - eye[0], t.y - eye[1]);
    isolated.sort((a, b) => dist(a.t) - dist(b.t));
    // near, median and the 80th percentile (the farthest are a few pixels
    // tall at 24 km, under the fog)
    const n = isolated.length;
    const picks = n >= 3 ? [isolated[0], isolated[n >> 1], isolated[Math.floor(n * 0.8)]] : isolated;
    const res = picks.map(({ t, b }) => {
      const box = clip(b!)!;
      renderer.render(view, WIND, angles, { turbines: false });
      const without = read(box);
      renderer.render(view, WIND, angles);
      return { id: t.id, dist_m: Math.round(dist(t)), box, changed: changed(read(box), without) };
    });
    emit({ check: 'turbines-at-known-positions', pass: res.length === 3 && res.every((r) => r.changed >= 3), detail: { isolated: isolated.length, on_screen: onScreen.length, res } });
  }

  // A close view of the nearest turbine for the rotor checks.
  renderer.render(view, WIND, angles);
  const eye0 = renderer.camera!.eye;
  const near = [...renderer.turbines].sort((a, b) => Math.hypot(a.x - eye0[0], a.y - eye0[1]) - Math.hypot(b.x - eye0[0], b.y - eye0[1]))[0];
  // looking west-north-west, out to sea: no other turbine stands behind it
  // (turbines on the horizon share the hub's screen row otherwise)
  const close: OrbitView = { target: [near.x, near.y, near.z + near.hub * 0.6], heading: 290, pitch: 4, distance: 520 };
  const ni = renderer.turbines.indexOf(near);

  // 2. blades-spin-tower-still
  {
    renderer.render(close, WIND, angles);
    const m = renderer.camera!.viewProj;
    const hub = project(m, [near.x, near.y, near.z + near.hub], W, H)!;
    const tipPx = Math.abs(hub[1] - project(m, [near.x, near.y, near.z + near.hub + near.diameter / 2], W, H)![1]);
    const rotorBox = clip({ x: hub[0] - tipPx * 1.1, y: hub[1] - tipPx * 1.1, w: tipPx * 2.2, h: tipPx * 2.2 })!;
    // the tower below the lowest blade tip (80 % of the clearance)
    const base = project(m, [near.x, near.y, near.z], W, H)!;
    const low = project(m, [near.x, near.y, near.z + (near.hub - near.diameter / 2) * 0.8], W, H)!;
    const towerBox = clip({ x: base[0] - 6, y: low[1], w: 12, h: Math.max(2, base[1] - low[1]) })!;
    const a = read(rotorBox), ta = read(towerBox);
    const moved = Float32Array.from(angles);
    moved[ni] += 0.6;
    renderer.render(close, WIND, moved);
    const b = read(rotorBox), tb = read(towerBox);
    const blade = changed(a, b), tower = changed(ta, tb, 0);
    emit({ check: 'blades-spin-tower-still', pass: blade >= 20 && tower === 0, detail: { turbine: near.id, rotorBox, towerBox, blade_changed: blade, tower_changed: tower } });
  }

  // 3. wind-direction-changes-rotor: a horizontal blade, rotor facing the
  //    camera versus edge-on; width of turbine pixels along the hub row.
  {
    const flat = Float32Array.from(angles);
    flat[ni] = Math.PI / 2;     // blades at 180, 300 and 60 degrees: one horizontal
    const facing = (close.heading + 180) % 360, edge = (close.heading + 90) % 360;
    const width = (dir: number) => {
      renderer.render(close, dir, flat);
      const hub = project(renderer.camera!.viewProj, [near.x, near.y, near.z + near.hub], W, H)!;
      // only around this rotor: turbines on the horizon share the row
      const r = Math.abs(hub[1] - project(renderer.camera!.viewProj, [near.x, near.y, near.z + near.hub + near.diameter / 2], W, H)![1]);
      const row = clip({ x: hub[0] - 1.3 * r, y: hub[1] - 2, w: 2.6 * r, h: 5 })!;
      const withT = read(row);
      renderer.render(close, dir, flat, { turbines: false });
      const without = read(row);
      let lo = W, hi = -1;
      for (let y = 0; y < row.h; y++) for (let x = 0; x < row.w; x++) {
        const i = (y * row.w + x) * 4;
        if (Math.abs(withT[i] - without[i]) + Math.abs(withT[i + 1] - without[i + 1]) + Math.abs(withT[i + 2] - without[i + 2]) > 24) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      }
      return hi >= lo ? hi - lo + 1 : 0;
    };
    const wf = width(facing), we = width(edge);
    emit({ check: 'wind-direction-changes-rotor', pass: wf >= 2 * we && wf > 20, detail: { turbine: near.id, facing_dir: facing, edge_dir: edge, width_facing_px: wf, width_edge_px: we } });
  }

  // 4. terrain-visible: the bottom quarter against a render without terrain,
  //    the top row stays sky, and the slopes of Mt Iwaki (1,625 m,
  //    140.303E 40.653N, a place the renderer does not compute) are shaded:
  //    lit and shadowed sides give a spread of brightness.
  {
    renderer.render(view, WIND, angles);
    const [ix, iy] = toLocal(140.303, 40.653, c.terrain.lon0, c.terrain.lat0);
    const peak = project(renderer.camera!.viewProj, [ix, iy, heightAt(c.terrain, ix, iy)], W, H);
    const bottom = { x: 0, y: Math.floor(H * 0.75), w: W, h: H - Math.floor(H * 0.75) }, topRow = { x: 0, y: 0, w: W, h: 1 };
    const iwaki = peak ? clip({ x: peak[0] - 60, y: peak[1] + 2, w: 120, h: 20 }) : null;
    renderer.render(view, WIND, angles, { terrain: false });
    const skyB = read(bottom), skyT = read(topRow), skyI = iwaki ? read(iwaki) : null;
    renderer.render(view, WIND, angles);
    const b = read(bottom), t = read(topRow), m = iwaki ? read(iwaki) : null;
    const diff = changed(b, skyB, 12) / (b.length / 4);
    let s = 0, s2 = 0, k = 0;
    if (m && skyI) for (let i = 0; i < m.length; i += 4) {
      if (Math.abs(m[i] - skyI[i]) + Math.abs(m[i + 1] - skyI[i + 1]) + Math.abs(m[i + 2] - skyI[i + 2]) <= 12) continue;
      const l = 0.299 * m[i] + 0.587 * m[i + 1] + 0.114 * m[i + 2];
      s += l; s2 += l * l; k++;
    }
    const sd = k ? Math.sqrt(Math.max(0, s2 / k - (s / k) ** 2)) : 0;
    const topChanged = changed(t, skyT, 0);
    const pass = diff >= 0.9 && !!iwaki && k >= 0.5 * iwaki.w * iwaki.h && sd >= 4 && topChanged === 0;
    emit({ check: 'terrain-visible', pass, detail: { bottom_differs: +diff.toFixed(4), iwaki_box: iwaki, iwaki_terrain_px: k, iwaki_luminance_sd: +sd.toFixed(2), top_row_changed: topChanged } });
  }

  // Camera path with every rotor turning: one turn of heading in 120 frames,
  // distance and pitch swinging.
  const v0 = c.view();
  await benchFrames(gl, 120, (i) => {
    rotors.advance(1 / 60, 9);
    const a = (i / 120) * 2 * Math.PI;
    renderer.render({ ...v0, heading: v0.heading + i * 3, distance: v0.distance * (0.8 + 0.2 * Math.cos(a)), pitch: v0.pitch + 4 * (1 - Math.cos(a)) }, WIND, rotors.gpu);
  });
  emit({ done: true });
}
