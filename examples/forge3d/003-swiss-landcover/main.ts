import { parseRelief, makeView, project, worldOf, groundAt, Z_SCALE, type Camera, type Relief, type View } from './terrain.ts';
import { createRenderer, type Renderer } from './gl.ts';

export interface LegendClass { code: number; name: string; ja: string; colour: string; index: number; cells: number; share: number }

export class SwissScene {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  relief: Relief | null = null;
  legend: LegendClass[] = [];
  // Near top-down from the south, the whole country in view.
  camera: Camera = { az: 180, el: 58, radius: 430000 };
  target: number[] = [0, 0, 0];
  drawMs = 0;
  dpr = 1;
  view: View | null = null;

  private renderer: Renderer | null = null;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: true, premultipliedAlpha: false,
      preserveDrawingBuffer: true, // the checks read the frame back
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
    this.setupInteractions();
  }

  async load(baseDir = '../../..'): Promise<void> {
    const dir = `${baseDir}/data/baked/forge3d-003-swiss-landcover`;
    const [bin, json] = await Promise.all([fetch(`${dir}/swiss.bin`), fetch(`${dir}/legend.json`)]);
    if (!bin.ok) throw new Error(`swiss.bin: HTTP ${bin.status}`);
    if (!json.ok) throw new Error(`legend.json: HTTP ${json.status}`);
    this.relief = parseRelief(await bin.arrayBuffer());
    this.legend = await json.json();
    // Palette slot k holds class index k (0 is never drawn).
    const palette = ['#000000'];
    for (const c of this.legend) palette[c.index] = c.colour;
    for (let i = 0; i < palette.length; i++) palette[i] ??= '#000000';
    this.target = [0, 0, ((this.relief.minElev + this.relief.maxElev) / 4) * Z_SCALE];
    this.renderer = createRenderer(this.gl, this.relief, palette);
    this.draw();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round((this.canvas.clientWidth || window.innerWidth) * this.dpr);
    this.canvas.height = Math.round((this.canvas.clientHeight || window.innerHeight) * this.dpr);
  }

  setCamera(next: Partial<Camera>): void {
    this.camera = { ...this.camera, ...next };
    this.camera.az = ((this.camera.az % 360) + 360) % 360;
    this.camera.el = Math.max(10, Math.min(89, this.camera.el));
    this.camera.radius = Math.max(40000, Math.min(900000, this.camera.radius));
  }

  // Screen position (CSS px) of grid fraction (u, v).
  screenOf(u: number, v: number): [number, number] | null {
    if (!this.relief || !this.view) return null;
    const p = project(this.view, worldOf(this.relief, u, v));
    return p ? [p[0] / this.dpr, p[1] / this.dpr] : null;
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.setCamera({
        az: this.camera.az - (e.clientX - this.dragX) * 0.3,
        el: this.camera.el + (e.clientY - this.dragY) * 0.2,
      });
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      this.draw();
    });
    const stop = (e: PointerEvent): void => {
      this.dragging = false;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setCamera({ radius: this.camera.radius * Math.exp(e.deltaY * 0.001) });
      this.draw();
    }, { passive: false });
  }

  draw(): void {
    if (!this.relief || !this.renderer) return;
    const t0 = performance.now();
    this.view = makeView(this.camera, this.target, this.canvas.width, this.canvas.height, (x, y) => groundAt(this.relief!, x, y));
    this.renderer.draw(this.view);
    this.drawMs = performance.now() - t0;
  }
}

const started = performance.now();
const scene = new SwissScene(document.getElementById('map') as HTMLCanvasElement);
let firstFrameMs = 0;
try {
  await scene.load();
  firstFrameMs = performance.now() - started;
  const list = document.getElementById('legend')!;
  for (const c of scene.legend) {
    const li = document.createElement('li');
    li.dataset.index = String(c.index);
    const pct = c.share < 0.001 ? '<0.1' : (c.share * 100).toFixed(1);
    li.innerHTML = `<i style="background:${c.colour}"></i>${c.ja} <span>${c.name} · ${pct}%</span>`;
    list.appendChild(li);
  }
} catch (err) {
  const pre = document.createElement('pre');
  pre.className = 'error';
  pre.textContent = String(err);
  document.body.appendChild(pre);
  throw err;
}

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(scene, firstFrameMs);
}
