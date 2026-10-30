import { parseRelief, makeView, project, summitWorld, worldOf, groundAt, type Camera, type Relief, type View } from './terrain.ts';
import { createRenderer, type Renderer } from './gl.ts';
import { blockSize, drawLabels, planLabels, type Label, type Plan } from './labels.ts';

const FONT = '"Noto Sans CJK JP", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif';

export class FujiScene {
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  ctx: CanvasRenderingContext2D;
  relief: Relief | null = null;
  labels: Label[] = [];
  sizes: [number, number][] = [];
  plan: Plan = { placed: [], rejected: [] };
  camera: Camera = { az: 18, el: 36, radius: 26000 };
  target: number[] = [0, 0, 0];
  drawMs = 0;
  planMs = 0;
  dpr = 1;
  onCamera: ((c: Camera) => void) | null = null;

  private renderer: Renderer | null = null;
  view: View | null = null;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.canvas = canvas;
    this.overlay = overlay;
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: true, premultipliedAlpha: false,
      preserveDrawingBuffer: true, // the checks read the frame back
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.ctx = overlay.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
    this.setupInteractions();
  }

  async load(baseDir = '../../..'): Promise<void> {
    const dir = `${baseDir}/data/baked/forge3d-002-mount-fuji-labels`;
    const [bin, json] = await Promise.all([fetch(`${dir}/fuji.bin`), fetch(`${dir}/labels.json`)]);
    if (!bin.ok) throw new Error(`fuji.bin: HTTP ${bin.status}`);
    if (!json.ok) throw new Error(`labels.json: HTTP ${json.status}`);
    this.relief = parseRelief(await bin.arrayBuffer());
    this.labels = await json.json();
    // Text sizes do not change with the camera: measure once.
    const measure = (text: string, px: number): number => {
      this.ctx.font = `${px === 14 ? 700 : 500} ${px}px ${FONT}`;
      return this.ctx.measureText(text).width;
    };
    this.sizes = this.labels.map((l) => blockSize(l, measure));
    this.target = summitWorld(this.relief);
    this.renderer = createRenderer(this.gl, this.relief);
    this.draw();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
  }

  setCamera(next: Partial<Camera>): void {
    this.camera = { ...this.camera, ...next };
    this.camera.az = ((this.camera.az % 360) + 360) % 360;
    this.camera.el = Math.max(4, Math.min(85, this.camera.el));
    this.camera.radius = Math.max(3000, Math.min(60000, this.camera.radius));
  }

  // Screen position (CSS px) of texel (u, v) of the current view.
  screenOf(u: number, v: number, lift = 0): [number, number] | null {
    if (!this.relief || !this.view) return null;
    const w = worldOf(this.relief, u, v);
    w[2] += lift;
    const p = project(this.view, w);
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
    const t1 = performance.now();
    this.plan = planLabels(this.relief, this.view, this.dpr, this.labels, this.sizes);
    drawLabels(this.ctx, this.plan, this.dpr, FONT);
    const t2 = performance.now();
    this.drawMs = t2 - t0;
    this.planMs = t2 - t1;
    this.onCamera?.({ ...this.camera });
  }
}

const started = performance.now();
const scene = new FujiScene(document.getElementById('map') as HTMLCanvasElement, document.getElementById('labels') as HTMLCanvasElement);
const out = document.getElementById('camera') as HTMLOutputElement | null;
scene.onCamera = (c) => {
  if (out) {
    const hidden = scene.plan.rejected.length;
    out.textContent = `az ${c.az.toFixed(0)}° · el ${c.el.toFixed(0)}° · r ${(c.radius / 1000).toFixed(1)} km · ${scene.plan.placed.length} labels (${hidden} hidden)`;
  }
};

let firstFrameMs = 0;
try {
  await scene.load();
  firstFrameMs = performance.now() - started;
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
