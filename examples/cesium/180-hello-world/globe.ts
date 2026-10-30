export class CesiumGlobe {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  verts: Int16Array = new Int16Array(0);

  yaw = 0.5;
  pitch = 0.3;
  zoomScale = 1.0;
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
    const res = await fetch(`${baseDir}/data/baked/cesium-180-hello-world/land.bin`);
    const ab = await res.arrayBuffer();
    this.verts = new Int16Array(ab);
    this.draw();
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  rotateBy(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dPitch));
    this.draw();
  }

  zoomBy(factor: number): void {
    this.zoomScale = Math.max(0.5, Math.min(3.0, this.zoomScale * factor));
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
      this.rotateBy(-dx * 0.005, dy * 0.005);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.95 : 1.05;
      this.zoomBy(factor);
    }, { passive: false });
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cx = w / 2;
    const cy = h / 2;
    const baseRadius = Math.min(w, h) * 0.38;
    const radius = baseRadius * this.zoomScale;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 1. Deep space background
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, w, h);

    // Atmosphere outer halo
    const atmoGrad = ctx.createRadialGradient(cx, cy, radius * 0.95, cx, cy, radius * 1.06);
    atmoGrad.addColorStop(0, 'rgba(64, 148, 240, 0.5)');
    atmoGrad.addColorStop(1, 'rgba(64, 148, 240, 0.0)');
    ctx.fillStyle = atmoGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.06, 0, Math.PI * 2);
    ctx.fill();

    // 2. Clip to Earth sphere
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    // Ocean body with solar illumination
    const oceanGrad = ctx.createRadialGradient(
      cx - radius * 0.3,
      cy - radius * 0.3,
      radius * 0.1,
      cx,
      cy,
      radius,
    );
    oceanGrad.addColorStop(0, '#2b78b8');
    oceanGrad.addColorStop(0.7, '#144e80');
    oceanGrad.addColorStop(1, '#092542');
    ctx.fillStyle = oceanGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Project and draw front-facing land triangles
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);

    ctx.fillStyle = '#3e7d43';
    ctx.strokeStyle = '#3e7d43';
    ctx.lineWidth = 0.5;

    const verts = this.verts;
    const totalVerts = verts.length / 2;

    for (let i = 0; i < totalVerts; i += 3) {
      // Vertex 0
      const lon0 = (verts[i * 2] / 100) * (Math.PI / 180) - this.yaw;
      const lat0 = (verts[i * 2 + 1] / 100) * (Math.PI / 180);
      const cosLat0 = Math.cos(lat0);
      const x0 = cosLat0 * Math.sin(lon0);
      const y0_orig = Math.sin(lat0);
      const z0_orig = cosLat0 * Math.cos(lon0);
      const y0 = y0_orig * cosP - z0_orig * sinP;
      const z0 = y0_orig * sinP + z0_orig * cosP;

      // Vertex 1
      const lon1 = (verts[(i + 1) * 2] / 100) * (Math.PI / 180) - this.yaw;
      const lat1 = (verts[(i + 1) * 2 + 1] / 100) * (Math.PI / 180);
      const cosLat1 = Math.cos(lat1);
      const x1 = cosLat1 * Math.sin(lon1);
      const y1_orig = Math.sin(lat1);
      const z1_orig = cosLat1 * Math.cos(lon1);
      const y1 = y1_orig * cosP - z1_orig * sinP;
      const z1 = y1_orig * sinP + z1_orig * cosP;

      // Vertex 2
      const lon2 = (verts[(i + 2) * 2] / 100) * (Math.PI / 180) - this.yaw;
      const lat2 = (verts[(i + 2) * 2 + 1] / 100) * (Math.PI / 180);
      const cosLat2 = Math.cos(lat2);
      const x2 = cosLat2 * Math.sin(lon2);
      const y2_orig = Math.sin(lat2);
      const z2_orig = cosLat2 * Math.cos(lon2);
      const y2 = y2_orig * cosP - z2_orig * sinP;
      const z2 = y2_orig * sinP + z2_orig * cosP;

      // Backface culling: skip if all 3 points behind horizon
      if (z0 + z1 + z2 <= 0) continue;

      ctx.beginPath();
      ctx.moveTo(cx + x0 * radius, cy - y0 * radius);
      ctx.lineTo(cx + x1 * radius, cy - y1 * radius);
      ctx.lineTo(cx + x2 * radius, cy - y2 * radius);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 4. Subtle spherical shading overlay
    const shadeGrad = ctx.createRadialGradient(
      cx - radius * 0.25,
      cy - radius * 0.25,
      radius * 0.1,
      cx,
      cy,
      radius,
    );
    shadeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
    shadeGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.0)');
    shadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = shadeGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // restore clip
    ctx.restore();

    if (this.onRender) this.onRender();
  }
}
