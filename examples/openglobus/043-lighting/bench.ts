// Loaded only with ?bench. Every check reads back pixels that the page's own
// renderer drew into the default framebuffer, right after drawing them (the
// drawing buffer is not preserved across presented frames).
import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import { FOCAL, eyePosition, frontFacing, lonLatToUnit, project, viewProjection, type Camera } from './camera.ts';
import { SLIDERS, glintPoint } from './shading.ts';
import { subsolarPoint, sunDirection } from './sun.ts';
import type { App } from './main.ts';

const RAD = Math.PI / 180;
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export async function run(app: App): Promise<void> {
  const { gl, canvas } = app.renderer;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); emit({ error: 'webglcontextlost' }); });
  emit({ info: { gpu: glRenderer(gl), sphere_triangles: 128 * 256 * 2, canvas: [canvas.width, canvas.height] } });
  for (let i = 0; i < 60 && !app.firstFrameMs(); i++) await nextFrame();
  emit({ metric: 'first_frame_ms', value: app.firstFrameMs() });

  const W = canvas.width, H = canvas.height;
  let buf = new Uint8Array(W * H * 4);
  const draw = (camera: Camera, time: number, atmosphere = true) => {
    app.set({ camera, time, atmosphere });
    app.drawNow();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf.slice();
  };
  // Device pixel (top-left origin) of a buffer read with readPixels (bottom-left origin).
  const px = (b: Uint8Array, x: number, y: number) => {
    const i = ((H - 1 - Math.round(y)) * W + Math.round(x)) * 4;
    return [b[i], b[i + 1], b[i + 2], b[i + 3]];
  };
  const box = (b: Uint8Array, x: number, y: number, r: number, f: (p: number[]) => number) => {
    let best = -Infinity, sum = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const v = f(px(b, x + dx, y + dy)); best = Math.max(best, v); sum += v; n++;
    }
    return { max: best, mean: sum / n };
  };
  const screenOf = (cam: Camera, p: readonly number[]) => project(viewProjection(cam, W / H), p, W, H);
  const inputs = new Map<string, HTMLInputElement>();
  for (const el of document.querySelectorAll<HTMLInputElement>('#sliders input')) inputs.set(el.dataset.id!, el);
  const setSlider = (id: string, v: number) => {
    const el = inputs.get(id)!;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const withSliders = <T>(over: Record<string, number>, f: () => T): T => {
    const saved = Object.fromEntries(Object.keys(over).map((k) => [k, app.values[k]]));
    for (const [k, v] of Object.entries(over)) setSlider(k, v);
    try { return f(); } finally { for (const [k, v] of Object.entries(saved)) setSlider(k, v); }
  };
  const L = (p: number[]) => lum(p[0], p[1], p[2]);

  // globe-visible
  {
    const cam = { lon: 0, lat: 20, distance: 3 };
    const b = draw(cam, Date.UTC(2026, 5, 21, 12));
    const c = px(b, W / 2, H / 2), k = px(b, 3, 3);
    const d = Math.hypot(c[0] - k[0], c[1] - k[1], c[2] - k[2]);
    emit({ check: 'globe-visible', pass: c[3] === 255 && d > 20, detail: `centre ${c}, corner ${k}` });
  }

  // subsolar-brightest: illumination = rendered / albedo, argmax near the subsolar point.
  {
    const t = Date.UTC(2026, 5, 21, 12);
    const s = subsolarPoint(new Date(t));
    // Off-centre, so a light that followed the camera would be caught.
    const cam = { lon: s.lon - 30, lat: 10, distance: 3 };
    const img = new Image();
    img.src = '../../../data/baked/openglobus-043-lighting/earth.jpg';
    await img.decode();
    const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const albedo = ctx.getImageData(0, 0, img.width, img.height);
    const albedoAt = (lon: number, lat: number) => {
      const x = Math.floor((lon + 180) / 360 * albedo.width), y = Math.floor((90 - lat) / 180 * albedo.height);
      let sum = 0, min = 255;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const i = (Math.min(albedo.height - 1, Math.max(0, y + dy)) * albedo.width + ((x + dx + albedo.width) % albedo.width)) * 4;
        const v = lum(albedo.data[i], albedo.data[i + 1], albedo.data[i + 2]);
        sum += v; min = Math.min(min, v);
      }
      // Uniform patches only: a coast or an ice edge in the patch makes the ratio meaningless.
      return min >= 0.7 * sum / 25 ? sum / 25 : 0;
    };
    const b = withSliders({ specular_r: 0, specular_g: 0, specular_b: 0, ambient_r: 0, ambient_g: 0, ambient_b: 0, night: 0, exposure: 0.8 }, () => draw(cam, t, false));
    const centre = lonLatToUnit(s.lon, s.lat);
    // Fit illumination = c + n . v (Lambert with the wrap term) by least squares; v points at the brightest spot.
    const camC = lonLatToUnit(cam.lon, cam.lat), sunNow = sunDirection(new Date(t));
    const A = Array.from({ length: 4 }, () => new Float64Array(5));
    let samples = 0, best = { v: -1, lon: 0, lat: 0 };
    for (let lat = -60; lat <= 84; lat += 2) for (let lon = -180; lon < 180; lon += 2) {
      const p = lonLatToUnit(lon, lat);
      if (p[0] * camC[0] + p[1] * camC[1] + p[2] * camC[2] < Math.cos(55 * RAD)) continue;
      if (p[0] * sunNow[0] + p[1] * sunNow[1] + p[2] * sunNow[2] < 0.15) continue;
      const a = albedoAt(lon, lat);
      if (a < 40) continue;
      const q = screenOf(cam, p);
      if (!q) continue;
      // Rendered sRGB / albedo sRGB = (exposure * L)^(1/2.2): undo the gamma to get L.
      const ratio = box(b, q[0], q[1], 1, L).mean / a;
      const y = Math.pow(ratio, 2.2);
      const row = [p[0], p[1], p[2], 1];
      for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; A[i][4] += row[i] * y; }
      samples++;
      if (ratio > best.v) best = { v: ratio, lon, lat };
    }
    for (let i = 0; i < 4; i++) {
      let piv = i;
      for (let r = i + 1; r < 4; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      [A[i], A[piv]] = [A[piv], A[i]];
      for (let r = 0; r < 4; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < 5; c++) A[r][c] -= f * A[i][c]; }
    }
    const v = [A[0][4] / A[0][0], A[1][4] / A[1][1], A[2][4] / A[2][2]];
    const vl = Math.hypot(v[0], v[1], v[2]);
    const fitLat = Math.asin(v[1] / vl) / RAD, fitLon = Math.atan2(v[0], v[2]) / RAD;
    const dist = Math.acos(Math.min(1, lonLatToUnit(fitLon, fitLat).reduce((acc, x, i) => acc + x * centre[i], 0))) / RAD;
    emit({ check: 'subsolar-brightest', pass: samples > 100 && dist <= 5, detail: `subsolar ${s.lat.toFixed(2)},${s.lon.toFixed(2)}; fitted brightest ${fitLat.toFixed(2)},${fitLon.toFixed(2)} (${dist.toFixed(2)} deg, ${samples} samples); brightest single sample ${best.lat},${best.lon}` });
  }

  // night-city-glows and city-dark-by-day: Tokyo.
  {
    const tokyo = lonLatToUnit(139.69, 35.69);
    const cam = { lon: 139.69, lat: 35.69, distance: 3 };
    const q = screenOf(cam, tokyo)!;
    const night = Date.UTC(2026, 5, 21, 15), day = Date.UTC(2026, 5, 21, 3);
    const lit = draw(cam, night);
    const glowLum = box(lit, q[0], q[1], 2, L).max;
    const warm = box(lit, q[0], q[1], 2, (p) => p[0] - p[2]).max;
    const dark = withSliders({ night: 0 }, () => draw(cam, night));
    const darkLum = box(dark, q[0], q[1], 2, L).max;
    emit({ check: 'night-city-glows', pass: glowLum - darkLum >= 40 && warm > 0, detail: `Tokyo at night: luminance ${glowLum.toFixed(1)} with lights, ${darkLum.toFixed(1)} without; R-B ${warm}` });
    const dayMax = withSliders({ night: 5 }, () => draw(cam, day));
    const dayOff = withSliders({ night: 0 }, () => draw(cam, day));
    const diff = Math.abs(box(dayMax, q[0], q[1], 2, L).max - box(dayOff, q[0], q[1], 2, L).max);
    emit({ check: 'city-dark-by-day', pass: diff <= 2, detail: `Tokyo at noon: nightlight 5 vs 0 differ by ${diff.toFixed(2)}` });
  }

  // A view with the glint over the Pacific and the night side over East Asia.
  const mixTime = Date.UTC(2026, 11, 21, 20);
  const mixCam = { lon: -170, lat: 25, distance: 3 };
  const grid = (b: Uint8Array, step: number) => {
    const out: number[] = [];
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) out.push(...px(b, x, y).slice(0, 3));
    return out;
  };

  // specular-at-reflection-point
  {
    const sun = sunDirection(new Date(mixTime));
    const eye = eyePosition(mixCam);
    const g = glintPoint(sun, eye);
    const q = screenOf(mixCam, g);
    const on = draw(mixCam, mixTime);
    const off = withSliders({ specular_r: 0, specular_g: 0, specular_b: 0 }, () => draw(mixCam, mixTime));
    let best = { d: -1, x: 0, y: 0 };
    for (let y = 8; y < H; y += 16) for (let x = 8; x < W; x += 16) {
      const d = L(px(on, x, y)) - L(px(off, x, y));
      if (d > best.d) best = { d, x, y };
    }
    const dist = q ? Math.hypot(best.x - q[0], best.y - q[1]) : Infinity;
    emit({ check: 'specular-at-reflection-point', pass: !!q && frontFacing(g, eye) && dist <= 40 && best.d > 30, detail: `glint ${q ? q.slice(0, 2).map(Math.round) : 'hidden'}; strongest specular at ${best.x},${best.y} (+${best.d.toFixed(1)}), ${dist.toFixed(1)} px away` });
  }

  // sliders-change-pixels
  {
    const weak: string[] = [], scores: string[] = [];
    for (const s of SLIDERS) {
      const lo = grid(withSliders({ [s.id]: s.min }, () => draw(mixCam, mixTime)), 8);
      const hi = grid(withSliders({ [s.id]: s.max }, () => draw(mixCam, mixTime)), 8);
      let sum = 0;
      for (let i = 0; i < lo.length; i++) sum += Math.abs(hi[i] - lo[i]);
      const mean = sum / (lo.length / 3);
      scores.push(`${s.id} ${mean.toFixed(2)}`);
      if (!(mean > 1)) weak.push(s.id);
    }
    emit({ check: 'sliders-change-pixels', pass: weak.length === 0, detail: `mean RGB change per sample: ${scores.join(', ')}${weak.length ? `; too weak: ${weak.join(', ')}` : ''}` });
  }

  // time-moves-terminator, then the play button.
  {
    const cam = { lon: 0, lat: 0, distance: 3 };
    const noon = draw(cam, Date.UTC(2026, 5, 21, 12));
    const midnight = draw(cam, Date.UTC(2026, 5, 21, 0));
    const a = box(noon, W / 2, H / 2, 2, L).mean, b = box(midnight, W / 2, H / 2, 2, L).mean;
    const before = app.state().time;
    (document.getElementById('play') as HTMLButtonElement).click();
    for (let i = 0; i < 30; i++) await nextFrame();
    const advanced = (app.state().time - before) / 60000;
    (document.getElementById('play') as HTMLButtonElement).click();
    emit({ check: 'time-moves-terminator', pass: a - b >= 40 && advanced >= 10, detail: `lon 0 lat 0: noon ${a.toFixed(1)}, midnight ${b.toFixed(1)}; play advanced ${advanced.toFixed(1)} min in 30 frames` });
  }

  // atmosphere-rim: camera 90 deg east of the subsolar point, sun on the left.
  {
    const t = Date.UTC(2026, 5, 21, 12);
    const s = subsolarPoint(new Date(t));
    const cam = { lon: s.lon + 90, lat: 0, distance: 3 };
    const r = FOCAL * Math.tan(Math.asin(1 / cam.distance)) * H / 2;
    const xl = W / 2 - r - 3, xr = W / 2 + r + 3;
    const on = draw(cam, t), off = draw(cam, t, false);
    const left = px(on, xl, H / 2), right = px(on, xr, H / 2), leftOff = px(off, xl, H / 2);
    const pass = left[2] > left[0] + 20 && left[2] - leftOff[2] >= 30 && L(right) < L(left) / 2;
    emit({ check: 'atmosphere-rim', pass, detail: `day rim ${left}, without atmosphere ${leftOff}, night rim ${right}` });
  }

  // drag-follows-pointer: synthetic pointer events on the canvas.
  {
    const cam = { lon: 20, lat: 10, distance: 3 };
    const before = draw(cam, Date.UTC(2026, 5, 21, 12));
    const p0 = screenOf(cam, lonLatToUnit(20, 10))!;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const ev = (type: string, x: number, y: number) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', cx, cy); ev('pointermove', cx + 30, cy + 20); ev('pointermove', cx + 60, cy + 40); ev('pointerup', cx + 60, cy + 40);
    const moved = app.state().camera;
    const p1 = screenOf(moved, lonLatToUnit(20, 10))!;
    app.drawNow();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const c0 = px(before, W / 2, H / 2), c1 = px(buf, W / 2, H / 2);
    const pass = p1[0] - p0[0] >= 30 && p1[1] - p0[1] >= 20 && Math.hypot(c0[0] - c1[0], c0[1] - c1[1], c0[2] - c1[2]) > 3;
    emit({ check: 'drag-follows-pointer', pass, detail: `centre point moved ${(p1[0] - p0[0]).toFixed(1)}, ${(p1[1] - p0[1]).toFixed(1)} px; centre ${c0} -> ${c1}` });
  }

  // wheel-zooms
  {
    const cam = { lon: 20, lat: 10, distance: 3 };
    const r = FOCAL * Math.tan(Math.asin(1 / cam.distance)) * H / 2;
    const x = W / 2 + 1.1 * r;
    const far = px(draw(cam, Date.UTC(2026, 5, 21, 12)), x, H / 2)[3];
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }));
    app.drawNow();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const near = px(buf, x, H / 2)[3];
    emit({ check: 'wheel-zooms', pass: far < 32 && near === 255, detail: `alpha at 1.1 r: ${far} before, ${near} after (distance ${app.state().camera.distance.toFixed(2)})` });
  }

  // slider-redraw: frames and time from an input event to the redrawn frame.
  {
    const counts: number[] = [], times: number[] = [];
    const one = new Uint8Array(4);
    for (const s of SLIDERS) {
      const f0 = app.frames();
      const t0 = performance.now();
      setSlider(s.id, s.value === s.max ? s.min : s.max);
      let n = 0;
      while (app.frames() === f0 && n < 10) { await nextFrame(); n++; }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      times.push(performance.now() - t0);
      counts.push(n);
      setSlider(s.id, s.value);
      await nextFrame();
    }
    emit({ metric: 'slider_redraw_frames', values: counts });
    emit({ metric: 'slider_redraw_ms', values: times });
  }
  buf = new Uint8Array(0);

  // time-plays: a day in 120 frames while the camera turns.
  const t0 = Date.UTC(2026, 5, 21, 0);
  await benchFrames(gl, 120, (i) => { app.set({ camera: { lon: -180 + i * 3, lat: 20, distance: 3 }, time: t0 + i * 12 * 60000, atmosphere: true }); app.drawNow(); });

  // play-button: the page's own playback loop.
  {
    app.set({ camera: { lon: 0, lat: 20, distance: 3 } });
    const play = document.getElementById('play') as HTMLButtonElement;
    play.click();
    const stamps: number[] = [];
    for (let i = 0; i <= 90; i++) stamps.push(await nextFrame());
    play.click();
    emit({ metric: 'play_frame_interval_ms', values: stamps.slice(1).map((t, i) => t - stamps[i]) });
  }
  emit({ done: true });
}
