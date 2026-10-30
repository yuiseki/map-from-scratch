export interface QuickStartMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  activePopup: { text: string; lat: number; lng: number } | null;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  clickAtScreen(x: number, y: number): void;
  getScreenPos(lat: number, lng: number): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const latFromMercY = (my: number) => (Math.atan(Math.exp((1 - 2 * my) * Math.PI)) - Math.PI / 4) * 360 / Math.PI;

// Leaflet quick start features
const LONDON_LAT = 51.505;
const LONDON_LNG = -0.09;

const MARKER_LAT = 51.5;
const MARKER_LNG = -0.09;

const CIRCLE_LAT = 51.508;
const CIRCLE_LNG = -0.11;
const CIRCLE_RADIUS_METERS = 500;

const POLYGON_COORDS: [number, number][] = [
  [51.509, -0.08],
  [51.503, -0.06],
  [51.51, -0.047],
];

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<QuickStartMap> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (!ctx) throw new Error('2D context not available');

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = (LONDON_LNG + 180) / 360;
  let centerMy = mercY(LONDON_LAT);
  let zoom = 13;
  let dpr = window.devicePixelRatio || 1;

  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;

  // Active popup (initially standalone popup at [51.513, -0.09])
  let activePopup: { text: string; lat: number; lng: number } | null = {
    text: 'I am a standalone popup.',
    lat: 51.513,
    lng: -0.09,
  };

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth || 800;
    height = canvas.clientHeight || 600;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
  }

  function getScreenPos(lat: number, lng: number): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    const mx = (lng + 180) / 360;
    const my = mercY(lat);
    const sx = width / 2 + (mx - centerMx) * scale;
    const sy = height / 2 + (my - centerMy) * scale;
    return [sx, sy];
  }

  function screenToLatLng(sx: number, sy: number): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    const mx = centerMx + (sx - width / 2) / scale;
    const my = centerMy + (sy - height / 2) / scale;
    const lng = mx * 360 - 180;
    const lat = latFromMercY(my);
    return [lat, lng];
  }

  function pointInPoly(px: number, py: number, poly: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
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
    ctx.fillStyle = '#f2efe9';
    ctx.strokeStyle = '#d9d4c7';
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

    // 1. Circle (500m at [51.508, -0.11])
    const [cx, cy] = getScreenPos(CIRCLE_LAT, CIRCLE_LNG);
    const metersPerUnit = 40075016.68557849 * Math.cos(CIRCLE_LAT * Math.PI / 180);
    const circleRadiusPx = (CIRCLE_RADIUS_METERS / metersPerUnit) * scale;

    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, circleRadiusPx), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 0, 51, 0.5)';
    ctx.fill();
    ctx.strokeStyle = '#ff0033';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 2. Polygon
    const polyScreen = POLYGON_COORDS.map(([lat, lng]) => getScreenPos(lat, lng));
    ctx.beginPath();
    for (let i = 0; i < polyScreen.length; i++) {
      const [px, py] = polyScreen[i];
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(51, 136, 255, 0.2)';
    ctx.fill();
    ctx.strokeStyle = '#3388ff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 3. Leaflet Blue Marker Pin at [51.5, -0.09]
    const [mx, my] = getScreenPos(MARKER_LAT, MARKER_LNG);
    ctx.save();
    ctx.translate(mx, my);

    // Marker shadow
    ctx.beginPath();
    ctx.ellipse(5, 0, 10, 4, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fill();

    // Leaflet marker pin (#2A81CB)
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-4, -10, -12, -22, -12, -32);
    ctx.arc(0, -32, 12, Math.PI, 0, false);
    ctx.bezierCurveTo(12, -22, 4, -10, 0, 0);
    ctx.closePath();
    ctx.fillStyle = '#2A81CB';
    ctx.fill();
    ctx.strokeStyle = '#1b5f99';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Inner circle
    ctx.beginPath();
    ctx.arc(0, -32, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    // 4. Active Popup
    if (activePopup) {
      const [px, py] = getScreenPos(activePopup.lat, activePopup.lng);
      ctx.save();
      ctx.font = '13px system-ui, sans-serif';
      const textWidth = ctx.measureText(activePopup.text).width;
      const pw = Math.max(140, textWidth + 24);
      const ph = 36;
      const popX = px - pw / 2;
      const popY = py - ph - 16;

      // Popup bubble with drop shadow
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;

      ctx.beginPath();
      ctx.roundRect(popX, popY, pw, ph, 8);
      // Bottom pointer arrow
      ctx.moveTo(px - 7, popY + ph);
      ctx.lineTo(px, popY + ph + 8);
      ctx.lineTo(px + 7, popY + ph);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Text inside popup
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#222222';
      ctx.fillText(activePopup.text, popX + 12, popY + 22);

      ctx.restore();
    }

    ctx.restore();
  }

  // Pointer drag panning
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = false;
  // A click survives 3 px of movement from the press (not per move event).
  let downX = 0;
  let downY = 0;

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    moved = false;
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 3) moved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    panBy(dx, dy);
  }

  function onPointerUp(e: PointerEvent): void {
    if (dragging) {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
      if (!moved) {
        clickAtScreen(e.clientX, e.clientY);
      }
    }
  }

  function clickAtScreen(sx: number, sy: number): void {
    // 1. Check marker
    const [mx, my] = getScreenPos(MARKER_LAT, MARKER_LNG);
    const distMarker = Math.hypot(sx - mx, sy - (my - 20));
    if (distMarker < 20) {
      activePopup = { text: 'Hello world! I am a popup.', lat: MARKER_LAT, lng: MARKER_LNG };
      draw();
      return;
    }

    // 2. Check circle
    const [cx, cy] = getScreenPos(CIRCLE_LAT, CIRCLE_LNG);
    const scale = 256 * Math.pow(2, zoom);
    const metersPerUnit = 40075016.68557849 * Math.cos(CIRCLE_LAT * Math.PI / 180);
    const circleRadiusPx = (CIRCLE_RADIUS_METERS / metersPerUnit) * scale;
    if (Math.hypot(sx - cx, sy - cy) <= circleRadiusPx) {
      activePopup = { text: 'I am a circle.', lat: CIRCLE_LAT, lng: CIRCLE_LNG };
      draw();
      return;
    }

    // 3. Check polygon
    const polyScreen = POLYGON_COORDS.map(([lat, lng]) => getScreenPos(lat, lng));
    if (pointInPoly(sx, sy, polyScreen)) {
      activePopup = { text: 'I am a polygon.', lat: 51.507, lng: -0.065 };
      draw();
      return;
    }

    // 4. Empty map click -> show coordinates
    const [lat, lng] = screenToLatLng(sx, sy);
    activePopup = {
      text: `You clicked at (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      lat,
      lng,
    };
    draw();
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    zoomAt(e, zoom + delta);
  }

  // Zoom keeping the point under the pointer still (MapLibre, Leaflet do).
  function zoomAt(e: WheelEvent, z: number): void {
    const r = canvas.getBoundingClientRect();
    const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2;
    const before = 256 * Math.pow(2, zoom);
    centerMx += ox / before;
    centerMy += oy / before;
    setZoom(z);
    const after = 256 * Math.pow(2, zoom);
    centerMx -= ox / after;
    centerMy -= oy / after;
    draw();
  }

  function panBy(dx: number, dy: number): void {
    const scale = 256 * Math.pow(2, zoom);
    centerMx -= dx / scale;
    centerMy -= dy / scale;
    draw();
  }

  function setZoom(z: number): void {
    zoom = Math.max(2, Math.min(18, z));
    draw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  return {
    canvas,
    ctx,
    get center(): [number, number] { return [centerMx, centerMy]; },
    get zoom() { return zoom; },
    get activePopup() { return activePopup; },
    draw,
    panBy,
    setZoom,
    clickAtScreen,
    getScreenPos,
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
