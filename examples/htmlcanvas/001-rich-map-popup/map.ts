// HTML-in-Canvas Map Renderer with Rich Native HTML Popup & GSI Seamlessphoto
//
// Uses WICG HTML-in-Canvas API (CanvasRenderingContext2D.prototype.drawElementImage)
// to render a live HTML element subtree directly onto Canvas 2D pixels over
// 国土地理院「全国最新写真（シームレス）」PMTiles aerial raster tiles.

import { openArchive } from './pmtiles.ts';

export interface Landmark {
  id: string;
  name: string;
  category: string;
  lon: number;
  lat: number;
  address: string;
  description: string;
  url: string;
}

export interface MapPopupView {
  canvas: HTMLCanvasElement;
  landmarks: Landmark[];
  activeLandmark: Landmark;
  bookmarked: boolean;
  hasDrawElementImage: boolean;
  render: () => Promise<void>;
  panBy: (dx: number, dy: number) => Promise<void>;
  zoomBy: (delta: number) => Promise<void>;
  getAnchorPos: () => { x: number; y: number };
  getPopupRect: () => { x: number; y: number; width: number; height: number };
  getButtonRect: () => { x: number; y: number; width: number; height: number };
  clickButton: () => Promise<boolean>;
  readPixel: (x: number, y: number) => Uint8ClampedArray;
  waitForTile: (timeoutMs?: number) => Promise<boolean>;
  hasAerialTiles: () => boolean;
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<MapPopupView> {
  const ctx = canvas.getContext('2d') as any;
  if (!ctx) throw new Error('Failed to get 2D context');

  const hasDrawElementImage = typeof ctx.drawElementImage === 'function';

  // Load landmarks
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`Failed to load landmarks: ${res.status}`);
  const landmarks: Landmark[] = await res.json();

  let activeLandmark = landmarks[0];
  let bookmarked = false;

  // DOM elements inside canvas
  const popup = document.getElementById('map-popup') as HTMLDivElement;
  const popupTitle = document.getElementById('popup-title') as HTMLDivElement;
  const popupBadge = document.getElementById('popup-badge') as HTMLDivElement;
  const popupAddress = document.getElementById('popup-address') as HTMLDivElement;
  const popupDesc = document.getElementById('popup-desc') as HTMLDivElement;
  const popupBtn = document.getElementById('popup-btn') as HTMLButtonElement;
  const popupLink = document.getElementById('popup-link') as HTMLAnchorElement;

  function updateDomContent(): void {
    if (popupTitle) popupTitle.textContent = activeLandmark.name;
    if (popupBadge) popupBadge.textContent = activeLandmark.category;
    if (popupAddress) popupAddress.textContent = activeLandmark.address;
    if (popupDesc) popupDesc.textContent = activeLandmark.description;
    if (popupBtn) {
      popupBtn.textContent = bookmarked ? '保存済み ✓' : '保存する';
      if (bookmarked) popupBtn.classList.add('active');
      else popupBtn.classList.remove('active');
    }
    if (popupLink) popupLink.href = activeLandmark.url;
  }

  async function toggleBookmark(): Promise<boolean> {
    bookmarked = !bookmarked;
    await render();
    return bookmarked;
  }

  popupBtn.addEventListener('click', () => {
    toggleBookmark();
  });

  // GSI Seamlessphoto PMTiles Tile Cache & State
  const SIZE = 512;
  let zoom = 14;
  const world = () => SIZE * (2 ** zoom);
  const mercator = (lon: number, lat: number) => ({
    x: ((lon + 180) / 360) * world(),
    y: ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * world(),
  });

  let center = mercator(139.755, 35.668);

  let archive: Awaited<ReturnType<typeof openArchive>> | null = null;
  const images = new Map<string, ImageBitmap | null>();
  const pending = new Set<string>();

  function requestTile(z: number, x: number, y: number): void {
    if (!archive) return;
    const key = `${z}/${x}/${y}`;
    if (images.has(key) || pending.has(key) || pending.size >= 8) return;
    pending.add(key);
    archive.tile(z, x, y)
      .then((bytes) => (bytes ? createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/jpeg' })) : null))
      .then((image) => {
        images.set(key, image);
        if (images.size > 64) {
          const oldest = images.keys().next().value!;
          images.get(oldest)?.close();
          images.delete(oldest);
        }
      })
      .catch(() => {
        images.set(key, null);
      })
      .finally(() => {
        pending.delete(key);
        render();
      });
  }

  function project(lon: number, lat: number): { x: number; y: number } {
    const m = mercator(lon, lat);
    return {
      x: canvas.width / 2 + (m.x - center.x),
      y: canvas.height / 2 + (m.y - center.y),
    };
  }

  function unproject(px: number, py: number): { lon: number; lat: number } {
    const mx = center.x + (px - canvas.width / 2);
    const my = center.y + (py - canvas.height / 2);
    const lon = (mx / world()) * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * my) / world()))) * (180 / Math.PI);
    return { lon, lat };
  }

  function getAnchorPos(): { x: number; y: number } {
    return project(activeLandmark.lon, activeLandmark.lat);
  }

  function getPopupRect(): { x: number; y: number; width: number; height: number } {
    const anchor = getAnchorPos();
    const w = popup.offsetWidth || 260;
    const h = popup.offsetHeight || 140;
    const px = Math.round(anchor.x - w / 2);
    const py = Math.round(anchor.y - h - 14);
    return { x: px, y: py, width: w, height: h };
  }

  function getButtonRect(): { x: number; y: number; width: number; height: number } {
    const pRect = getPopupRect();
    const bRect = popupBtn.getBoundingClientRect();
    const parentRect = popup.getBoundingClientRect();
    const bx = pRect.x + (bRect.x - parentRect.x);
    const by = pRect.y + (bRect.y - parentRect.y);
    return { x: bx, y: by, width: bRect.width, height: bRect.height };
  }

  async function render(): Promise<void> {
    updateDomContent();

    // Trigger HTML paint record update
    if (typeof (canvas as any).requestPaint === 'function') {
      await new Promise<void>((resolve) => {
        canvas.addEventListener('paint', () => resolve(), { once: true });
        (canvas as any).requestPaint();
      });
    } else {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    }

    const w = canvas.width;
    const h = canvas.height;

    // 1. Draw base background
    ctx.fillStyle = '#132332';
    ctx.fillRect(0, 0, w, h);

    // Draw GSI seamlessphoto aerial tiles
    const left = center.x - w / 2;
    const top = center.y - h / 2;
    const max = 2 ** zoom;
    const x0 = Math.max(0, Math.floor(left / SIZE));
    const y0 = Math.max(0, Math.floor(top / SIZE));
    const x1 = Math.min(max - 1, Math.floor((left + w) / SIZE));
    const y1 = Math.min(max - 1, Math.floor((top + h) / SIZE));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = `${zoom}/${x}/${y}`;
        const img = images.get(key);
        if (img) {
          const px0 = Math.round(x * SIZE - left);
          const py0 = Math.round(y * SIZE - top);
          const px1 = Math.round((x + 1) * SIZE - left);
          const py1 = Math.round((y + 1) * SIZE - top);
          ctx.drawImage(img, px0, py0, px1 - px0, py1 - py0);
        } else if (!images.has(key)) {
          requestTile(zoom, x, y);
        }
      }
    }

    // Connect landmarks with route guide lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    landmarks.forEach((l, idx) => {
      const pt = project(l.lon, l.lat);
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw Landmark Pin Markers
    for (const lm of landmarks) {
      const pt = project(lm.lon, lm.lat);
      const isActive = lm.id === activeLandmark.id;

      // Glow
      ctx.fillStyle = isActive ? 'rgba(56, 189, 248, 0.5)' : 'rgba(15, 23, 42, 0.6)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isActive ? 16 : 10, 0, Math.PI * 2);
      ctx.fill();

      // Pin center
      ctx.fillStyle = isActive ? '#38bdf8' : '#e2e8f0';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isActive ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();

      // Label below marker with dark backing for contrast against aerial photo
      const labelText = lm.name;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      const textMetrics = ctx.measureText(labelText);
      const bgW = textMetrics.width + 8;
      const bgH = 16;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(pt.x - bgW / 2, pt.y + 10, bgW, bgH);

      ctx.fillStyle = '#f8fafc';
      ctx.fillText(labelText, pt.x, pt.y + 22);
    }

    // 3. Draw HTML-in-Canvas Popup
    const pRect = getPopupRect();
    const anchor = getAnchorPos();

    // Draw white pointer arrow triangle on canvas
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(anchor.x - 8, pRect.y + pRect.height);
    ctx.lineTo(anchor.x + 8, pRect.y + pRect.height);
    ctx.lineTo(anchor.x, anchor.y);
    ctx.closePath();
    ctx.fill();

    // Draw native HTML element into canvas pixels
    if (hasDrawElementImage) {
      ctx.drawElementImage(popup, pRect.x, pRect.y);
    } else {
      // Fallback for non-supporting environments
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(pRect.x, pRect.y, pRect.width, pRect.height);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(activeLandmark.name, pRect.x + 14, pRect.y + 24);
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText(activeLandmark.description.slice(0, 20), pRect.x + 14, pRect.y + 50);
    }
  }

  // Pointer interactions
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Check click on button inside popup
    const bRect = getButtonRect();
    if (
      cx >= bRect.x &&
      cx <= bRect.x + bRect.width &&
      cy >= bRect.y &&
      cy <= bRect.y + bRect.height
    ) {
      popupBtn.click();
      return;
    }

    // Check click on pins
    for (const lm of landmarks) {
      const pt = project(lm.lon, lm.lat);
      const dist = Math.hypot(cx - pt.x, cy - pt.y);
      if (dist < 18) {
        activeLandmark = lm;
        render();
        return;
      }
    }

    // Otherwise start pan
    isDragging = true;
    dragStartX = cx;
    dragStartY = cy;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const dx = cx - dragStartX;
    const dy = cy - dragStartY;
    dragStartX = cx;
    dragStartY = cy;

    center.x -= dx;
    center.y -= dy;
    render();
  });

  const stopDrag = (e: PointerEvent) => {
    if (isDragging) {
      isDragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    zoom = Math.max(10, Math.min(17, zoom + delta));
    render();
  }, { passive: false });

  async function panBy(dx: number, dy: number): Promise<void> {
    center.x -= dx;
    center.y -= dy;
    await render();
  }

  async function zoomBy(delta: number): Promise<void> {
    zoom = Math.max(10, Math.min(17, zoom + delta));
    await render();
  }

  function readPixel(x: number, y: number): Uint8ClampedArray {
    const rx = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
    const ry = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
    return ctx.getImageData(rx, ry, 1, 1).data;
  }

  async function clickButton(): Promise<boolean> {
    return await toggleBookmark();
  }

  async function waitForTile(timeoutMs = 6000): Promise<boolean> {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      for (const img of images.values()) {
        if (img) return true;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    return false;
  }

  function hasAerialTiles(): boolean {
    for (const img of images.values()) {
      if (img) return true;
    }
    return false;
  }

  // Open PMTiles archive
  try {
    archive = await openArchive();
    const cx = Math.floor(center.x / SIZE);
    const cy = Math.floor(center.y / SIZE);
    requestTile(zoom, cx, cy);
  } catch (err) {
    console.warn('Seamlessphoto PMTiles error:', err);
  }

  await render();

  return {
    canvas,
    landmarks,
    activeLandmark,
    get bookmarked() {
      return bookmarked;
    },
    hasDrawElementImage,
    render,
    panBy,
    zoomBy,
    getAnchorPos,
    getPopupRect,
    getButtonRect,
    clickButton,
    readPixel,
    waitForTile,
    hasAerialTiles,
  };
}
