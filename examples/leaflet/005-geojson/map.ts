export interface GeoJsonMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
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
type Feature =
  | { type: 'Feature'; properties: { name: string }; geometry: { type: 'Point'; coordinates: [number, number] } }
  | { type: 'Feature'; properties: { name: string }; geometry: { type: 'LineString'; coordinates: [number, number][] } }
  | { type: 'Feature'; properties: { name: string }; geometry: { type: 'Polygon'; coordinates: Ring[] } };

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;
const latFromMercY = (my: number): number =>
  (Math.atan(Math.exp((1 - 2 * my) * Math.PI)) - Math.PI / 4) * 360 / Math.PI;

const POINT_COLOR = '#2a81cb';
const LINE_COLOR = '#ff7f2a';
const POLYGON_COLOR = '#2a81cb';

export async function mount(
  canvas: HTMLCanvasElement,
  landUrl: string,
  featuresUrl: string,
): Promise<GeoJsonMap> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (!ctx) throw new Error('2D context not available');

  const [landRes, featureRes] = await Promise.all([fetch(landUrl), fetch(featuresUrl)]);
  if (!landRes.ok) throw new Error(`failed to fetch land polygons: ${landRes.status}`);
  if (!featureRes.ok) throw new Error(`failed to fetch features: ${featureRes.status}`);
  const polygons = (await landRes.json()) as Polygon[];
  const features = ((await featureRes.json()) as { features: Feature[] }).features;

  let centerMx = mercX(8);
  let centerMy = mercY(49);
  let zoom = 5;
  let dpr = window.devicePixelRatio || 1;
  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;
  let activePopup: { text: string; lat: number; lng: number } | null = null;

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
    return [width / 2 + (mercX(lng) - centerMx) * scale, height / 2 + (mercY(lat) - centerMy) * scale];
  }

  function screenToLatLng(sx: number, sy: number): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    const mx = centerMx + (sx - width / 2) / scale;
    const my = centerMy + (sy - height / 2) / scale;
    return [latFromMercY(my), mx * 360 - 180];
  }

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#aad3df';
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    ctx.fillStyle = '#f2efe9';
    ctx.strokeStyle = '#d9d4c7';
    ctx.lineWidth = 1;
    for (const poly of polygons) {
      ctx.beginPath();
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const x = originX + ring[i][0] * scale;
          const y = originY + ring[i][1] * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.fill();
      ctx.stroke();
    }

    // Polygon features
    for (const f of features) {
      if (f.geometry.type !== 'Polygon') continue;
      ctx.beginPath();
      for (const ring of f.geometry.coordinates) {
        ring.forEach(([lng, lat], i) => {
          const [x, y] = getScreenPos(lat, lng);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
      }
      ctx.fillStyle = 'rgba(42, 129, 203, 0.25)';
      ctx.fill();
      ctx.strokeStyle = POLYGON_COLOR;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Line features
    for (const f of features) {
      if (f.geometry.type !== 'LineString') continue;
      ctx.beginPath();
      f.geometry.coordinates.forEach(([lng, lat], i) => {
        const [x, y] = getScreenPos(lat, lng);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // Point features
    for (const f of features) {
      if (f.geometry.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates;
      const [x, y] = getScreenPos(lat, lng);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = POINT_COLOR;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Popup
    if (activePopup) {
      const [x, y] = getScreenPos(activePopup.lat, activePopup.lng);
      ctx.font = '12px system-ui, sans-serif';
      const textW = ctx.measureText(activePopup.text).width;
      const w = textW + 16;
      const h = 24;
      const bx = Math.max(4, Math.min(width - w - 4, x - w / 2));
      const by = Math.max(4, y - 36);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#222';
      ctx.textBaseline = 'middle';
      ctx.fillText(activePopup.text, bx + 8, by + h / 2 + 0.5);
    }

    ctx.restore();
  }

  function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function pointInRing(px: number, py: number, ring: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function clickAtScreen(x: number, y: number): void {
    let hit: { text: string; lat: number; lng: number } | null = null;
    // Points first, then lines, then polygons.
    for (const f of features) {
      if (f.geometry.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates;
      const [sx, sy] = getScreenPos(lat, lng);
      if (Math.hypot(sx - x, sy - y) <= 10) {
        hit = { text: f.properties.name, lat, lng };
        break;
      }
    }
    if (!hit) {
      for (const f of features) {
        if (f.geometry.type !== 'LineString') continue;
        const pts = f.geometry.coordinates;
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = getScreenPos(pts[i - 1][1], pts[i - 1][0]);
          const [bx, by] = getScreenPos(pts[i][1], pts[i][0]);
          if (distanceToSegment(x, y, ax, ay, bx, by) <= 6) {
            const [lat, lng] = screenToLatLng(x, y);
            hit = { text: f.properties.name, lat, lng };
            break;
          }
        }
        if (hit) break;
      }
    }
    if (!hit) {
      for (const f of features) {
        if (f.geometry.type !== 'Polygon') continue;
        const rings = f.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => getScreenPos(lat, lng)));
        if (pointInRing(x, y, rings[0]) && !rings.slice(1).some((ring) => pointInRing(x, y, ring))) {
          const [lat, lng] = screenToLatLng(x, y);
          hit = { text: f.properties.name, lat, lng };
          break;
        }
      }
    }
    activePopup = hit;
    draw();
  }

  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 0) moved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    panBy(dx, dy);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (!moved) {
      const rect = canvas.getBoundingClientRect();
      clickAtScreen(e.clientX - rect.left, e.clientY - rect.top);
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(zoom + (e.deltaY < 0 ? 0.25 : -0.25));
  }, { passive: false });
  window.addEventListener('resize', resize);

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

  resize();

  return {
    canvas,
    ctx,
    get activePopup() {
      return activePopup;
    },
    draw,
    panBy,
    setZoom,
    clickAtScreen,
    getScreenPos,
    destroy(): void {
      window.removeEventListener('resize', resize);
    },
  };
}
