import { parseRelief, makeView, project, summitWorld, worldOf, groundAt, type Camera, type Relief, type View } from './terrain.ts';
import { createRenderer, type Renderer } from './gl.ts';

export class RainierScene {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  relief: Relief | null = null;
  camera: Camera = { az: 49, el: 28, radius: 6000 };
  target: number[] = [0, 0, 0];
  drawMs = 0;
  dpr = 1;

  private renderer: Renderer | null = null;
  private view: View | null = null;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
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
    const res = await fetch(`${baseDir}/data/baked/forge3d-001-mount-rainier/rainier.bin`);
    if (!res.ok) throw new Error(`rainier.bin: HTTP ${res.status}`);
    this.relief = parseRelief(await res.arrayBuffer());
    this.target = summitWorld(this.relief);
    this.renderer = createRenderer(this.gl, this.relief);
    this.draw();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  setCamera(next: Partial<Camera>): void {
    this.camera = { ...this.camera, ...next };
    this.camera.el = Math.max(6, Math.min(80, this.camera.el));
    this.camera.radius = Math.max(2500, Math.min(40000, this.camera.radius));
  }

  // Screen position (CSS px) of texel (u, v) of the current view.
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
      this.emitCamera();
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
      this.emitCamera();
    }, { passive: false });
  }

  onCamera: ((c: Camera) => void) | null = null;
  private emitCamera(): void { this.onCamera?.({ ...this.camera }); }

  draw(): void {
    const gl = this.gl;
    if (!this.relief || !this.renderer) return;
    const t0 = performance.now();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.view = makeView(this.camera, this.target, this.canvas.width, this.canvas.height, (x, y) =>
      groundAt(this.relief!, x, y),
    );
    this.renderer.draw(this.view);
    this.drawMs = performance.now() - t0;
  }
}

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const scene = new RainierScene(canvas);
const out = document.getElementById('camera') as HTMLOutputElement | null;
scene.onCamera = (c) => {
  if (out) out.textContent = `az ${c.az.toFixed(0)}° · el ${c.el.toFixed(0)}° · r ${(c.radius / 1000).toFixed(1)} km`;
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
