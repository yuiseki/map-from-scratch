import { emit } from '../../../../harness/page/bench.ts';
import type { AirportMap } from './renderer.ts';

function hasAirportInk(map: AirportMap, lon: number, lat: number): boolean {
  const [x, y] = map.projectedLonLat(lon, lat);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const centerX = Math.round(x * dpr), centerY = Math.round(y * dpr), radius = Math.round(7 * dpr);
  const left = Math.max(0, centerX - radius), top = Math.max(0, centerY - radius);
  const width = Math.min(map.canvas.width - left, radius * 2 + 1), height = Math.min(map.canvas.height - top, radius * 2 + 1);
  const pixels = map.context.getImageData(left, top, width, height).data;
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i]!, green = pixels[i + 1]!, blue = pixels[i + 2]!;
    if (red > 160 && red > green * 1.15 && green > 65 && blue < 145) return true;
  }
  return false;
}

export async function run(map: AirportMap) {
  const { stats, records } = map;
  emit({ metric: 'airport_count', value: records.length });
  emit({ metric: 'scheduled_service_count', value: stats.scheduledServiceAirports });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ info: {
    renderer: 'TypeScript + Canvas 2D custom Equal Earth renderer', gpu: 'Canvas 2D CPU rasterizer',
    source: stats.source, airports: records.length, scheduled_service: stats.scheduledServiceAirports,
    excluded_closed_or_unlocated: stats.excludedClosedOrUnlocated, airport_bytes: map.airportBytes,
    land_rings: stats.landRings, land_vertices: stats.landVertices,
  } });
  const allTypes = new Set(records.map((record) => record.kind));
  emit({ check: 'active-airports', pass: records.length >= 50_000 && records.length + stats.excludedClosedOrUnlocated === stats.sourceAirportRows,
    detail: `${records.length} mapped active, located facilities from ${stats.sourceAirportRows} source records` });
  emit({ check: 'type-and-service-classes', pass: allTypes.size === 6 && stats.scheduledServiceAirports > 0,
    detail: `${allTypes.size} facility classes and ${stats.scheduledServiceAirports} scheduled-service sites` });
  const canvasText = document.body.innerText;
  const links = [...document.querySelectorAll('a')].map((anchor) => anchor.href);
  emit({ check: 'source-and-ai-disclosure', pass: canvasText.includes('2026-08-31') && canvasText.includes('AI コードエージェント')
    && canvasText.includes('プロンプト') && links.includes('https://ourairports.com/data/')
    && links.includes('https://www.naturalearthdata.com/'), detail: 'snapshot, sources, AI authorship and the production prompt are disclosed' });
  const knownSites = [
    { name: 'Los Angeles', lon: -118.4081, lat: 33.9425 },
    { name: 'Tokyo Haneda', lon: 139.7798, lat: 35.5494 },
  ];
  const visible = knownSites.map((site) => `${site.name}:${hasAirportInk(map, site.lon, site.lat)}`);
  emit({ check: 'known-airport-geography', pass: knownSites.every((site) => hasAirportInk(map, site.lon, site.lat)), detail: visible.join(', ') });
  const original = { ...map.view }, frames: number[] = [], drawCpu: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 80; i++) {
    map.view.zoom = 1 + 1.2 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 79));
    map.view.panX = Math.sin(i / 17) * 35;
    map.view.panY = Math.cos(i / 19) * 20;
    const started = performance.now();
    map.draw(); drawCpu.push(performance.now() - started);
    await new Promise(requestAnimationFrame); frames.push(performance.now() - started);
  }
  Object.assign(map.view, original); map.draw();
  emit({ metric: 'draw_cpu_ms', values: drawCpu });
  emit({ metric: 'frame_ms', values: frames });
  emit({ done: true });
}
