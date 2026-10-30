// HTML-in-Canvas Map Renderer with Rich Native HTML Popup
//
// Uses WICG HTML-in-Canvas API (CanvasRenderingContext2D.prototype.drawElementImage)
// to render a live HTML element subtree directly onto Canvas 2D pixels.

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

  // Map projection & state (Tokyo central coordinates)
  let centerLon = 139.755;
  let centerLat = 35.680;
  let zoom = 13.0; // scale factor

  function project(lon: number, lat: number): { x: number; y: number } {
    const kx = Math.cos((centerLat * Math.PI) / 180) * 111320;
    const ky = 110574;
    const dx = (lon - centerLon) * kx;
    const dy = (lat - centerLat) * ky;

    const scale = (Math.pow(2, zoom) * 256) / 40075016;
    const x = canvas.width / 2 + dx * scale;
    const y = canvas.height / 2 - dy * scale;
    return { x, y };
  }

  function unproject(px: number, py: number): { lon: number; lat: number } {
    const scale = (Math.pow(2, zoom) * 256) / 40075016;
    const dx = (px - canvas.width / 2) / scale;
    const dy = (canvas.height / 2 - py) / scale;
    const kx = Math.cos((centerLat * Math.PI) / 180) * 111320;
    const ky = 110574;
    return {
      lon: centerLon + dx / kx,
      lat: centerLat + dy / ky,
    };
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

    // 1. Draw stylized dark Tokyo basemap
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Decorative grid lines & bay outline
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Connect landmarks with route guide lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    landmarks.forEach((l, idx) => {
      const pt = project(l.lon, l.lat);
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();

    // 2. Draw Landmark Pin Markers
    for (const lm of landmarks) {
      const pt = project(lm.lon, lm.lat);
      const isActive = lm.id === activeLandmark.id;

      // Glow
      ctx.fillStyle = isActive ? 'rgba(56, 189, 248, 0.35)' : 'rgba(148, 163, 184, 0.2)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isActive ? 16 : 10, 0, Math.PI * 2);
      ctx.fill();

      // Pin center
      ctx.fillStyle = isActive ? '#38bdf8' : '#94a3b8';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isActive ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();

      // Label below marker
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lm.name, pt.x, pt.y + 18);
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
      // Fallback for non-supporting environments (e.g. standard Canvas 2D fallback)
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

  async function panBy(dx: number, dy: number): Promise<void> {
    const kx = Math.cos((centerLat * Math.PI) / 180) * 111320;
    const ky = 110574;
    const scale = (Math.pow(2, zoom) * 256) / 40075016;

    centerLon -= dx / (scale * kx);
    centerLat += dy / (scale * ky);
    await render();
  }

  async function zoomBy(delta: number): Promise<void> {
    zoom = Math.max(10, Math.min(18, zoom + delta));
    await render();
  }

  async function clickButton(): Promise<boolean> {
    return await toggleBookmark();
  }

  function readPixel(x: number, y: number): Uint8ClampedArray {
    return ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  }

  // Pointer interactions on canvas
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let dragDistance = 0;

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    dragDistance = 0;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', async (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragDistance += Math.hypot(dx, dy);
    await panBy(dx, dy);
  });

  canvas.addEventListener('pointerup', async (e) => {
    isDragging = false;
    if (dragDistance < 4) {
      // Click event
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Check if button clicked inside popup
      const bRect = getButtonRect();
      if (
        clickX >= bRect.x &&
        clickX <= bRect.x + bRect.width &&
        clickY >= bRect.y &&
        clickY <= bRect.y + bRect.height
      ) {
        await clickButton();
        return;
      }

      // Check if clicked any landmark marker
      for (const lm of landmarks) {
        const pt = project(lm.lon, lm.lat);
        if (Math.hypot(clickX - pt.x, clickY - pt.y) < 18) {
          activeLandmark = lm;
          bookmarked = false;
          await render();
          return;
        }
      }
    }
  });

  canvas.addEventListener('wheel', async (e) => {
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.2;
    await zoomBy(delta);
  }, { passive: false });

  await render();

  return {
    canvas,
    landmarks,
    get activeLandmark() { return activeLandmark; },
    get bookmarked() { return bookmarked; },
    hasDrawElementImage,
    render,
    panBy,
    zoomBy,
    getAnchorPos,
    getPopupRect,
    getButtonRect,
    clickButton,
    readPixel,
  };
}
