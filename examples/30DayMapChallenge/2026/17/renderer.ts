import {
  directionalNeighbor,
  localProjection,
  meshAtScreenPoint,
  populationIntensity,
  validatePresenceMap,
  type PresenceMap,
  type PresenceMesh,
  type ScreenPoint,
} from './lightdark.ts';

interface Panel { id: 'day' | 'night'; x: number; y: number; width: number; height: number; map: { x: number; y: number; width: number; height: number } }
type Period = 'daytime' | 'lateNight';
const COLORS = {
  ink: '#10151c', paper: '#f1eee4', border: '#d6d1c5', text: '#334047', muted: '#68757a',
  dayLow: [255, 225, 130] as const, dayHigh: [231, 76, 36] as const,
  nightLow: [36, 78, 112] as const, nightHigh: [235, 225, 138] as const,
};

export type PresenceRenderer = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const started = performance.now();
  const [mapResponse, statsResponse] = await Promise.all([fetch(`${base}/presence.json`), fetch(`${base}/stats.json`)]);
  if (!mapResponse.ok || !statsResponse.ok) throw new Error('Day 17 baked presence data is missing');
  const [data, stats] = await Promise.all([mapResponse.json() as Promise<PresenceMap>, statsResponse.json()]);
  validatePresenceMap(data);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  let width = 0, height = 0, dpr = 1, firstFrameMs = 0, selectedId: string | null = null;
  let panels: Panel[] = [];

  function layout(): Panel[] {
    const margin = width < 760 ? 18 : 28, gap = width < 760 ? 14 : 20;
    const headerBottom = width < 760 ? 100 : 112;
    const footerHeight = document.querySelector('footer')?.getBoundingClientRect().height ?? 0;
    const bottomClearance = footerHeight + 18;
    if (width < 760) {
      const panelHeight = Math.max(250, (height - headerBottom - margin * 2 - gap - bottomClearance) / 2);
      const panelWidth = width - margin * 2;
      return (['day', 'night'] as const).map((id, index) => {
        const x = margin, y = headerBottom + index * (panelHeight + gap);
        return { id, x, y, width: panelWidth, height: panelHeight, map: { x: x + 16, y: y + 60, width: panelWidth - 32, height: panelHeight - 116 } };
      });
    }
    const panelWidth = (width - margin * 2 - gap) / 2;
    const panelHeight = Math.max(300, height - headerBottom - margin - bottomClearance);
    return (['day', 'night'] as const).map((id, index) => {
      const x = margin + index * (panelWidth + gap), y = headerBottom;
      return { id, x, y, width: panelWidth, height: panelHeight, map: { x: x + 18, y: y + 62, width: panelWidth - 36, height: panelHeight - 120 } };
    });
  }

  function getPeriod(id: Panel['id']): Period { return id === 'day' ? 'daytime' : 'lateNight'; }
  function color(value: number | null, period: Period): string {
    if (value === null) return period === 'daytime' ? '#d1d0c9' : '#182530';
    const intensity = populationIntensity(value, data.maximum) ?? 0;
    const from = period === 'daytime' ? COLORS.dayLow : COLORS.nightLow;
    const to = period === 'daytime' ? COLORS.dayHigh : COLORS.nightHigh;
    const t = intensity ** 0.9;
    return `rgb(${from.map((component, i) => Math.round(component + (to[i]! - component) * t)).join(',')})`;
  }
  function drawLegend(panel: Panel, period: Period) {
    const y = panel.y + panel.height - 32, x = panel.x + 18, barWidth = Math.min(232, panel.width - 90);
    const stops = Array.from({ length: 30 }, (_, i) => i / 29);
    const gradient = ctx!.createLinearGradient(x, 0, x + barWidth, 0);
    for (const t of stops) {
      const estimate = Math.expm1(Math.log1p(10) + t * (Math.log1p(data.maximum) - Math.log1p(10)));
      gradient.addColorStop(t, color(estimate, period));
    }
    ctx!.fillStyle = gradient; ctx!.fillRect(x, y, barWidth, 9);
    ctx!.font = '9px ui-monospace, monospace'; ctx!.textBaseline = 'top';
    ctx!.fillStyle = period === 'daytime' ? COLORS.muted : '#a8bdc9'; ctx!.textAlign = 'left'; ctx!.fillText('10', x, y + 12);
    ctx!.textAlign = 'center'; ctx!.fillText('1,000', x + barWidth * populationIntensity(1000, data.maximum)!, y + 12);
    ctx!.fillText('10,000', x + barWidth * populationIntensity(10_000, data.maximum)!, y + 12);
    ctx!.textAlign = 'right'; ctx!.fillText(data.maximum.toLocaleString('ja-JP'), x + barWidth, y + 12);
    ctx!.textAlign = 'left';
    ctx!.fillStyle = period === 'daytime' ? COLORS.muted : '#94a8b2';
    ctx!.font = '9px system-ui'; ctx!.fillText('公表値なし', x + barWidth + 12, y + 1);
    ctx!.fillStyle = period === 'daytime' ? '#d1d0c9' : '#182530'; ctx!.fillRect(x + barWidth + 1, y, 8, 8);
  }
  function drawPanel(panel: Panel) {
    const night = panel.id === 'night', period = getPeriod(panel.id);
    ctx!.save();
    ctx!.fillStyle = night ? '#0a121a' : '#fffdf6'; ctx!.strokeStyle = night ? '#314552' : COLORS.border;
    ctx!.lineWidth = 1; ctx!.beginPath(); ctx!.roundRect(panel.x, panel.y, panel.width, panel.height, 12); ctx!.fill(); ctx!.stroke();
    ctx!.fillStyle = night ? '#ecf0db' : COLORS.text; ctx!.font = '600 22px system-ui'; ctx!.textAlign = 'left'; ctx!.textBaseline = 'alphabetic';
    ctx!.fillText(night ? '深夜' : '昼間', panel.x + 18, panel.y + 31);
    ctx!.fillStyle = night ? '#96aab7' : COLORS.muted; ctx!.font = '11px ui-monospace, monospace';
    ctx!.fillText(night ? '01:00–04:00 · TIMEZONE 1' : '11:00–14:00 · TIMEZONE 0', panel.x + 82, panel.y + 30);
    ctx!.textAlign = 'right'; ctx!.fillText(`${data.meshes.filter((mesh) => mesh[period] !== null).length.toLocaleString('ja-JP')} 公表メッシュ`, panel.x + panel.width - 18, panel.y + 29);
    ctx!.fillStyle = night ? '#09131d' : '#e7e3d8'; ctx!.fillRect(panel.map.x, panel.map.y, panel.map.width, panel.map.height);
    ctx!.save(); ctx!.beginPath(); ctx!.rect(panel.map.x, panel.map.y, panel.map.width, panel.map.height); ctx!.clip();
    // Equal ground-distance projection keeps 1 km mesh shapes honest at Tokyo's latitude.
    const project = localProjection(data.bounds, panel.map.x, panel.map.y, panel.map.width, panel.map.height);
    const cellPaths: { mesh: PresenceMesh; x: number; y: number; width: number; height: number }[] = [];
    for (const mesh of data.meshes) {
      const northwest = project(mesh.west, mesh.north), southeast = project(mesh.east, mesh.south);
      const x = Math.round(northwest.x), y = Math.round(northwest.y), right = Math.round(southeast.x), bottom = Math.round(southeast.y);
      if (right <= x || bottom <= y) continue;
      cellPaths.push({ mesh, x, y, width: right - x, height: bottom - y });
      ctx!.fillStyle = color(mesh[period], period); ctx!.fillRect(x, y, right - x + 0.15, bottom - y + 0.15);
      if (mesh[period] === null) {
        ctx!.strokeStyle = night ? '#3b4c57' : '#b3b2aa'; ctx!.lineWidth = 0.55;
        ctx!.beginPath(); ctx!.moveTo(x + 2, bottom - 2); ctx!.lineTo(right - 2, y + 2); ctx!.stroke();
      }
      if (mesh.id === selectedId) {
        ctx!.strokeStyle = night ? '#fbf4b4' : '#181e22'; ctx!.lineWidth = 2; ctx!.strokeRect(x + 1, y + 1, right - x - 2, bottom - y - 2);
      }
    }
    // Place names orient the mesh field without an external basemap.
    const labels = [
      { name: '新宿', lon: 139.70, lat: 35.69 }, { name: '渋谷', lon: 139.70, lat: 35.66 },
      { name: '東京', lon: 139.77, lat: 35.68 }, { name: '品川', lon: 139.74, lat: 35.63 },
      { name: '池袋', lon: 139.71, lat: 35.73 }, { name: '羽田', lon: 139.78, lat: 35.55 },
    ];
    ctx!.font = '10px system-ui'; ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle';
    for (const label of labels) {
      const point = project(label.lon, label.lat); ctx!.fillStyle = night ? '#e4e5d6dd' : '#333c40dd';
      ctx!.fillText(label.name, point.x, point.y);
    }
    ctx!.restore();
    ctx!.strokeStyle = night ? '#324652' : '#bdb7a9'; ctx!.lineWidth = 1; ctx!.strokeRect(panel.map.x, panel.map.y, panel.map.width, panel.map.height);
    const selected = data.meshes.find((mesh) => mesh.id === selectedId);
    ctx!.fillStyle = night ? '#b6c3c7' : '#59676b'; ctx!.font = '10px ui-monospace, monospace'; ctx!.textAlign = 'left';
    const countText = !selected ? 'メッシュを選択'
      : selected[period] === null ? '未公表 / 値なし' : `${selected[period]!.toLocaleString('ja-JP')} 人`;
    ctx!.fillText(selected ? `メッシュ ${selected.id}  ·  ${countText}` : countText, panel.x + 18, panel.y + panel.height - 49);
    drawLegend(panel, period);
    ctx!.restore();
  }
  function draw() {
    if (!width || !height) return;
    panels = layout();
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0); ctx!.fillStyle = COLORS.paper; ctx!.fillRect(0, 0, width, height);
    ctx!.fillStyle = COLORS.ink; ctx!.font = '600 11px ui-monospace, monospace'; ctx!.textAlign = 'left'; ctx!.fillText('30DAYMAPCHALLENGE 2026  /  17 · LIGHT & DARK', 30, 28);
    ctx!.font = '600 25px system-ui'; ctx!.fillText('昼と深夜、東京の滞在人口', 30, 60);
    ctx!.fillStyle = '#58656b'; ctx!.font = '12px system-ui';
    ctx!.fillText('照明画像ではなく、同じ1 kmメッシュで比べる月平均の人流推計。色尺度は昼夜で共通。', 30, 84);
    ctx!.fillStyle = '#747e80'; ctx!.font = '10px ui-monospace, monospace'; ctx!.textAlign = 'right';
    ctx!.fillText('TOKYO · 2021.12 · ALL DAYS', width - 28, 29);
    for (const panel of panels) drawPanel(panel);
    if (!firstFrameMs) firstFrameMs = performance.now() - started;
  }
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1); width = canvas.clientWidth; height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); draw();
  }
  function select(mesh: PresenceMesh | null) {
    selectedId = mesh?.id ?? null;
    canvas.dispatchEvent(new CustomEvent('presence-select', { detail: { id: selectedId, mesh } }));
    draw();
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  canvas.addEventListener('pointerdown', (event) => { if (event.isTrusted) canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', (event) => {
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const panel = panels.find((candidate) => x >= candidate.map.x && x <= candidate.map.x + candidate.map.width && y >= candidate.map.y && y <= candidate.map.y + candidate.map.height);
    if (!panel) return;
    const project = localProjection(data.bounds, panel.map.x, panel.map.y, panel.map.width, panel.map.height);
    select(meshAtScreenPoint(data, project, x, y));
  });
  canvas.addEventListener('keydown', (event) => {
    const direction: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (event.key in direction) { event.preventDefault(); select(directionalNeighbor(data, selectedId ?? '', direction[event.key]!)); }
    else if (event.key === 'Escape') { event.preventDefault(); select(null); }
  });
  resize();
  const centerFor = (id: string, panelId: Panel['id']): ScreenPoint | null => {
    const panel = panels.find((candidate) => candidate.id === panelId), mesh = data.meshes.find((candidate) => candidate.id === id);
    if (!panel || !mesh) return null;
    return localProjection(data.bounds, panel.map.x, panel.map.y, panel.map.width, panel.map.height)((mesh.west + mesh.east) / 2, (mesh.south + mesh.north) / 2);
  };
  return {
    data, stats, canvas, draw, panels, centerFor, select,
    get firstFrameMs() { return firstFrameMs; },
    get view() { return { selectedId }; },
    panelRect(id: Panel['id']) { return panels.find((panel) => panel.id === id) ?? null; },
  };
}
