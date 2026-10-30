interface Point3D {
  x: number;
  y: number;
  z: number;
  bin: number;
}

const RAMP = [
  '#2d5a3f', // 0: Deep valley green
  '#4d7c49', // 1: Subalpine green
  '#7d8c54', // 2: Talus olive
  '#9a8b75', // 3: Pumice gray
  '#b87352', // 4: Lava dome red-brown
  '#8f98a3', // 5: Crater wall rock
  '#b4c0cf', // 6: High rim slate
  '#f1f5f9', // 7: Summit snow/ash white
];

export class Forge3dPointCloud {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  count = 0;
  xs: Int16Array = new Int16Array(0);
  ys: Int16Array = new Int16Array(0);
  zs: Int16Array = new Int16Array(0);
  binIndices: number[][] = Array.from({ length: 8 }, () => []);

  yaw = 0.6;
  pitch = 0.55;
  zoom = 1.0;
  dpr = 1;

  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private onRender?: () => void;

  constructor(canvas: HTMLCanvasElement, onRender?: () => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.onRender = onRender;

    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
    this.setupInteractions();
  }

  async load(baseDir = '../../..'): Promise<void> {
    const res = await fetch(`${baseDir}/data/baked/forge3d-006-point-cloud/cloud.bin`);
    const ab = await res.arrayBuffer();
    const count = new Uint32Array(ab, 4, 1)[0];
    const dv = new DataView(ab, 8);

    this.count = count;
    this.xs = new Int16Array(count);
    this.ys = new Int16Array(count);
    this.zs = new Int16Array(count);
    this.binIndices = Array.from({ length: 8 }, () => []);

    for (let i = 0; i < count; i++) {
      const at = i * 6;
      const x = dv.getInt16(at, true);
      const y = dv.getInt16(at + 2, true);
      const z = dv.getInt16(at + 4, true);

      this.xs[i] = x;
      this.ys[i] = y;
      this.zs[i] = z;

      // Map z (-1000..1000) to bin 0..7
      let bin = 0;
      if (z >= 650) bin = 7;
      else if (z >= 450) bin = 6;
      else if (z >= 250) bin = 5;
      else if (z >= 100) bin = 4;
      else if (z >= -50) bin = 3;
      else if (z >= -200) bin = 2;
      else if (z >= -350) bin = 1;
      else bin = 0;

      this.binIndices[bin].push(i);
    }

    this.draw();
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  rotateBy(dyaw: number, dpitch: number): void {
    this.yaw += dyaw;
    this.pitch = Math.max(0.1, Math.min(1.5, this.pitch + dpitch));
    this.draw();
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.draw();
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.rotateBy(dx * 0.005, -dy * 0.005);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDelta = -e.deltaY * 0.002;
      this.setZoom(Math.max(0.5, Math.min(3.0, this.zoom + zoomDelta)));
    }, { passive: false });
  }

  project(x: number, y: number, z: number): { sx: number; sy: number; depth: number } {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cx = w / 2;
    const cy = h / 2 + 30;
    const scale = (Math.min(w, h) / 2200) * this.zoom;

    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    const x1 = x * cosY - y * sinY;
    const y1 = x * sinY + y * cosY;
    const z1 = z;

    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const y2 = y1 * cosP - z1 * sinP;
    const z2 = y1 * sinP + z1 * cosP;

    return {
      sx: cx + x1 * scale,
      sy: cy - z2 * scale,
      depth: y2,
    };
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Dark space background
    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, w, h);

    if (this.count === 0) {
      ctx.restore();
      return;
    }

    const cx = w / 2;
    const cy = h / 2 + 30;
    const scale = (Math.min(w, h) / 2200) * this.zoom;
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);

    const xs = this.xs;
    const ys = this.ys;
    const zs = this.zs;
    const ptSize = Math.max(1.5, Math.round(2.0 * this.zoom));

    // Zero-allocation batch draw by elevation bin
    for (let b = 0; b < 8; b++) {
      const indices = this.binIndices[b];
      if (indices.length === 0) continue;

      ctx.fillStyle = RAMP[b];
      ctx.beginPath();
      for (let j = 0; j < indices.length; j++) {
        const i = indices[j];
        const x1 = xs[i] * cosY - ys[i] * sinY;
        const y1 = xs[i] * sinY + ys[i] * cosY;
        const z2 = y1 * sinP + zs[i] * cosP;

        const sx = cx + x1 * scale;
        const sy = cy - z2 * scale;
        ctx.rect(sx - ptSize / 2, sy - ptSize / 2, ptSize, ptSize);
      }
      ctx.fill();
    }

    ctx.restore();
    if (this.onRender) this.onRender();
  }
}
