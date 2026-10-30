// Two baked hillshade panes of the same DEM: left without cast shadows, right
// with them, split by a draggable divider. The shadow mask is one byte per
// texel; the renderer only darkens the shadowed pixels of the right pane.

export interface ReliefMeta {
  width: number;
  height: number;
  bounds: [number, number, number, number]; // W, S, E, N
  minElev: number;
  maxElev: number;
  peakU: number;
  peakV: number;
}

const BACKGROUND = '#0b1220';
const SHADOW_TINT = 0.35;

function imageCanvas(rgb: Uint8Array | Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = rgb[i * 3];
    img.data[i * 4 + 1] = rgb[i * 3 + 1];
    img.data[i * 4 + 2] = rgb[i * 3 + 2];
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export class ShadowRelief {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  meta: ReliefMeta | null = null;
  center = { u: 0.5, v: 0.5 };
  zoom = 1;
  split = 0.5;
  dpr = 1;

  private mask = new Uint8Array(0);
  private baseCanvas: HTMLCanvasElement | null = null;
  private shadowCanvas: HTMLCanvasElement | null = null;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private draggingSplit = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
    this.setupInteractions();
  }

  async load(baseDir = '../../..'): Promise<void> {
    const res = await fetch(`${baseDir}/data/baked/forge3d-009-shadow-comparison/relief.bin`);
    const buf = await res.arrayBuffer();
    const dv = new DataView(buf);
    const w = dv.getUint16(6, true);
    const h = dv.getUint16(8, true);
    this.meta = {
      width: w,
      height: h,
      bounds: [dv.getFloat32(10, true), dv.getFloat32(14, true), dv.getFloat32(18, true), dv.getFloat32(22, true)],
      minElev: dv.getUint16(26, true),
      maxElev: dv.getUint16(28, true),
      peakU: dv.getFloat32(30, true),
      peakV: dv.getFloat32(34, true),
    };
    const rgb = new Uint8Array(buf, 38, w * h * 3);
    this.mask = new Uint8Array(buf, 38 + w * h * 3, w * h);

    this.baseCanvas = imageCanvas(rgb, w, h);
    const shaded = new Uint8ClampedArray(rgb);
    for (let i = 0; i < w * h; i++) {
      if (this.mask[i] !== 0) continue;
      shaded[i * 3] *= SHADOW_TINT;
      shaded[i * 3 + 1] *= SHADOW_TINT;
      shaded[i * 3 + 2] *= SHADOW_TINT;
    }
    this.shadowCanvas = imageCanvas(shaded, w, h);
    this.frame();
  }

  // Centre on the summit, as far as the tile still covers the screen: the
  // tile's centre leaves Rainier's summit (v 0.78) below a wide window.
  frame(): void {
    const m = this.meta;
    if (!m) return;
    this.zoom = 1;
    const s = this.scale();
    const hu = this.canvas.width / (2 * m.width * s), hv = this.canvas.height / (2 * m.height * s);
    this.center = { u: Math.max(hu, Math.min(1 - hu, m.peakU)), v: Math.max(hv, Math.min(1 - hv, m.peakV)) };
    this.draw();
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  // Device pixels per texel: the tile covers the viewport.
  private scale(): number {
    const m = this.meta;
    if (!m) return 1;
    return Math.max(this.canvas.width / m.width, this.canvas.height / m.height) * this.zoom;
  }

  panBy(dx: number, dy: number): void {
    const m = this.meta;
    if (!m) return;
    const s = this.scale();
    this.center.u -= (dx * this.dpr) / (m.width * s);
    this.center.v -= (dy * this.dpr) / (m.height * s);
    this.draw();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(1, Math.min(8, zoom));
    this.draw();
  }

  zoomAtPoint(x: number, y: number, zoom: number): void {
    const [u, v] = this.uvAtScreen(x, y);
    this.zoom = Math.max(1, Math.min(8, zoom));
    const s = this.scale();
    const m = this.meta;
    if (!m) return;
    // Keep the map point under the cursor where it was.
    this.center.u = u - ((x * this.dpr) - this.canvas.width / 2) / (m.width * s);
    this.center.v = v - ((y * this.dpr) - this.canvas.height / 2) / (m.height * s);
    this.draw();
  }

  setSplit(fraction: number): void {
    this.split = Math.max(0, Math.min(1, fraction));
    this.draw();
  }

  screenOf(u: number, v: number): [number, number] {
    const m = this.meta;
    if (!m) return [0, 0];
    const s = this.scale();
    const ox = this.canvas.width / 2 - this.center.u * m.width * s;
    const oy = this.canvas.height / 2 - this.center.v * m.height * s;
    return [(ox + u * m.width * s) / this.dpr, (oy + v * m.height * s) / this.dpr];
  }

  uvAtScreen(x: number, y: number): [number, number] {
    const m = this.meta;
    if (!m) return [0, 0];
    const s = this.scale();
    const ox = this.canvas.width / 2 - this.center.u * m.width * s;
    const oy = this.canvas.height / 2 - this.center.v * m.height * s;
    return [((x * this.dpr) - ox) / (m.width * s), ((y * this.dpr) - oy) / (m.height * s)];
  }

  // 1 at a lit texel, 0 in cast shadow.
  shadowAt(u: number, v: number): number {
    const m = this.meta;
    if (!m) return 1;
    // u, v address texel centres: 0 is the left edge, 1 the right edge.
    const x = Math.max(0, Math.min(m.width - 1, Math.floor(u * m.width)));
    const y = Math.max(0, Math.min(m.height - 1, Math.floor(v * m.height)));
    return this.mask[y * m.width + x] !== 0 ? 1 : 0;
  }

  // Spread-out texels in cast shadow, for checks that sample the screen. The
  // shadows are thin strips at this sun angle, so single texels qualify; they
  // are kept 4 texels inside the area on screen.
  shadowSamples(count: number): [number, number][] {
    const m = this.meta;
    if (!m) return [];
    const [u0, v0] = this.uvAtScreen(0, 0);
    const [u1, v1] = this.uvAtScreen(this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    const cand: [number, number][] = [];
    for (let y = Math.max(0, Math.ceil(v0 * m.height)) + 4; y < Math.min(1, v1) * m.height - 4; y += 2) {
      for (let x = Math.max(0, Math.ceil(u0 * m.width)) + 4; x < Math.min(1, u1) * m.width - 4; x += 2) {
        if (this.mask[y * m.width + x] === 0) cand.push([(x + 0.5) / m.width, (y + 0.5) / m.height]);
      }
    }
    const out: [number, number][] = [];
    if (!cand.length) return out;
    out.push(cand[0]);
    while (out.length < count && out.length < cand.length) {
      let best = 0;
      let bestD = -1;
      for (let i = 0; i < cand.length; i++) {
        let d = Infinity;
        for (const [u, v] of out) d = Math.min(d, (cand[i][0] - u) ** 2 + (cand[i][1] - v) ** 2);
        if (d > bestD) { bestD = d; best = i; }
      }
      out.push(cand[best]);
      cand.splice(best, 1);
    }
    return out;
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const splitX = (this.split * this.canvas.width) / this.dpr;
      if (Math.abs(x - splitX) < 8) this.draggingSplit = true;
      else {
        this.dragging = true;
        this.dragX = e.clientX;
        this.dragY = e.clientY;
      }
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.draggingSplit) {
        const rect = this.canvas.getBoundingClientRect();
        this.setSplit((e.clientX - rect.left) / (this.canvas.clientWidth || 1));
        return;
      }
      if (!this.dragging) return;
      this.panBy(e.clientX - this.dragX, e.clientY - this.dragY);
      this.dragX = e.clientX;
      this.dragY = e.clientY;
    });
    const stop = (e: PointerEvent): void => {
      this.dragging = false;
      this.draggingSplit = false;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, this.zoom + (e.deltaY < 0 ? 0.4 : -0.4));
    }, { passive: false });
  }

  draw(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, W, H);
    const m = this.meta;
    if (!m || !this.baseCanvas || !this.shadowCanvas) return;

    const s = this.scale();
    const ox = W / 2 - this.center.u * m.width * s;
    const oy = H / 2 - this.center.v * m.height * s;
    // One expression per edge, rounded once, so the two panes share the same
    // sample grid and the split compares identical screen pixels.
    const X0 = Math.round(ox);
    const Y0 = Math.round(oy);
    const X1 = Math.round(ox + m.width * s);
    const Y1 = Math.round(oy + m.height * s);
    const splitX = Math.round(this.split * W);

    ctx.imageSmoothingEnabled = true;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, splitX, H);
    ctx.clip();
    ctx.drawImage(this.baseCanvas, X0, Y0, X1 - X0, Y1 - Y0);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(splitX, 0, W - splitX, H);
    ctx.clip();
    ctx.drawImage(this.shadowCanvas, X0, Y0, X1 - X0, Y1 - Y0);
    ctx.restore();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = W / this.dpr;
    const h = H / this.dpr;
    const sx = splitX / this.dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();

    ctx.font = `${Math.round(12 * this.dpr)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3 * this.dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.fillStyle = '#ffffff';
    const left = 'hillshade';
    const right = '+ cast shadows';
    if (sx > 12) { ctx.strokeText(left, sx - 8 - ctx.measureText(left).width, 12 * this.dpr); ctx.fillText(left, sx - 8 - ctx.measureText(left).width, 12 * this.dpr); }
    if (sx < w - 12) { ctx.strokeText(right, sx + 10, 12 * this.dpr); ctx.fillText(right, sx + 10, 12 * this.dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
