export interface PopupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  closeBtn: { x: number; y: number; size: number };
}

export interface PopupMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  popupVisible: boolean;
  popupLngLat: [number, number];
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  setPopupVisible(visible: boolean): void;
  getScreenPos(lon: number, lat: number): [number, number];
  getPopupBounds(): PopupBounds;
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const US_CENTER_LNG = -96.0;
const US_CENTER_LAT = 37.8;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(US_CENTER_LNG);
const defaultCenterMy = mercY(US_CENTER_LAT);

export async function mount(
  canvas: HTMLCanvasElement,
  landUrl: string,
): Promise<PopupMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = 3;
  let popupVisible = true;
  const popupLngLat: [number, number] = [US_CENTER_LNG, US_CENTER_LAT];
  let dpr = window.devicePixelRatio || 1;

  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth || 800;
    height = canvas.clientHeight || 600;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
  }

  function getScreenPos(lon: number, lat: number): [number, number] {
    const mx = mercX(lon);
    const my = mercY(lat);
    const scale = 256 * Math.pow(2, zoom);
    const sx = width / 2 + (mx - centerMx) * scale;
    const sy = height / 2 + (my - centerMy) * scale;
    return [sx, sy];
  }

  function getPopupBounds(): PopupBounds {
    const [tipX, tipY] = getScreenPos(popupLngLat[0], popupLngLat[1]);
    const bubbleW = 140;
    const bubbleH = 44;
    const tipH = 10;
    const bx = tipX - bubbleW / 2;
    const by = tipY - tipH - bubbleH;
    return {
      x: bx,
      y: by,
      width: bubbleW,
      height: bubbleH,
      closeBtn: {
        x: bx + bubbleW - 20,
        y: by + 6,
        size: 16,
      },
    };
  }

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);

    // Ocean background
    ctx.fillStyle = '#aad3df';
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    // Land polygons
    ctx.fillStyle = '#f0eee8';
    ctx.strokeStyle = '#d0cdc4';
    ctx.lineWidth = 1;

    for (const poly of polygons) {
      if (poly.length === 0) continue;
      ctx.beginPath();
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const rx = originX + ring[i][0] * scale;
          const ry = originY + ring[i][1] * scale;
          if (i === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
      }
      ctx.fill();
      ctx.stroke();
    }

    // Popup
    if (popupVisible) {
      const [tipX, tipY] = getScreenPos(popupLngLat[0], popupLngLat[1]);
      const bounds = getPopupBounds();

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;

      // Popup bubble path (rounded rectangle + bottom pointer tip)
      const r = 6;
      ctx.beginPath();
      ctx.moveTo(bounds.x + r, bounds.y);
      ctx.lineTo(bounds.x + bounds.width - r, bounds.y);
      ctx.arcTo(bounds.x + bounds.width, bounds.y, bounds.x + bounds.width, bounds.y + r, r);
      ctx.lineTo(bounds.x + bounds.width, bounds.y + bounds.height - r);
      ctx.arcTo(bounds.x + bounds.width, bounds.y + bounds.height, bounds.x + bounds.width - r, bounds.y + bounds.height, r);
      // bottom edge with tip
      ctx.lineTo(tipX + 8, bounds.y + bounds.height);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX - 8, bounds.y + bounds.height);
      ctx.lineTo(bounds.x + r, bounds.y + bounds.height);
      ctx.arcTo(bounds.x, bounds.y + bounds.height, bounds.x, bounds.y + bounds.height - r, r);
      ctx.lineTo(bounds.x, bounds.y + r);
      ctx.arcTo(bounds.x, bounds.y, bounds.x + r, bounds.y, r);
      ctx.closePath();

      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();

      // Popup content: <h1>Hello World!</h1>
      ctx.fillStyle = '#222222';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('Hello World!', bounds.x + 14, bounds.y + bounds.height / 2);

      // Close button (x)
      ctx.fillStyle = '#888888';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('×', bounds.closeBtn.x + bounds.closeBtn.size / 2, bounds.closeBtn.y + bounds.closeBtn.size / 2);
    }

    ctx.restore();
  }

  // Pointer drag panning & click detection
  let dragging = false;
  let didDrag = false;
  let startX = 0;
  let startY = 0;

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    didDrag = false;
    startX = e.clientX;
    startY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      didDrag = true;
    }
    startX = e.clientX;
    startY = e.clientY;
    panBy(dx, dy);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (!didDrag) {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      if (popupVisible) {
        const bounds = getPopupBounds();
        const btn = bounds.closeBtn;
        if (
          clickX >= btn.x &&
          clickX <= btn.x + btn.size &&
          clickY >= btn.y &&
          clickY <= btn.y + btn.size
        ) {
          popupVisible = false;
          draw();
          return;
        }
      }
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const dz = e.deltaY < 0 ? 0.25 : -0.25;
    setZoom(zoom + dz);
  }

  function panBy(dx: number, dy: number): void {
    const scale = 256 * Math.pow(2, zoom);
    centerMx -= dx / scale;
    centerMy -= dy / scale;
    draw();
  }

  function setZoom(z: number): void {
    zoom = Math.max(1, Math.min(10, z));
    draw();
  }

  function setPopupVisible(visible: boolean): void {
    popupVisible = visible;
    draw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', resize);

  resize();

  return {
    canvas,
    ctx,
    get center(): [number, number] {
      return [centerMx, centerMy];
    },
    get zoom(): number {
      return zoom;
    },
    get popupVisible(): boolean {
      return popupVisible;
    },
    get popupLngLat(): [number, number] {
      return [popupLngLat[0], popupLngLat[1]];
    },
    draw,
    panBy,
    setZoom,
    setPopupVisible,
    getScreenPos,
    getPopupBounds,
    destroy(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', resize);
    },
  };
}
