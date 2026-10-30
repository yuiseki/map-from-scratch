interface DemData {
  width: number;
  height: number;
  bounds: [number, number, number, number];
  minElev: number;
  maxElev: number;
  peak: [number, number];
  elevations: number[];
}

export class MapPlate {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dem: DemData | null = null;
  dpr = 1;

  panOffset = { x: 0, y: 0 };
  zoom = 1.0;

  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private onRender?: () => void;
  private reliefCanvas: HTMLCanvasElement | null = null;

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
    const res = await fetch(`${baseDir}/data/baked/forge3d-010-map-plate/relief.json`);
    this.dem = (await res.json()) as DemData;
    this.bakeReliefTexture();
    this.draw();
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  private bakeReliefTexture(): void {
    if (!this.dem) return;
    const { width, height, elevations } = this.dem;
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const octx = offscreen.getContext('2d');
    if (!octx) return;

    const imgData = octx.createImageData(width, height);
    const d = imgData.data;

    // Sun vector: azimuth 315 deg (NW), elevation 35 deg
    const sunAz = (315 * Math.PI) / 180;
    const sunEl = (35 * Math.PI) / 180;
    const lx = Math.sin(sunAz) * Math.cos(sunEl);
    const ly = -Math.cos(sunAz) * Math.cos(sunEl);
    const lz = Math.sin(sunEl);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const elev = elevations[idx];

        // Normal gradient
        const left = elevations[y * width + Math.max(0, x - 1)];
        const right = elevations[y * width + Math.min(width - 1, x + 1)];
        const up = elevations[Math.max(0, y - 1) * width + x];
        const down = elevations[Math.min(height - 1, y + 1) * width + x];

        const dzdx = (right - left) * 0.008;
        const dzdy = (down - up) * 0.008;
        const mag = Math.hypot(-dzdx, -dzdy, 1);
        const nx = -dzdx / mag;
        const ny = -dzdy / mag;
        const nz = 1 / mag;

        const shade = Math.max(0.3, Math.min(1.4, nx * lx + ny * ly + nz * lz));

        // Hypsometric tint
        let r = 74, g = 124, b = 89; // Forest green < 900m
        if (elev >= 3200) {
          // Snow and ice
          r = 245; g = 248; b = 252;
        } else if (elev >= 2200) {
          // Alpine rock
          const t = (elev - 2200) / 1000;
          r = Math.round(160 + t * 60);
          g = Math.round(150 + t * 60);
          b = Math.round(145 + t * 70);
        } else if (elev >= 1300) {
          // Montane
          const t = (elev - 1300) / 900;
          r = Math.round(140 + t * 20);
          g = Math.round(143 + t * 7);
          b = Math.round(88 + t * 57);
        } else {
          // Foothills
          const t = Math.max(0, (elev - 400) / 900);
          r = Math.round(74 + t * 66);
          g = Math.round(124 + t * 19);
          b = Math.round(89 - t * 1);
        }

        const pidx = (y * width + x) * 4;
        d[pidx] = Math.min(255, Math.round(r * shade));
        d[pidx + 1] = Math.min(255, Math.round(g * shade));
        d[pidx + 2] = Math.min(255, Math.round(b * shade));
        d[pidx + 3] = 255;
      }
    }

    octx.putImageData(imgData, 0, 0);
    this.reliefCanvas = offscreen;
  }

  // Ground height over width of the tile (a Mercator tile is close to square).
  private groundAspect(): number {
    if (!this.dem) return 1;
    const [w, s0, e, n] = this.dem.bounds;
    return ((n - s0) * 110.57) / ((e - w) * 111.32 * Math.cos(((n + s0) / 2) * Math.PI / 180));
  }

  panBy(dx: number, dy: number): void {
    this.panOffset.x += dx;
    this.panOffset.y += dy;
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
      this.panBy(dx, dy);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDelta = -e.deltaY * 0.002;
      const z = Math.max(0.6, Math.min(3.0, this.zoom + zoomDelta));
      // Keep the relief point under the pointer still (the plate is centred).
      const r = this.canvas.getBoundingClientRect();
      const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2;
      const k = z / this.zoom;
      this.panOffset.x = ox - (ox - this.panOffset.x) * k;
      this.panOffset.y = oy - (oy - this.panOffset.y) * k;
      this.setZoom(z);
    }, { passive: false });
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 1. Map Plate Background (cream paper tone)
    ctx.fillStyle = '#f8f6f0';
    ctx.fillRect(0, 0, w, h);

    // Margins
    const mx = 36;
    const my = 40;
    const mapW = w - mx * 2;
    const mapH = h - my * 2;

    // 2. Map Viewport (Clipped inside inner neatline)
    ctx.save();
    ctx.beginPath();
    ctx.rect(mx, my, mapW, mapH);
    ctx.clip();

    // Where the relief lands on screen; the furniture is derived from it.
    let plate = { left: mx, top: my, width: mapW, height: mapH };

    // Map content background
    ctx.fillStyle = '#1e2832';
    ctx.fillRect(mx, my, mapW, mapH);

    // Draw Shaded Relief
    if (this.reliefCanvas) {
      const rx = mx + mapW / 2 + this.panOffset.x;
      const ry = my + mapH / 2 + this.panOffset.y;
      const drawSize = Math.min(mapW, mapH) * 1.05 * this.zoom;
      const drawH = drawSize * this.groundAspect();

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        this.reliefCanvas,
        rx - drawSize / 2,
        ry - drawH / 2,
        drawSize,
        drawH
      );
      plate = { left: rx - drawSize / 2, top: ry - drawH / 2, width: drawSize, height: drawH };

      // Summit elevation marker & text
      if (this.dem) {
        const peakNormX = this.dem.peak[0] - 0.5;
        const peakNormY = this.dem.peak[1] - 0.5;
        const peakSx = rx + peakNormX * drawSize;
        const peakSy = ry + peakNormY * drawH;

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#1a202c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(peakSx, peakSy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#1a202c';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillText('Mt. Rainier (4,392 m)', peakSx + 8, peakSy + 4);
      }
    }

    ctx.restore();

    // 3. Neatline Double Frame
    // Outer border (thick)
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 3;
    ctx.strokeRect(mx - 4, my - 4, mapW + 8, mapH + 8);

    // Inner neatline
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, mapW, mapH);

    // Coordinate margin ticks & labels
    ctx.fillStyle = '#2d3748';
    ctx.font = '9px system-ui, sans-serif';
    // Labels give the coordinates at those points of the frame, from the
    // tile's extent and where the relief is drawn (they were fixed strings
    // for another box, and the latitudes were cut off by the page edge).
    const [west, south, east, north] = this.dem ? this.dem.bounds : [0, 0, 0, 0];
    const dm = (v: number, pos: string, neg: string): string => {
      const a = Math.abs(v), d = Math.floor(a), m = Math.round((a - d) * 60);
      return `${m === 60 ? d + 1 : d}°${String(m % 60).padStart(2, '0')}'${v < 0 ? neg : pos}`;
    };
    const lonAt = (x: number): string => dm(west + ((x - plate.left) / plate.width) * (east - west), 'E', 'W');
    const latAt = (y: number): string => dm(north - ((y - plate.top) / plate.height) * (north - south), 'N', 'S');
    ctx.textAlign = 'center';
    for (const x of [mx + 20, mx + mapW / 2, mx + mapW - 20]) ctx.fillText(lonAt(x), x, my - 8);
    for (const y of [my + 15, my + mapH - 15]) {
      ctx.save();
      ctx.translate(mx - 10, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(latAt(y), 0, 0);
      ctx.restore();
    }

    // 4. Title Cartouche Banner (Top Center)
    const tw = 280;
    const th = 46;
    const tx = mx + (mapW - tw) / 2;
    const ty = my + 14;

    ctx.fillStyle = 'rgba(248, 246, 240, 0.95)';
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 1.5;
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeRect(tx, ty, tw, th);
    ctx.strokeRect(tx + 2, ty + 2, tw - 4, th - 4);

    ctx.fillStyle = '#1a202c';
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px "Times New Roman", serif, system-ui';
    ctx.fillText('MINI DEM PLATE', tx + tw / 2, ty + 19);
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = '#4a5568';
    ctx.fillText('MOUNT RAINIER • SHADED RELIEF', tx + tw / 2, ty + 35);

    // 5. Cartographic Furniture: North Arrow (Top Right)
    const nx = mx + mapW - 40;
    const ny = my + 44;
    ctx.fillStyle = 'rgba(248, 246, 240, 0.9)';
    ctx.fillRect(nx - 18, ny - 24, 36, 48);
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 1;
    ctx.strokeRect(nx - 18, ny - 24, 36, 48);

    // Needle
    ctx.beginPath();
    ctx.moveTo(nx, ny - 16);
    ctx.lineTo(nx - 6, ny + 10);
    ctx.lineTo(nx, ny + 5);
    ctx.fillStyle = '#1a202c';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(nx, ny - 16);
    ctx.lineTo(nx + 6, ny + 10);
    ctx.lineTo(nx, ny + 5);
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#1a202c';
    ctx.stroke();
    ctx.fill();

    ctx.fillStyle = '#1a202c';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', nx, ny - 18);

    // 6. Cartographic Furniture: Scale Bar (Bottom Right)
    const sbW = 120;
    const sbH = 34;
    const sbX = mx + mapW - sbW - 16;
    const sbY = my + mapH - sbH - 16;

    ctx.fillStyle = 'rgba(248, 246, 240, 0.92)';
    ctx.fillRect(sbX, sbY, sbW, sbH);
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 1;
    ctx.strokeRect(sbX, sbY, sbW, sbH);

    // Graphic bar: 4 alternating blocks, as long as a round distance that
    // takes 55 to 92 px at the current zoom (it was 10 km at any zoom).
    const kmPerPx = this.dem ? (east - west) * 111.32 * Math.cos(((north + south) / 2) * Math.PI / 180) / plate.width : 0;
    const barKm = [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 50].find((k) => k / kmPerPx >= 55) ?? 50;
    const barX = sbX + 14;
    const barY = sbY + 16;
    const barW = barKm / kmPerPx;
    const barH = 5;
    const segW = barW / 4;

    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1a202c' : '#ffffff';
      ctx.fillRect(barX + i * segW, barY, segW, barH);
      ctx.strokeRect(barX + i * segW, barY, segW, barH);
    }

    ctx.fillStyle = '#1a202c';
    ctx.font = '8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('0', barX, barY - 3);
    ctx.fillText(`${barKm / 2} km`, barX + segW * 2, barY - 3);
    ctx.fillText(`${barKm} km`, barX + barW, barY - 3);

    // 7. Cartographic Furniture: Elevation Legend (Bottom Left)
    const legW = 130;
    const legH = 36;
    const legX = mx + 16;
    const legY = my + mapH - legH - 16;

    ctx.fillStyle = 'rgba(248, 246, 240, 0.92)';
    ctx.fillRect(legX, legY, legW, legH);
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 1;
    ctx.strokeRect(legX, legY, legW, legH);

    // Ramp bar
    const rX = legX + 12;
    const rY = legY + 16;
    const rW = 106;
    const rH = 6;
    const grad = ctx.createLinearGradient(rX, 0, rX + rW, 0);
    grad.addColorStop(0, '#4a7c59');   // Forest green
    grad.addColorStop(0.35, '#8c8f58'); // Montane
    grad.addColorStop(0.7, '#a08d75');  // Alpine rock
    grad.addColorStop(1, '#ffffff');    // Snow/ice
    ctx.fillStyle = grad;
    ctx.fillRect(rX, rY, rW, rH);
    ctx.strokeRect(rX, rY, rW, rH);

    ctx.fillStyle = '#1a202c';
    ctx.font = '8px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const metres = (v: number): string => `${String(Math.round(v)).replace(/\B(?=(\d{3})+$)/, ',')} m`;
    ctx.fillText(this.dem ? metres(this.dem.minElev) : '', rX, rY - 3);
    ctx.textAlign = 'right';
    ctx.fillText(this.dem ? metres(this.dem.maxElev) : '', rX + rW, rY - 3);

    // 8. Bottom Plate Metadata Footer
    ctx.fillStyle = '#718096';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FORGE3D CARTOGRAPHY ENGINE • USGS 3D ELEVATION PROGRAM', w / 2, h - 14);

    ctx.restore();
    if (this.onRender) this.onRender();
  }
}
