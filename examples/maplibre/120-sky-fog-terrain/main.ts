// Sky, fog and terrain over the Northern Japan Alps (MapLibre example
// "Sky, Fog, Terrain"): two baked Mapterhorn height grids, a sky gradient
// anchored at the horizon and distance fog, all six setSky controls.
import { decodeHeights, sampleHeight, type Grid } from './heights.ts';
import { clampCamera, drag, zoom, type Cam } from './camera.ts';
import { DEFAULT_SKY, skyUniforms, type Sky } from './sky.ts';
import { createRenderer } from './render.ts';

const pageStart = (window as unknown as { __mfsPageStart?: number }).__mfsPageStart ?? 0;
const DATA = '../../../data/baked/maplibre-120-sky-fog-terrain/';

async function load(name: string): Promise<Grid> {
  const res = await fetch(DATA + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  let u8 = new Uint8Array(await res.arrayBuffer());
  // gzip unless a server already undid it in transport
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    u8 = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  return decodeHeights(u8);
}

const canvas = document.getElementById('map') as HTMLCanvasElement;
const renderer = createRenderer(canvas);   // shaders compile while the data loads
const [near, far] = await Promise.all([load('near.mfsh.gz'), load('far.mfsh.gz')]);

// Local metres: x east, y north, origin at the centre sample of the near grid.
// One scale (the near grid's, at 36.33N) for both grids; z(g) pixels are
// 2^(11 - z) near pixels.
const half = (near.w - 1) / 2;
const cx = near.x0 + half + 0.5, cy = near.y0 + half + 0.5;
const originOf = (g: Grid): [number, number] => {
  const k = 2 ** (near.z - g.z);
  return [((g.x0 + 0.5) * k - cx) * near.step, -((g.y0 + 0.5) * k - cy) * near.step];
};
const nearO = originOf(near), farO = originOf(far);
const e = half * near.step - far.step;
renderer.addLevel(near, nearO);
renderer.addLevel(far, farO, [-e, -e, e, e]);
const ground = (x: number, y: number) => sampleHeight(near, nearO[0], nearO[1], x, y) ?? sampleHeight(far, farO[0], farO[1], x, y);
const local = (lon: number, lat: number): [number, number] => {
  const n = 512 * 2 ** near.z, s = Math.sin((lat * Math.PI) / 180);
  return [(((lon + 180) / 360) * n - cx) * near.step, -((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n - cy) * near.step];
};

// Opening view: from above Kamikochi towards Yarigatake, Tateyama and the
// Sea of Japan behind them.
const [yx, yy] = local(137.6478, 36.342);
let cam: Cam = clampCamera({ tx: yx, ty: yy, tz: ground(yx, yy) ?? 0, bearing: 345, pitch: 78, distance: 11000 }, ground);

const ui = {
  enabled: document.getElementById('sky-enabled') as HTMLInputElement,
  skyColor: document.getElementById('sky-color-picker') as HTMLInputElement,
  horizonColor: document.getElementById('horizon-color-picker') as HTMLInputElement,
  fogColor: document.getElementById('fog-color-picker') as HTMLInputElement,
  skyHorizonBlend: document.getElementById('sky-horizon-blend-slider') as HTMLInputElement,
  horizonFogBlend: document.getElementById('horizon-fog-blend-slider') as HTMLInputElement,
  fogGroundBlend: document.getElementById('fog-ground-blend-slider') as HTMLInputElement,
};
const readSky = (): Sky => ({
  enabled: ui.enabled.checked, skyColor: ui.skyColor.value, horizonColor: ui.horizonColor.value, fogColor: ui.fogColor.value,
  skyHorizonBlend: +ui.skyHorizonBlend.value, horizonFogBlend: +ui.horizonFogBlend.value, fogGroundBlend: +ui.fogGroundBlend.value,
});
ui.enabled.checked = DEFAULT_SKY.enabled;
for (const k of ['skyColor', 'horizonColor', 'fogColor'] as const) ui[k].value = DEFAULT_SKY[k];
for (const k of ['skyHorizonBlend', 'horizonFogBlend', 'fogGroundBlend'] as const) ui[k].value = String(DEFAULT_SKY[k]);

function resize(): void {
  canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
  canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
}
function draw(): void {
  const sky = readSky();
  renderer.draw(cam, skyUniforms(sky, cam.pitch, canvas.height / devicePixelRatio, devicePixelRatio, cam.distance), sky.enabled);
}
let pending = 0;
const request = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; draw(); }); };

resize();
draw();
const firstFrame = performance.now() - pageStart;
new ResizeObserver(() => { resize(); draw(); }).observe(canvas);
for (const el of Object.values(ui)) el.addEventListener('input', request);

let last: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (ev) => { last = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); });
canvas.addEventListener('pointermove', (ev) => {
  if (!last) return;
  cam = clampCamera(drag(cam, ev.clientX - last.x, ev.clientY - last.y), ground);
  last = { x: ev.clientX, y: ev.clientY };
  request();
});
const up = () => { last = null; };
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); cam = clampCamera(zoom(cam, ev.deltaY), ground); request(); }, { passive: false });

if (new URLSearchParams(location.search).has('bench')) {
  const { run } = await import('./bench.ts');
  await run({
    gl: renderer.gl, ui, firstFrame, triangles: renderer.triangles(), ground,
    getCam: () => cam, setCam: (c: Cam) => { cam = clampCamera(c, ground); }, draw,
  });
}
