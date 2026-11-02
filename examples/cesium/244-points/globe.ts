
const PALETTE = [
  '#facc15', // 0: Yellow
  '#06b6d4', // 1: Cyan
  '#84cc16', // 2: Lime
  '#ec4899', // 3: Magenta
  '#f97316', // 4: Orange
];

export class CesiumPointsGlobe {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  sphere: Float32Array = new Float32Array(0);
  private turned: Float32Array = new Float32Array(0);
  // Per point, computed once: unit xyz (a frame only rotates them), the
  // colour index and the size
  private pointXyz = new Float32Array(0);
  private pointLook = new Uint8Array(0);

  yaw = 0;       // Center at lon 0 (London / Europe / Africa)
  pitch = 0.35;  // 20 degrees North
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
    const [landRes, ptsRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/cesium-244-points/land.bin`),
      fetch(`${baseDir}/data/baked/cesium-244-points/points.bin`),
    ]);

    this.sphere = toSphere(new Int16Array(await landRes.arrayBuffer()));
    this.turned = new Float32Array(this.sphere.length);

    const ab = await ptsRes.arrayBuffer();
    const count = new Uint32Array(ab, 4, 1)[0];
    const dv = new DataView(ab, 8);
    const xyz = this.pointXyz = new Float32Array(count * 3);
    const look = this.pointLook = new Uint8Array(count * 2);

    for (let i = 0; i < count; i++) {
      const at = i * 8;
      const L = dv.getInt16(at, true) / 100 * Math.PI / 180, P = dv.getInt16(at + 2, true) / 100 * Math.PI / 180;
      xyz.set([Math.cos(P) * Math.cos(L), Math.cos(P) * Math.sin(L), Math.sin(P)], i * 3);
      look[i * 2] = dv.getUint8(at + 4);
      look[i * 2 + 1] = dv.getUint8(at + 5);
    }

    this.draw();
  }

  private oceanGrad: CanvasGradient | null = null;

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42 * this.zoom;
    const grad = this.ctx.createRadialGradient(
      cx - R * 0.25,
      cy - R * 0.25,
      R * 0.1,
      cx,
      cy,
      R
    );
    grad.addColorStop(0, '#1a365d');
    grad.addColorStop(0.75, '#0f223f');
    grad.addColorStop(1, '#081324');
    this.oceanGrad = grad;
  }

  rotateBy(dyaw: number, dpitch: number): void {
    this.yaw += dyaw;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dpitch));
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
      this.setZoom(Math.max(0.6, Math.min(2.5, this.zoom + zoomDelta)));
    }, { passive: false });
  }

  project(lonDeg: number, latDeg: number): { sx: number; sy: number; visible: boolean; depth: number } {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42 * this.zoom;

    const lon = (lonDeg * Math.PI) / 180;
    const lat = (latDeg * Math.PI) / 180;

    const cosLat = Math.cos(lat);
    const gx = cosLat * Math.cos(lon);
    const gy = cosLat * Math.sin(lon);
    const gz = Math.sin(lat);

    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    const x1 = gx * cosY + gy * sinY;
    const y1 = -gx * sinY + gy * cosY;
    const z1 = gz;

    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const camX = y1;
    const camY = -x1 * sinP + z1 * cosP;
    const camZ = x1 * cosP + z1 * sinP;

    return {
      sx: cx + camX * R,
      sy: cy - camY * R,
      visible: camZ > 0.02,
      depth: camZ,
    };
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42 * this.zoom;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Deep space background
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, w, h);

    // Globe ocean sphere with atmosphere rim glow
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = this.oceanGrad || '#0f223f';
    ctx.fill();

    // Atmosphere halo
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Clip to globe disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.clip();

    // Land: one path for every front-facing triangle, filled once
    const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
    // Rotate every corner in one flat loop, then walk the triangles
    const s = this.sphere, t = this.turned;
    for (let j = 0; j < s.length; j += 3) {
      const x1 = s[j] * cosY + s[j + 1] * sinY;
      t[j] = -s[j] * sinY + s[j + 1] * cosY;
      t[j + 1] = -x1 * sinP + s[j + 2] * cosP;
      t[j + 2] = x1 * cosP + s[j + 2] * sinP;
    }
    ctx.fillStyle = '#1e3a5f';
    ctx.beginPath();
    for (let i = 0; i < t.length; i += 9) {
      const a = t[i + 2] > 0, b = t[i + 5] > 0, c = t[i + 8] > 0;
      if (!a && !b && !c) continue;
      // Across the horizon: put the far corners on the rim.
      if (!a || !b || !c) {
        for (let j = i; j < i + 9; j += 3) {
          if (t[j + 2] > 0) continue;
          const n = Math.hypot(t[j], t[j + 1]) || 1;
          t[j] /= n; t[j + 1] /= n;
        }
      }
      ctx.moveTo(cx + t[i] * R, cy - t[i + 1] * R);
      ctx.lineTo(cx + t[i + 3] * R, cy - t[i + 4] * R);
      ctx.lineTo(cx + t[i + 6] * R, cy - t[i + 7] * R);
    }
    ctx.fill();

    // Points: the rotation of project(), with the trigonometry of each point
    // done once. A point is a zero-length line with round caps, a disc as
    // wide as the line. One path per colour and radius (in 1/4 px), stroked
    // twice: every outline 1.2 px wider, then every fill on top, by colour
    const paths: Path2D[] = [];
    const q = this.pointXyz, look = this.pointLook;
    for (let i = 0; i < look.length / 2; i++) {
      const gx = q[i * 3], gy = q[i * 3 + 1], gz = q[i * 3 + 2];
      const x1 = gx * cosY + gy * sinY;
      const depth = x1 * cosP + gz * sinP;
      if (depth <= 0.02) continue;
      const key = look[i * 2] * 64 + Math.round(look[i * 2 + 1] * 2 * (0.8 + depth * 0.4));
      const sx = cx + (-gx * sinY + gy * cosY) * R, sy = cy - (-x1 * sinP + gz * cosP) * R;
      const path = paths[key] || (paths[key] = new Path2D());
      path.moveTo(sx, sy);
      path.lineTo(sx, sy);
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    paths.forEach((path, key) => { ctx.lineWidth = (key % 64) / 2 + 2.4; ctx.stroke(path); });
    paths.forEach((path, key) => { ctx.strokeStyle = PALETTE[key >> 6]; ctx.lineWidth = (key % 64) / 2; ctx.stroke(path); });

    ctx.restore(); // end globe clip
    ctx.restore(); // end dpr scale

    if (this.onRender) this.onRender();
  }
}

// Split earcut triangles (lon, lat x 100) to edges <= MAX_EDGE deg as unit xyz:
// big flat ones crossing the horizon folded over the ocean (as in 180, 213).
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
      const L = l * Math.PI / 180, P = p * Math.PI / 180;
      out.push(Math.cos(P) * Math.cos(L), Math.cos(P) * Math.sin(L), Math.sin(P));
    }
  };
  const at = (i: number): LL => [v[i] / 100, v[i + 1] / 100];
  for (let i = 0; i + 5 < v.length; i += 6) split(at(i), at(i + 2), at(i + 4));
  return new Float32Array(out);
}
