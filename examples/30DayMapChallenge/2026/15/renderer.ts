import { depthSectionY, flipReliefY, sectionDistanceKm, validateProfile, type ProfileData } from './profile.ts';

const SEA = '#5fced0', LAND = '#ef9f69', INK = '#07181d', GRID = '#24454d', TEXT = '#c0d4ce';
export type SectionMap = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const started = performance.now();
  const [profileResponse, statsResponse] = await Promise.all([fetch(`${base}/profile.json`), fetch(`${base}/stats.json`)]);
  if (!profileResponse.ok || !statsResponse.ok) throw new Error('Day 15 baked section is missing');
  const [data, stats] = await Promise.all([profileResponse.json() as Promise<ProfileData>, statsResponse.json()]);
  validateProfile(data);
  if (data.elevations.length !== 720) throw new Error('Unexpected GEBCO section length');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  let width = 0, height = 0, dpr = 1, centerLon = (data.west + data.east) / 2, zoom = 1, exaggeration = 1;
  let dragX: number | null = null, pointerOrigin: [number, number] | null = null, selected = -1, firstFrameMs = 0;
  const eventPositions: { x: number; y: number; radius: number }[] = [];

  function chart() { const left = width > 760 ? 420 : 68; const right = width - 34; return { left, right, span: right - left }; }
  function xForLon(lon: number) { const c = chart(); return (c.left + c.right) / 2 + (lon - centerLon) / (data.east - data.west) * c.span * zoom; }
  function yForElevation(elevation: number) { return flipReliefY(elevation, height * 0.355, height * 0.000043 * exaggeration); }
  function draw() {
    if (!width || !height) return;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0); ctx!.fillStyle = INK; ctx!.fillRect(0, 0, width, height);
    const c = chart(), seaY = height * 0.355, panelTop = height * 0.61, depthScale = Math.max(0.12, (height - panelTop - 125) / 700);
    ctx!.save(); ctx!.beginPath(); ctx!.rect(c.left, 34, c.span, height - 65); ctx!.clip();
    // Longitude grid is shared by the inverted terrain ribbon and hypocenter panel.
    const step = zoom > 2 ? 0.25 : zoom > 1.2 ? 0.5 : 1;
    const firstTick = Math.ceil((centerLon - (data.east - data.west) / (2 * zoom)) / step) * step;
    for (let lon = firstTick; lon <= centerLon + (data.east - data.west) / (2 * zoom); lon += step) {
      const x = xForLon(lon); ctx!.strokeStyle = GRID; ctx!.lineWidth = 1; ctx!.beginPath(); ctx!.moveTo(x, 38); ctx!.lineTo(x, height - 32); ctx!.stroke();
      ctx!.fillStyle = TEXT; ctx!.font = '11px ui-monospace, monospace'; ctx!.textAlign = 'center'; ctx!.fillText(`${lon.toFixed(step < 0.5 ? 2 : 1)}°E`, x, 29);
    }
    ctx!.strokeStyle = '#d2e3dc'; ctx!.setLineDash([5, 5]); ctx!.beginPath(); ctx!.moveTo(c.left, seaY); ctx!.lineTo(c.right, seaY); ctx!.stroke(); ctx!.setLineDash([]);
    const water = new Path2D(), land = new Path2D(), line = new Path2D();
    for (let i = 0; i < data.elevations.length - 1; i++) {
      const x1 = xForLon(data.west + (data.east - data.west) * i / (data.elevations.length - 1));
      const x2 = xForLon(data.west + (data.east - data.west) * (i + 1) / (data.elevations.length - 1));
      const e1 = data.elevations[i]!, e2 = data.elevations[i + 1]!, y1 = yForElevation(e1), y2 = yForElevation(e2);
      const path = e1 < 0 && e2 < 0 ? water : e1 >= 0 && e2 >= 0 ? land : null;
      if (path) { path.moveTo(x1, seaY); path.lineTo(x1, y1); path.lineTo(x2, y2); path.lineTo(x2, seaY); path.closePath(); }
      else {
        const crossing = x1 + (x2 - x1) * Math.abs(e1) / (Math.abs(e1) + Math.abs(e2));
        const waterPath = e1 < 0 ? water : land, landPath = e1 < 0 ? land : water;
        waterPath.moveTo(x1, seaY); waterPath.lineTo(x1, y1); waterPath.lineTo(crossing, seaY); waterPath.closePath();
        landPath.moveTo(crossing, seaY); landPath.lineTo(x2, y2); landPath.lineTo(x2, seaY); landPath.closePath();
      }
      line.moveTo(x1, y1); line.lineTo(x2, y2);
    }
    ctx!.fillStyle = '#2c929b'; ctx!.fill(water); ctx!.fillStyle = '#bd694b'; ctx!.fill(land);
    ctx!.strokeStyle = '#f3d3a4'; ctx!.lineWidth = 1.6; ctx!.stroke(line);
    ctx!.fillStyle = TEXT; ctx!.font = '11px system-ui'; ctx!.textAlign = 'left'; ctx!.fillText('0 m · mean sea level', c.left + 6, seaY - 7);
    ctx!.fillStyle = SEA; ctx!.textAlign = 'left'; ctx!.fillText('SEA FLOOR / FLIPPED UP', c.left + 5, 49);
    ctx!.fillStyle = LAND; ctx!.fillText('LAND / FLIPPED DOWN', c.left + 5, seaY + 78);
    ctx!.strokeStyle = '#45636a'; ctx!.beginPath(); ctx!.moveTo(c.left, panelTop); ctx!.lineTo(c.right, panelTop); ctx!.stroke();
    ctx!.fillStyle = '#f2d3a4'; ctx!.font = '10px system-ui'; ctx!.textAlign = 'left'; ctx!.fillText('USGS HYPOCENTERS · CATALOG DEPTH (km)', c.left + 5, panelTop + 17);
    for (const km of [0, 100, 300, 600]) {
      const y = depthSectionY(km, panelTop + 25, depthScale); ctx!.strokeStyle = GRID; ctx!.beginPath(); ctx!.moveTo(c.left, y); ctx!.lineTo(c.right, y); ctx!.stroke();
      ctx!.fillStyle = TEXT; ctx!.textAlign = 'left'; ctx!.font = '10px ui-monospace, monospace'; ctx!.fillText(`${km} km`, c.left + 28, y + 12);
    }
    eventPositions.length = 0;
    data.events.forEach((event, i) => {
      const x = xForLon(event.lon), y = depthSectionY(event.depthKm, panelTop + 25, depthScale), radius = 2.6 + Math.max(0, event.magnitude - 4.5) * 1.25;
      eventPositions.push({ x, y, radius }); ctx!.beginPath(); ctx!.arc(x, y, radius + (selected === i ? 2 : 0), 0, Math.PI * 2);
      ctx!.fillStyle = event.depthKm < 70 ? '#f4cf7a' : event.depthKm < 300 ? '#f28b55' : '#df5d80'; ctx!.fill();
      if (selected === i) { ctx!.strokeStyle = '#fff'; ctx!.lineWidth = 1.5; ctx!.stroke(); }
    });
    ctx!.restore();
    // Scale ruler follows the local east-west ground distance at the transect latitude.
    const km = 50, px = km / sectionDistanceKm(data.west, data.east, data.latitude) * c.span * zoom;
    ctx!.strokeStyle = '#e9eee4'; ctx!.lineWidth = 2; ctx!.beginPath(); ctx!.moveTo(c.left + 10, height - 60); ctx!.lineTo(c.left + 10 + px, height - 60); ctx!.stroke();
    ctx!.fillStyle = TEXT; ctx!.font = '10px ui-monospace, monospace'; ctx!.textAlign = 'left'; ctx!.fillText(`${km} km ground distance`, c.left + 10, height - 67);
    if (!firstFrameMs) firstFrameMs = performance.now() - started;
  }
  function resize() { dpr = Math.min(2, devicePixelRatio || 1); width = canvas.clientWidth; height = canvas.clientHeight; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); draw(); }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  function selectEvent(index: number) { selected = index; canvas.dispatchEvent(new CustomEvent('hypocenter-select', { detail: { index } })); draw(); }
  canvas.addEventListener('pointerdown', (event) => { dragX = event.clientX; pointerOrigin = [event.clientX, event.clientY]; if (event.isTrusted) canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => { if (dragX === null) return; const dx = event.clientX - dragX; centerLon -= dx / chart().span * (data.east - data.west) / zoom; dragX = event.clientX; draw(); });
  canvas.addEventListener('pointerup', (event) => {
    if (pointerOrigin && Math.hypot(event.clientX - pointerOrigin[0], event.clientY - pointerOrigin[1]) < 4) {
      const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      const index = eventPositions.findIndex((p) => Math.hypot(p.x - x, p.y - y) <= p.radius + 5);
      selectEvent(index);
    }
    dragX = null; pointerOrigin = null;
  });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); zoom = Math.max(0.7, Math.min(8, zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15))); draw(); }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { centerLon += (event.key === 'ArrowRight' ? 1 : -1) * (data.east - data.west) * 0.04 / zoom; draw(); }
    else if (event.key === '+' || event.key === '=') { zoom = Math.min(8, zoom * 1.2); draw(); }
    else if (event.key === '-') { zoom = Math.max(0.7, zoom / 1.2); draw(); }
  });
  resize();
  return { data, stats, draw, canvas, eventPositions, selectEvent, get firstFrameMs() { return firstFrameMs; }, get exaggeration() { return exaggeration; }, setExaggeration(value: number) { exaggeration = Math.max(0.5, Math.min(8, value)); draw(); }, get view() { return { centerLon, zoom }; }, set view(value: { centerLon: number; zoom: number }) { centerLon = value.centerLon; zoom = value.zoom; draw(); } };
}
