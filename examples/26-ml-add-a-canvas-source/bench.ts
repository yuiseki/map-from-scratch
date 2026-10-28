// Bench branch for 26, loaded only with ?bench so it is not part of the page
// a visitor downloads.
import { emit } from '../../harness/page/bench.ts';
import type { CanvasMap } from './canvasmap.ts';

const raf = () => new Promise<number>(requestAnimationFrame);

export async function run(el: HTMLElement, map: CanvasMap, overlay: HTMLCanvasElement, corners: number[][], animFrames: () => number): Promise<void> {
  map.base.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));
  // First frame = the second rAF after mounting: the frame holding the map
  // and the overlay has been produced.
  await raf();
  await raf();
  emit({ metric: 'first_frame_ms', value: performance.now() });

  // Frame intervals of n frames, calling work before each.
  const gaps = async (n: number, work: (i: number) => void): Promise<number[]> => {
    const out: number[] = [];
    let last = await raf();
    for (let i = 0; i < n; i++) {
      work(i);
      const t = await raf();
      out.push(t - last);
      last = t;
    }
    return out;
  };

  // Animation with the camera still: the page redraws its canvas every
  // frame; the map must not redraw at all.
  const r0 = map.redraws, a0 = animFrames();
  emit({ metric: 'anim_frame_interval_ms', values: await gaps(240, () => {}) });
  emit({ metric: 'map_redraws_while_animating', value: map.redraws - r0 });
  emit({ info: { animation_frames: animFrames() - a0 } });

  // Pan: the camera moves every frame, so the basemap is redrawn and the
  // overlay's transform rewritten every frame. redraw_ms is the time to
  // record one redraw (Canvas 2D rasterises at composite time).
  const redraw: number[] = [];
  const k = () => 512 * 2 ** map.cam.z;
  emit({ metric: 'pan_frame_interval_ms', values: await gaps(240, (i) => {
    map.cam.x += (i < 120 ? 6 : -6) / k();
    const t0 = performance.now();
    map.draw();
    redraw.push(performance.now() - t0);
  }) });
  // Zoom out to the minimum and in to 8 and back: the most countries in view
  // at z4, the most detail at z8.
  emit({ metric: 'zoom_frame_interval_ms', values: await gaps(240, (i) => {
    const t = i / 240;
    map.cam.z = t < 0.25 ? 5 - 4 * t : t < 0.75 ? 4 + 8 * (t - 0.25) : 8 - 12 * (t - 0.75);
    const t0 = performance.now();
    map.draw();
    redraw.push(performance.now() - t0);
  }) });
  emit({ metric: 'redraw_ms', values: redraw });
  // The harness turns vsync off, so the page above draws as fast as the main
  // thread can and the GPU process holds it back every few dozen frames.
  // The same pan paced at 60 Hz (one camera step per 16.7 ms, as a display
  // would ask for it) shows whether a user would see a stall.
  map.view(95.899147, 18.088694, 5);
  const paced: number[] = [];
  let last = await raf();
  for (let i = 0; i < 240; i++) {
    const wait = last + 1000 / 60 - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    map.cam.x += (i < 120 ? 6 : -6) / k();
    map.draw();
    const t = await raf();
    paced.push(t - last);
    last = t;
  }
  emit({ metric: 'pan_60hz_frame_interval_ms', values: paced });
  emit({ info: { timer_resolution_isolated: crossOriginIsolated, dpr: devicePixelRatio } });

  // The overlay sits on its four corners: the rendered box of the canvas
  // (after its CSS transform) against the projected corners, in several
  // views including a world copy away from the first.
  const box = el.getBoundingClientRect();
  const views: [number, number, number][] = [[95.899147, 18.088694, 5], [96, 18, 4], [97, 17, 7.3], [96 + 360, 18, 6]];
  let worst = 0;
  const detail: string[] = [];
  for (const [lon, lat, z] of views) {
    map.view(lon, lat, z);
    await raf();
    const r = overlay.getBoundingClientRect();
    const tl = map.project(corners[0][0], corners[0][1]), br = map.project(corners[2][0], corners[2][1]);
    const err = Math.max(Math.abs(r.left - box.left - tl[0]), Math.abs(r.top - box.top - tl[1]), Math.abs(r.right - box.left - br[0]), Math.abs(r.bottom - box.top - br[1]));
    worst = Math.max(worst, err);
    detail.push(`z${z} ${err.toFixed(3)}px`);
  }
  emit({ check: 'overlay-on-corners', pass: worst < 0.5, detail: detail.join(', ') });

  // Basemap colours read back from the screen's basemap canvas, at the
  // original view: sea, Myanmar (demotiles' fallback colour), Thailand.
  map.view(95.899147, 18.088694, 5);
  const ctx = map.base.getContext('2d')!;
  const px = (lon: number, lat: number): number[] => {
    const [x, y] = map.project(lon, lat);
    return [...ctx.getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data.slice(0, 3)];
  };
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
  const probes: [string, number, number, string][] = [
    ['sea (Andaman Sea)', 96.5, 12.0, '#D8F2FF'],
    ['Myanmar (Kachin)', 97.5, 25.5, '#EAB38F'],
    ['Thailand (Isan)', 103.0, 16.0, '#98DDA1'],
  ];
  const got = probes.map(([name, lon, lat, want]) => ({ name, want, got: px(lon, lat), ok: near(px(lon, lat), hex(want)) }));
  emit({ check: 'basemap-colours', pass: got.every((g) => g.ok), detail: got.map((g) => `${g.name} ${g.got.join(',')} want ${g.want}`).join('; ') });

  // The circles keep moving: the overlay's own pixels change between frames.
  const o = overlay.getContext('2d')!;
  const a = o.getImageData(0, 0, 400, 400).data;
  await raf();
  await raf();
  const b = o.getImageData(0, 0, 400, 400).data;
  let changed = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) changed++;
  emit({ check: 'overlay-animates', pass: changed > 0, detail: `${changed} pixels changed in 2 frames` });
  emit({ done: true });
}
