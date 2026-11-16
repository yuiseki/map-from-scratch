import {
  fitNetworkCamera,
  hitNetworkStop,
  projectJgd2011,
  projectNetworkPoint,
  TOKYO_NETWORK_BOUNDS,
  type BusStop,
  type NetworkCamera,
  type NetworkData,
  type ScreenStop,
} from './network.ts';

export const TOKYO_FOCUS = TOKYO_NETWORK_BOUNDS;

export interface NetworkRenderer {
  draw(): void;
  resize(): void;
  pan(dx: number, dy: number): void;
  zoomAt(screenX: number, screenY: number, factor: number): void;
  reset(): void;
  selectAt(screenX: number, screenY: number): BusStop | null;
  setSelected(stopId: string | null): void;
  setOperatorFilter(operator: string | null): void;
  operatorCounts(operator: string | null): { routes: number; stops: number; memberships: number };
  screenPoint(stopId: string): [number, number] | null;
}

export function createNetworkRenderer(
  canvas: HTMLCanvasElement,
  data: NetworkData,
  onSelect: (stop: BusStop | null) => void,
): NetworkRenderer {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const routeCoordinates = data.routes.map((route) => route.coordinates.map((part) => part.map(projectJgd2011)));
  const stopCoordinates = data.stops.map((stop) => projectJgd2011(stop.coordinates));
  const low = projectJgd2011([TOKYO_FOCUS.minX, TOKYO_FOCUS.minY]);
  const high = projectJgd2011([TOKYO_FOCUS.maxX, TOKYO_FOCUS.maxY]);
  const bounds = { minX: low[0], minY: low[1], maxX: high[0], maxY: high[1] };
  let camera: NetworkCamera = fitNetworkCamera(bounds, 100, 100, 0);
  let selectedId: string | null = null;
  let operatorFilter: string | null = null;
  let screenStops: ScreenStop[] = [];
  let screenStopById = new Map<string, ScreenStop>();

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    context!.fillStyle = '#101b29'; context!.fillRect(0, 0, width, height);
    camera = { ...camera, width, height };

    context!.save(); context!.beginPath(); context!.rect(0, 0, width, height); context!.clip(); context!.beginPath();
    context!.lineCap = 'round'; context!.lineJoin = 'round'; context!.lineWidth = 0.8;
    context!.strokeStyle = 'rgba(102, 190, 209, 0.30)';
    for (let routeIndex = 0; routeIndex < routeCoordinates.length; routeIndex++) {
      if (operatorFilter && data.routes[routeIndex]!.operator !== operatorFilter) continue;
      const parts = routeCoordinates[routeIndex]!;
      for (const coordinates of parts) {
        if (coordinates.length < 2) continue;
        const first = projectNetworkPoint(coordinates[0]!, camera); context!.moveTo(first[0], first[1]);
        for (let i = 1; i < coordinates.length; i++) {
          const p = projectNetworkPoint(coordinates[i]!, camera); context!.lineTo(p[0], p[1]);
        }
      }
    }
    context!.stroke();

    screenStops = [];
    screenStopById = new Map();
    for (let i = 0; i < data.stops.length; i++) {
      const stop = data.stops[i]!;
      if (operatorFilter && stop.operator !== operatorFilter) continue;
      const [screenX, screenY] = projectNetworkPoint(stopCoordinates[i]!, camera);
      if (screenX < -7 || screenY < -7 || screenX > width + 7 || screenY > height + 7) continue;
      const screenStop = { stop, screenX, screenY };
      screenStops.push(screenStop);
      screenStopById.set(stop.id, screenStop);
      const radius = stop.nRoutes >= 10 ? 4.4 : stop.nRoutes >= 4 ? 3.2 : stop.nRoutes >= 2 ? 2.4 : 1.6;
      context!.beginPath(); context!.arc(screenX, screenY, radius, 0, Math.PI * 2);
      context!.fillStyle = stop.id === selectedId ? '#fff2a8' : stop.nRoutes >= 4 ? '#f29f67' : '#e6f2f1';
      context!.fill();
      if (stop.id === selectedId) { context!.lineWidth = 1.5; context!.strokeStyle = '#392b1e'; context!.stroke(); }
    }
    context!.restore();
    const latitudeRadians = ((TOKYO_FOCUS.minY + TOKYO_FOCUS.maxY) / 2) * Math.PI / 180;
    const targetMeters = 100 * Math.cos(latitudeRadians) / camera.scale;
    const magnitude = 10 ** Math.floor(Math.log10(targetMeters));
    const normalized = targetMeters / magnitude;
    const scaleDistance = (normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10) * magnitude;
    const scalePixels = scaleDistance * camera.scale / Math.cos(latitudeRadians);
    const scaleX = width - 28 - scalePixels, scaleY = height - 58;
    context!.strokeStyle = '#f0f4ef'; context!.fillStyle = '#f0f4ef'; context!.lineWidth = 2;
    context!.beginPath(); context!.moveTo(scaleX, scaleY); context!.lineTo(scaleX + scalePixels, scaleY); context!.stroke();
    context!.beginPath(); context!.moveTo(scaleX, scaleY - 4); context!.lineTo(scaleX, scaleY + 4);
    context!.moveTo(scaleX + scalePixels, scaleY - 4); context!.lineTo(scaleX + scalePixels, scaleY + 4); context!.stroke();
    context!.font = '11px system-ui, sans-serif'; context!.textAlign = 'center';
    context!.fillText(scaleDistance >= 1_000 ? `約 ${scaleDistance / 1_000} km` : `約 ${Math.round(scaleDistance)} m`, scaleX + scalePixels / 2, scaleY - 8);
  };

  const resize = () => {
    const width = canvas.clientWidth || 1, height = canvas.clientHeight || 1;
    camera = { ...camera, width, height };
    draw();
  };
  const reset = () => {
    camera = fitNetworkCamera(bounds, canvas.clientWidth || 1, canvas.clientHeight || 1, 50);
    draw();
  };
  const pan = (dx: number, dy: number) => {
    camera = { ...camera, centerX: camera.centerX - dx / camera.scale, centerY: camera.centerY + dy / camera.scale };
    draw();
  };
  const zoomAt = (screenX: number, screenY: number, factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const nextScale = Math.max(0.4, Math.min(30_000, camera.scale * factor));
    const worldX = camera.centerX + (screenX - camera.width / 2) / camera.scale;
    const worldY = camera.centerY - (screenY - camera.height / 2) / camera.scale;
    camera = {
      ...camera,
      centerX: worldX - (screenX - camera.width / 2) / nextScale,
      centerY: worldY + (screenY - camera.height / 2) / nextScale,
      scale: nextScale,
    };
    draw();
  };
  const selectAt = (screenX: number, screenY: number) => {
    const hit = hitNetworkStop(screenX, screenY, screenStops, 9)?.stop ?? null;
    selectedId = hit?.id ?? null; onSelect(hit); draw(); return hit;
  };
  const setSelected = (stopId: string | null) => { selectedId = stopId; draw(); };
  const setOperatorFilter = (operator: string | null) => { operatorFilter = operator; draw(); };
  reset();
  const operatorCounts = (operator: string | null) => {
    const routes = operator ? data.routes.filter((route) => route.operator === operator) : data.routes;
    const stops = operator ? data.stops.filter((stop) => stop.operator === operator) : data.stops;
    return { routes: routes.length, stops: stops.length, memberships: stops.reduce((sum, stop) => sum + stop.routes.length, 0) };
  };
  const screenPoint = (stopId: string): [number, number] | null => {
    const point = screenStopById.get(stopId);
    return point ? [point.screenX, point.screenY] : null;
  };
  return { draw, resize, pan, zoomAt, reset, selectAt, setSelected, setOperatorFilter, operatorCounts, screenPoint };
}
