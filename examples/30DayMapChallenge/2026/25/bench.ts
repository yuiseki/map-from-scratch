import { emit, readBack } from '../../../../harness/page/bench.ts';
import type { QuakeRenderer } from './renderer.ts';

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pixelEvidence(canvas: HTMLCanvasElement, marksCanvas: HTMLCanvasElement) {
  const contextPixels = readBack(canvas.getContext('2d')!, 0, 0, canvas.width, canvas.height).data;
  const gl = marksCanvas.getContext('webgl2')!;
  const marksPixels = new Uint8Array(marksCanvas.width * marksCanvas.height * 4);
  gl.readPixels(0, 0, marksCanvas.width, marksCanvas.height, gl.RGBA, gl.UNSIGNED_BYTE, marksPixels);
  let coastline = 0, graticule = 0, coloredAfterimage = 0;
  const depthColors = { shallow: 0, intermediate: 0, deep: 0 };
  for (let i = 0; i < contextPixels.length; i += 4) {
    const r = contextPixels[i]!, g = contextPixels[i + 1]!, b = contextPixels[i + 2]!;
    if (r > 80 && g > 95 && b > 95 && Math.abs(r - g) < 65 && Math.abs(g - b) < 55) coastline++;
    if (g > r + 12 && b > r + 12 && g > 28 && b < g * 1.6) graticule++;
  }
  for (let i = 0; i < marksPixels.length; i += 4) {
    const r = marksPixels[i]!, g = marksPixels[i + 1]!, b = marksPixels[i + 2]!, a = marksPixels[i + 3]!;
    if (!a) continue;
    if (g > r + 18 && g > b * 0.8 && g > 25) { coloredAfterimage++; depthColors.shallow++; }
    else if (r > g + 5 && g > b + 5 && r > 25) { coloredAfterimage++; depthColors.intermediate++; }
    else if (b > r + 10 && b > g + 15 && b > 25) { coloredAfterimage++; depthColors.deep++; }
  }
  return { coastline, graticule, coloredAfterimage, depthColors };
}

export async function run(renderer: QuakeRenderer) {
  const { events, stats, coastlines } = renderer.data;
  const idsHash = await sha256(events.map((event) => event.id).sort().join('\n'));
  renderer.draw();
  const pixels = pixelEvidence(renderer.canvas, renderer.marksCanvas);
  emit({ metric: 'source_events', value: events.length });
  emit({ metric: 'unique_event_ids', value: new Set(events.map((event) => event.id)).size });
  emit({ metric: 'coastline_parts', value: coastlines.length });
  emit({ metric: 'visible_events', value: events.length });
  emit({ metric: 'coastline_pixels', value: pixels.coastline });
  emit({ metric: 'graticule_pixels', value: pixels.graticule });
  emit({ metric: 'afterimage_pixels', value: pixels.coloredAfterimage });
  emit({ metric: 'shallow_depth_pixels', value: pixels.depthColors.shallow });
  emit({ metric: 'intermediate_depth_pixels', value: pixels.depthColors.intermediate });
  emit({ metric: 'deep_depth_pixels', value: pixels.depthColors.deep });
  emit({ metric: 'first_frame_ms', value: renderer.firstFrameMs });

  emit({ check: 'frozen-source-count-and-id-preservation', pass: events.length === 8_502
    && stats.source.count === 8_502 && stats.source.uniqueIds === 8_502 && idsHash === stats.source.eventIdSha256,
    detail: `${events.length} records; ${new Set(events.map((event) => event.id)).size} unique IDs; sorted ID SHA-256 ${idsHash}` });
  emit({ check: 'global-geography-and-afterimage-pixels', pass: pixels.coastline > 80 && pixels.graticule > 2_000 && pixels.coloredAfterimage > 300,
    detail: `${pixels.coastline} coastline, ${pixels.graticule} graticule and ${pixels.coloredAfterimage} depth-colored afterimage pixels read from the canvas` });
  emit({ check: 'depth-is-visible-as-a-separate-screen-channel', pass: pixels.depthColors.shallow > 10
    && pixels.depthColors.intermediate > 10 && pixels.depthColors.deep > 10,
    detail: `shallow=${pixels.depthColors.shallow}; intermediate=${pixels.depthColors.intermediate}; deep=${pixels.depthColors.deep} canvas pixels` });
  const selectedIndex = Math.floor(events.length * 0.42), selected = events[selectedIndex]!;
  renderer.selectIndex(selectedIndex);
  const latitudeLabel = `${Math.abs(selected.latitude).toFixed(4)}°${selected.latitude < 0 ? 'S' : 'N'}`;
  const longitudeLabel = `${Math.abs(selected.longitude).toFixed(4)}°${selected.longitude < 0 ? 'W' : 'E'}`;
  const selectionPass = document.getElementById('event-id')!.textContent === selected.id
    && document.getElementById('event-time')!.textContent === new Date(selected.time).toISOString()
    && document.getElementById('event-coordinate')!.textContent === `${latitudeLabel}, ${longitudeLabel}`
    && document.getElementById('event-measure')!.textContent === `M${selected.magnitude.toFixed(1)} · ${selected.depthKm.toFixed(1)} km`;
  emit({ check: 'selected-event-retains-source-fields', pass: selectionPass, detail: `${selected.id} ${selected.time} ${selected.longitude},${selected.latitude} M${selected.magnitude} depth ${selected.depthKm} km` });

  const slider = document.getElementById('timeline') as HTMLInputElement;
  slider.value = '0'; slider.dispatchEvent(new Event('input', { bubbles: true }));
  const sliderPass = document.getElementById('visible-count')!.textContent === '1 / 8,502 events shown'
    && document.getElementById('event-id')!.textContent === events[0]!.id;
  slider.value = String(events.length - 1); slider.dispatchEvent(new Event('input', { bubbles: true }));
  emit({ check: 'keyboard-accessible-time-sweep-control', pass: sliderPass && slider.type === 'range'
    && slider.getAttribute('aria-label') !== null,
    detail: `native range input selects exact source record timestamps; first cutoff shows one event` });
  const datePass = document.getElementById('cutoff-date')!.textContent?.includes('2025-12-31') ?? false;
  emit({ check: 'time-control-keeps-source-dates', pass: datePass,
    detail: `latest event time is ${document.getElementById('cutoff-date')!.textContent}` });

  const body = document.body.innerText;
  emit({ check: 'artistic-encoding-and-limitations-disclosed', pass: body.includes('magnitude increases radius and intensity')
    && body.includes('Intermediate 70–300 km') && body.includes('artistic symbol')
    && body.includes('not a physical model') && body.includes('not a complete or uniformly detected'),
    detail: 'Magnitude, depth, derived-ring meaning, and source snapshot limitations are visible.' });
  emit({ check: 'usgs-and-natural-earth-attribution', pass: body.includes('U.S. Geological Survey · ComCat')
    && body.includes('U.S. public domain') && body.includes('Natural Earth v5.1.1'),
    detail: 'Source institution, public-domain notice and Natural Earth credit are visible.' });

  const zoomBefore = renderer.state.zoom;
  document.getElementById('zoom-in')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const zoomPass = renderer.state.zoom > zoomBefore;
  renderer.resetView();
  emit({ check: 'zoom-control-changes-map-scale', pass: zoomPass, detail: `zoom ${zoomBefore} → ${renderer.state.zoom}` });
  const beforePan = { x: renderer.state.centerX, y: renderer.state.centerY };
  const cx = renderer.canvas.clientWidth / 2, cy = renderer.canvas.clientHeight / 2;
  renderer.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, pointerId: 1, bubbles: true }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: cx + 40, clientY: cy + 20, pointerId: 1, bubbles: true }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 40, clientY: cy + 20, pointerId: 1, bubbles: true }));
  const panPass = renderer.state.centerX !== beforePan.x && renderer.state.centerY !== beforePan.y;
  emit({ check: 'pointer-drag-pans-global-view', pass: panPass,
    detail: `camera center changed by ${renderer.state.centerX - beforePan.x}, ${renderer.state.centerY - beforePan.y}` });
  renderer.resetView();
  const external = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-requests', pass: external.length === 0, detail: `${external.length} off-origin requests` });

  const frameTimes: number[] = [], drawTimes: number[] = [];
  await new Promise(requestAnimationFrame);
  const originalIndex = events.length - 1;
  for (let i = 0; i < 40; i++) {
    const start = performance.now(); renderer.draw(); drawTimes.push(performance.now() - start);
    const frame = performance.now(); await new Promise(requestAnimationFrame); frameTimes.push(performance.now() - frame);
    renderer.setCutoffIndex(originalIndex);
  }
  emit({ metric: 'frame_ms', values: frameTimes });
  emit({ metric: 'draw_cpu_ms', values: drawTimes });
  emit({ info: { renderer: 'WebGL2 instanced rings + Canvas 2D geographic context', projection: 'equirectangular with antimeridian wrap', events: events.length, coastlines: coastlines.length, interpretation: stats.interpretation } });
  emit({ done: true });
}
