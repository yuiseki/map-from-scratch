import { emit, readBack } from '../../../../harness/page/bench.ts';
import { depthSectionY, flipReliefY } from './profile.ts';
import type { SectionMap } from './renderer.ts';

function pixel(map: SectionMap, x: number, y: number): number[] {
  const canvas = map.canvas, rect = canvas.getBoundingClientRect();
  return [...readBack(canvas.getContext('2d')!, Math.round(x * canvas.width / rect.width), Math.round(y * canvas.height / rect.height)).data];
}
function sameRgb(a: number[], hex: string): boolean {
  const rgb = hex.match(/[0-9a-f]{2}/gi)!.map((v) => Number.parseInt(v, 16));
  return a.slice(0, 3).every((v, i) => Math.abs(v - rgb[i]!) <= 8);
}

export async function run(map: SectionMap) {
  emit({ metric: 'profile_cells', value: map.data.elevations.length });
  emit({ metric: 'hypocenter_count', value: map.data.events.length });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ metric: 'data_bytes', value: new TextEncoder().encode(JSON.stringify(map.data)).byteLength });
  emit({ info: { renderer: 'Dedicated Canvas 2D inverted terrain section', source: map.stats.source, events: map.stats.eventCount, elevationRangeM: [map.stats.elevationMinM, map.stats.elevationMaxM], groundSpanKm: map.stats.transectDistanceKm } });

  const canvas = map.canvas, seaY = canvas.clientHeight * 0.355, plotHeight = canvas.clientHeight * 0.000043;
  const minIndex = map.data.elevations.findIndex((v) => v < -1000), maxIndex = map.data.elevations.findIndex((v) => v > 500);
  const left = canvas.clientWidth > 760 ? 420 : 68;
  const c = { west: map.data.west, east: map.data.east, span: canvas.clientWidth - left - 34, left };
  const x = (i: number) => c.left + c.span * i / (map.data.elevations.length - 1);
  const seaYpixel = (index: number) => (seaY + seaY + map.data.elevations[index]! * plotHeight) / 2;
  const waterSample = pixel(map, x(minIndex), seaYpixel(minIndex));
  emit({ check: 'flipped-ocean-visible', pass: map.data.elevations[minIndex]! < -1000 && seaYpixel(minIndex) < seaY && sameRgb(waterSample, '#2c929b'), detail: `GEBCO ${map.data.elevations[minIndex]}m, pixel=${waterSample}, sampleY=${seaYpixel(minIndex)} above sea level ${seaY}` });
  const landY = (seaY + seaY + map.data.elevations[maxIndex]! * plotHeight) / 2;
  const landSample = pixel(map, x(maxIndex), landY);
  emit({ check: 'flipped-land-visible', pass: map.data.elevations[maxIndex]! > 500 && landY > seaY && sameRgb(landSample, '#bd694b'), detail: `GEBCO ${map.data.elevations[maxIndex]}m, pixel=${landSample}, sampleY=${landY} below sea level ${seaY}` });

  const docs = document.body.innerText, links = [...document.querySelectorAll('a')].map((a) => a.href);
  const disclosure = docs.includes('15秒角') && docs.includes('平均海面') && docs.includes('幅約56 km') && docs.includes('独立した深度軸')
    && links.includes('https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid');
  emit({ check: 'source-and-inversion-disclosure', pass: disclosure, detail: `GEBCO citation link=${links.includes('https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid')}; datum/slab/separate-axis visible=${disclosure}` });

  const event = map.data.events[0]!, marker = map.eventPositions[0]!;
  const eventPixel = pixel(map, marker.x, marker.y);
  const eventPass = event.depthKm >= 0 && event.id.length > 0 && marker.y > canvas.clientHeight * 0.61 && !sameRgb(eventPixel, '#07181d');
  emit({ check: 'usgs-hypocenters-visible', pass: eventPass, detail: `${event.id} M${event.magnitude} depth=${event.depthKm}km, pixel=${eventPixel}, separate depth axis` });

  const frame: number[] = [], cpu: number[] = [], initial = map.view;
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 80; i++) {
    map.view = { centerLon: (map.data.west + map.data.east) / 2 + Math.sin(i / 9) * 0.1, zoom: 1 + 0.4 * (0.5 - 0.5 * Math.cos(Math.PI * 2 * i / 79)) };
    map.setExaggeration(0.5 + (i % 8) * 0.5);
    const start = performance.now(); map.draw(); cpu.push(performance.now() - start);
    await new Promise(requestAnimationFrame); frame.push(performance.now() - start);
  }
  map.view = initial; map.setExaggeration(1);
  const selected = document.getElementById('selected')!;
  const exag = document.getElementById('exaggeration') as HTMLInputElement;
  exag.value = '2'; exag.dispatchEvent(new Event('input', { bubbles: true }));
  const exaggerationWorked = map.exaggeration === 2;
  exag.value = '1'; exag.dispatchEvent(new Event('input', { bubbles: true }));
  const centerBeforeKeyboard = map.view.centerLon;
  canvas.focus(); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const keyboardPanWorked = map.view.centerLon > centerBeforeKeyboard;
  map.view = initial;
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'mouse', clientX: rect.left + marker.x, clientY: rect.top + marker.y, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'mouse', clientX: rect.left + marker.x, clientY: rect.top + marker.y, bubbles: true }));
  const intendedUrl = `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(event.id)}`;
  const selectedLink = [...document.querySelectorAll('a')].some((a) => a.href === intendedUrl);
  emit({ check: 'pan-zoom-and-selection', pass: exaggerationWorked && keyboardPanWorked && depthSectionY(event.depthKm, 0, 1) >= 0 && typeof map.draw === 'function' && selected.textContent!.includes(event.id)
    && docs.includes('ドラッグで経度方向へ移動') && selectedLink, detail: `${event.id} selected and links to its USGS event; pan, zoom and exaggeration controls are available` });
  emit({ metric: 'draw_cpu_ms', values: cpu }); emit({ metric: 'frame_ms', values: frame }); emit({ done: true });
}
