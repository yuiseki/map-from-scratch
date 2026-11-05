// HTML-in-Canvas Map Renderer with Rich Native HTML Popup & GSI Seamlessphoto
//
// Uses HTML-in-Canvas (shipped in Chrome 157): ctx.drawElementImage draws a
// live HTML element, a child of <canvas content="drawable">, into Canvas 2D
// pixels over 国土地理院「全国最新写真（シームレス）」PMTiles aerial raster
// tiles. In 2D the browser moves the element's hit-test box to where it was
// drawn, so the popup's button and link take real clicks, hover and focus.
// A browser without the API gets the same popup as a DOM overlay.

import { openArchive } from './pmtiles.ts';
import { popupRectAtAnchor, projectWorld, unprojectWorld } from './geometry.ts';
import { hitTestCacheBuster, supportsHtmlInCanvas } from './support.ts';

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
  // true: drawn into the canvas with drawElementImage. false: the popup is a
  // DOM overlay (a browser without HTML-in-Canvas).
  htmlInCanvas: boolean;
  popup: HTMLElement;
  popupButton: HTMLButtonElement;
  render: () => Promise<void>;
  panBy: (dx: number, dy: number) => Promise<void>;
  zoomBy: (delta: number) => Promise<void>;
  getAnchorPos: () => { x: number; y: number };
  getPopupRect: () => { x: number; y: number; width: number; height: number };
  getButtonRect: () => { x: number; y: number; width: number; height: number };
  readPixel: (x: number, y: number) => Uint8ClampedArray;
  waitForTile: (timeoutMs?: number) => Promise<boolean>;
  // Resolves true once every tile of the current view has arrived (or is
  // known to be missing), false after timeoutMs.
  waitForView: (timeoutMs?: number) => Promise<boolean>;
  hasAerialTiles: () => boolean;
}

// onDraw runs after every frame, including those the popup's own button
// asks for, so a HUD outside the canvas stays in step.
export async function mount(canvas: HTMLCanvasElement, dataUrl: string, onDraw: () => void = () => {}): Promise<MapPopupView> {
  const ctx = canvas.getContext('2d') as any;
  if (!ctx) throw new Error('Failed to get 2D context');

  // ?fallback forces the DOM overlay, to look at what other browsers get.
  const bustHitTests = hitTestCacheBuster();
  const htmlInCanvas = !new URLSearchParams(location.search).has('fallback') && supportsHtmlInCanvas(canvas);

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
  // Without the API, children of a canvas are fallback content and never
  // rendered: lift the popup out and place it over the canvas instead.
  if (!htmlInCanvas) {
    canvas.after(popup);
    popup.style.position = 'absolute';
    popup.style.left = '0';
    popup.style.top = '0';
  }

  // Write the popup's DOM only where it changed: setting textContent, even to
  // the same text, replaces the text node and lays the popup out again, and
  // a pan changes none of it.
  const setText = (el: HTMLElement | null, text: string): void => {
    if (el && el.textContent !== text) el.textContent = text;
  };
  function updateDomContent(): void {
    setText(popupTitle, activeLandmark.name);
    setText(popupBadge, activeLandmark.category);
    setText(popupAddress, activeLandmark.address);
    setText(popupDesc, activeLandmark.description);
    if (popupBtn) {
      setText(popupBtn, bookmarked ? '保存済み ✓' : '保存する');
      popupBtn.classList.toggle('active', bookmarked);
    }
    if (popupLink && popupLink.href !== activeLandmark.url) popupLink.href = activeLandmark.url;
  }

  // The button gets the real click: the browser hit-tests it where it was
  // drawn. (Before Chrome 157 this example compared the pointer with the
  // button's rectangle itself and called click().)
  popupBtn.addEventListener('click', () => {
    bookmarked = !bookmarked;
    render();
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
    return projectWorld(m.x, m.y, center.x, center.y, canvas.width, canvas.height);
  }

  function unproject(px: number, py: number): { lon: number; lat: number } {
    return unprojectWorld(px, py, center.x, center.y, canvas.width, canvas.height, world());
  }

  function getAnchorPos(): { x: number; y: number } {
    return project(activeLandmark.lon, activeLandmark.lat);
  }

  function getPopupRect(): { x: number; y: number; width: number; height: number } {
    const anchor = getAnchorPos();
    const w = popup.offsetWidth || 260;
    const h = popup.offsetHeight || 140;
    return popupRectAtAnchor(anchor.x, anchor.y, w, h);
  }

  function getButtonRect(): { x: number; y: number; width: number; height: number } {
    const pRect = getPopupRect();
    const bRect = popupBtn.getBoundingClientRect();
    const parentRect = popup.getBoundingClientRect();
    const bx = pRect.x + (bRect.x - parentRect.x);
    const by = pRect.y + (bRect.y - parentRect.y);
    return { x: bx, y: by, width: bRect.width, height: bRect.height };
  }

  // A frame is drawn in the canvas's paint event: drawElementImage needs the
  // element's paint record, which exists only from the first paint on, and
  // in the event it is the one for this frame. render() writes the popup's
  // DOM and asks for that event; every caller waiting resolves once it ran.
  let waiting: (() => void)[] = [];
  let frameQueued = false;
  function render(): Promise<void> {
    updateDomContent();
    return new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (frameQueued) return;
      frameQueued = true;
      if (htmlInCanvas) (canvas as any).requestPaint();
      else requestAnimationFrame(onFrame);
    });
  }
  function onFrame(): void {
    frameQueued = false;
    draw();
    onDraw();
    const done = waiting;
    waiting = [];
    for (const r of done) r();
  }
  // Also fires by itself when the popup's rendering changes (hover, focus).
  if (htmlInCanvas) canvas.addEventListener('paint', onFrame);

  function draw(): void {
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

    // Draw the live HTML element into canvas pixels. Its hit-test box moves
    // with it. The fallback places the overlay at the same rectangle, in CSS
    // pixels of the canvas box.
    if (htmlInCanvas) {
      ctx.drawElementImage(popup, pRect.x, pRect.y);
      bustHitTests();
    } else {
      const box = canvas.getBoundingClientRect();
      const k = box.width / canvas.width;
      popup.style.transform = `translate(${box.left + window.scrollX + pRect.x * k}px, ${box.top + window.scrollY + pRect.y * k}px)`;
    }
  }

  // Pointer interactions
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    // Events on the popup bubble up to the canvas, its parent: leave them to
    // the popup's own button and link.
    if (popup.contains(e.target as Node)) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

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

  // center is in pixels of the current zoom's world, so a new zoom must
  // rescale it: without that, each step out moved the view to twice the
  // ground coordinate, and a few steps left Japan and then the world.
  // The ground under (px, py) stays put.
  function zoomAt(z: number, px: number, py: number): void {
    const next = Math.max(10, Math.min(17, z));
    const k = 2 ** (next - zoom);
    const ox = px - canvas.width / 2, oy = py - canvas.height / 2;
    center = { x: (center.x + ox) * k - ox, y: (center.y + oy) * k - oy };
    zoom = next;
  }

  canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    // In canvas pixels: the backing store need not match the CSS box.
    const rect = canvas.getBoundingClientRect();
    zoomAt(zoom + (e.deltaY < 0 ? 1 : -1), (e.clientX - rect.left) * canvas.width / rect.width, (e.clientY - rect.top) * canvas.height / rect.height);
    render();
  }, { passive: false });

  async function panBy(dx: number, dy: number): Promise<void> {
    center.x -= dx;
    center.y -= dy;
    await render();
  }

  async function zoomBy(delta: number): Promise<void> {
    zoomAt(zoom + delta, canvas.width / 2, canvas.height / 2);
    await render();
  }

  function readPixel(x: number, y: number): Uint8ClampedArray {
    const rx = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
    const ry = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
    // Through a copy: once read back, Chromium would draw the canvas on the CPU.
    const scratch = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
    scratch.drawImage(canvas, rx, ry, 1, 1, 0, 0, 1, 1);
    return scratch.getImageData(0, 0, 1, 1).data;
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

  function viewKeys(): string[] {
    const w = canvas.width, h = canvas.height, max = 2 ** zoom;
    const left = center.x - w / 2, top = center.y - h / 2;
    const keys: string[] = [];
    for (let y = Math.max(0, Math.floor(top / SIZE)); y <= Math.min(max - 1, Math.floor((top + h) / SIZE)); y++) {
      for (let x = Math.max(0, Math.floor(left / SIZE)); x <= Math.min(max - 1, Math.floor((left + w) / SIZE)); x++) keys.push(`${zoom}/${x}/${y}`);
    }
    return keys;
  }

  async function waitForView(timeoutMs = 6000): Promise<boolean> {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (viewKeys().every((k) => images.has(k))) return true;
      await render();
      await new Promise((r) => setTimeout(r, 50));
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
    get activeLandmark() {
      return activeLandmark;
    },
    get bookmarked() {
      return bookmarked;
    },
    htmlInCanvas,
    popup,
    popupButton: popupBtn,
    render,
    panBy,
    zoomBy,
    getAnchorPos,
    getPopupRect,
    getButtonRect,
    readPixel,
    waitForTile,
    waitForView,
    hasAerialTiles,
  };
}
