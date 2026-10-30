// Orthographic globe lit by a sun fixed in world space, drawn with Canvas 2D.
// The night side is a square per-pixel mask (dot(normal, sun)) upscaled over
// the disc, so the terminator is a smooth curve rather than per-triangle steps.

const SPACE = '#05070d';
const MASK_SIZE = 256;

export class SunGlobe {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  sphere: Float32Array = new Float32Array(0);

  yaw = 0;      // centre at lon 0
  pitch = 0.3;  // looking slightly down on the northern hemisphere
  zoom = 1.0;
  sunLon = 90;  // sub-solar longitude, degrees (equinox: lat 0)
  dpr = 1;
  onRender?: () => void;

  private maskCanvas!: HTMLCanvasElement;
  private maskCtx!: CanvasRenderingContext2D;
  private maskImage: ImageData | null = null;
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;

    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = MASK_SIZE;
    this.maskCanvas.height = MASK_SIZE;
    const mctx = this.maskCanvas.getContext('2d');
    if (!mctx) throw new Error('Canvas 2D context not available');
    this.maskCtx = mctx;
    this.maskImage = mctx.createImageData(MASK_SIZE, MASK_SIZE);

    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
    this.setupInteractions();
  }

  async load(baseDir = '../../..'): Promise<void> {
    const res = await fetch(`${baseDir}/data/baked/cesium-209-lighting/land.bin`);
    this.sphere = toSphere(new Int16Array(await res.arrayBuffer()));
    this.draw();
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  private radius(): number {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    return Math.min(w, h) * 0.42 * this.zoom;
  }

  rotateBy(dyaw: number, dpitch: number): void {
    this.yaw += dyaw;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dpitch));
    this.draw();
  }

  setSun(lonDeg: number): void {
    this.sunLon = ((lonDeg + 540) % 360) - 180;
    this.draw();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(0.6, Math.min(2.5, zoom));
    this.draw();
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.rotateBy(dx * 0.005, -dy * 0.005);
    });
    const stop = (e: PointerEvent): void => {
      this.isDragging = false;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom - e.deltaY * 0.002);
    }, { passive: false });
  }

  project(lonDeg: number, latDeg: number): { sx: number; sy: number; visible: boolean; depth: number } {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const R = this.radius();
    const lon = (lonDeg * Math.PI) / 180;
    const lat = (latDeg * Math.PI) / 180;

    const cosLat = Math.cos(lat);
    const gx = cosLat * Math.cos(lon);
    const gy = cosLat * Math.sin(lon);
    const gz = Math.sin(lat);

    const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    const x1 = gx * cosY + gy * sinY;
    const y1 = -gx * sinY + gy * cosY;
    const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
    const camX = y1;
    const camY = -x1 * sinP + gz * cosP;
    const camZ = x1 * cosP + gz * sinP;

    return { sx: w / 2 + camX * R, sy: h / 2 - camY * R, visible: camZ > 0.02, depth: camZ };
  }

  private oceanGradient(cx: number, cy: number, R: number): CanvasGradient {
    const grad = this.ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, R * 0.1, cx, cy, R);
    grad.addColorStop(0, '#3a78b4');
    grad.addColorStop(0.75, '#1c4d80');
    grad.addColorStop(1, '#0e2f55');
    return grad;
  }

  // alpha of the night overlay for every pixel of the disc, from
  // dot(surface normal, sun direction). Recomputed on every draw: 65k pixels,
  // no trig inside the loop.
  private paintNightMask(): void {
    const img = this.maskImage;
    if (!img) return;
    const data = img.data;
    const S = MASK_SIZE;
    const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
    const sun = (this.sunLon * Math.PI) / 180;
    const cosSun = Math.cos(sun), sinSun = Math.sin(sun);

    for (let y = 0; y < S; y++) {
      const ny = 1 - ((y + 0.5) / S) * 2;
      for (let x = 0; x < S; x++) {
        const nx = ((x + 0.5) / S) * 2 - 1;
        const i = (y * S + x) * 4;
        const r2 = nx * nx + ny * ny;
        if (r2 > 1) {
          data[i + 3] = 0;
          continue;
        }
        const camZ = Math.sqrt(1 - r2);
        const x1 = -sinP * ny + cosP * camZ;
        const gx = x1 * cosY - nx * sinY;
        const gy = x1 * sinY + nx * cosY;
        const dot = gx * cosSun + gy * sinSun;
        const t = (0.12 - dot) / 0.24;
        const a = Math.max(0, Math.min(1, t)) * 0.88;
        data[i] = 4;
        data[i + 1] = 8;
        data[i + 2] = 20;
        data[i + 3] = Math.round(a * 255);
      }
    }
    this.maskCtx.putImageData(img, 0, 0);
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cx = w / 2;
    const cy = h / 2;
    const R = this.radius();

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    ctx.fillStyle = SPACE;
    ctx.fillRect(0, 0, w, h);

    // Daylit ocean: the night mask darkens whatever it covers, so the disc is
    // painted at full daylight first.
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = this.oceanGradient(cx, cy, R);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.clip();

    const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
    const s = this.sphere;
    const px = [0, 0, 0], py = [0, 0, 0], pz = [0, 0, 0];
    ctx.fillStyle = '#4e8a63';
    ctx.beginPath();
    for (let i = 0; i < s.length; i += 9) {
      let front = 0;
      for (let k = 0; k < 3; k++) {
        const gx = s[i + k * 3], gy = s[i + k * 3 + 1], gz = s[i + k * 3 + 2];
        const x1 = gx * cosY + gy * sinY;
        px[k] = -gx * sinY + gy * cosY;
        py[k] = -x1 * sinP + gz * cosP;
        pz[k] = x1 * cosP + gz * sinP;
        if (pz[k] > 0) front++;
      }
      if (front === 0) continue;
      // Across the horizon: pin the far corners to the rim (see cesium-180).
      if (front < 3) {
        for (let k = 0; k < 3; k++) {
          if (pz[k] > 0) continue;
          const n = Math.hypot(px[k], py[k]) || 1;
          px[k] /= n;
          py[k] /= n;
        }
      }
      ctx.moveTo(cx + px[0] * R, cy - py[0] * R);
      ctx.lineTo(cx + px[1] * R, cy - py[1] * R);
      ctx.lineTo(cx + px[2] * R, cy - py[2] * R);
    }
    ctx.fill();

    this.paintNightMask();
    ctx.drawImage(this.maskCanvas, cx - R, cy - R, R * 2, R * 2);

    ctx.restore(); // end disc clip

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.restore(); // end dpr scale

    this.onRender?.();
  }
}

// Split earcut triangles (lon, lat x 100) to edges <= MAX_EDGE deg as unit xyz.
// Long edges project across the horizon as chords (see cesium-180/244).
const MAX_EDGE = 20;
type LL = [number, number];
function toSphere(v: Int16Array): Float32Array {
  const out: number[] = [];
  const d = (p: LL, q: LL): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const split = (a: LL, b: LL, c: LL): void => {
    if (d(b, c) > d(a, b) && d(b, c) >= d(c, a)) return split(b, c, a);
    if (d(c, a) > d(a, b)) return split(c, a, b);
    if (d(a, b) > MAX_EDGE) {
      const h: LL = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      split(a, h, c);
      return split(h, b, c);
    }
    for (const [l, p] of [a, b, c]) {
      const L = (l * Math.PI) / 180, P = (p * Math.PI) / 180;
      out.push(Math.cos(P) * Math.cos(L), Math.cos(P) * Math.sin(L), Math.sin(P));
    }
  };
  const at = (i: number): LL => [v[i] / 100, v[i + 1] / 100];
  for (let i = 0; i + 5 < v.length; i += 6) split(at(i), at(i + 2), at(i + 4));
  return new Float32Array(out);
}
