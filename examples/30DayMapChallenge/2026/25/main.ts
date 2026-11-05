import { mount } from './renderer.ts';
import type { EarthquakeEvent } from './field.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const marks = document.getElementById('marks') as HTMLCanvasElement;
const base = '../../../../data/baked/30DayMapChallenge-2026-25';
const timeline = document.getElementById('timeline') as HTMLInputElement;
const cutoffDate = document.getElementById('cutoff-date')!;
const visibleCount = document.getElementById('visible-count')!;

function showEvent(event: EarthquakeEvent, index: number, count: number) {
  const formatCoordinate = (value: number, axis: 'lat' | 'lon') =>
    `${Math.abs(value).toFixed(4)}°${axis === 'lat' ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E')}`;
  timeline.value = String(index);
  cutoffDate.textContent = new Date(event.time).toISOString().replace('T', ' ').replace('Z', ' UTC');
  visibleCount.textContent = `${count.toLocaleString()} / 8,502 events shown`;
  document.getElementById('event-id')!.textContent = event.id;
  document.getElementById('event-time')!.textContent = new Date(event.time).toISOString();
  document.getElementById('event-coordinate')!.textContent = `${formatCoordinate(event.latitude, 'lat')}, ${formatCoordinate(event.longitude, 'lon')}`;
  document.getElementById('event-measure')!.textContent = `M${event.magnitude.toFixed(1)} · ${event.depthKm.toFixed(1)} km`;
}

try {
  const renderer = await mount(canvas, marks, base, showEvent);
  timeline.max = String(renderer.data.events.length - 1);
  timeline.addEventListener('input', () => renderer.setCutoffIndex(Number(timeline.value)));
  document.getElementById('zoom-in')!.addEventListener('click', () => { renderer.state.zoom = Math.min(8, renderer.state.zoom * 1.35); renderer.render(); });
  document.getElementById('zoom-out')!.addEventListener('click', () => { renderer.state.zoom = Math.max(.7, renderer.state.zoom / 1.35); renderer.render(); });
  document.getElementById('reset')!.addEventListener('click', () => renderer.resetView());
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(renderer);
  }
} catch (error) {
  console.error(error);
  document.getElementById('notice')!.innerHTML = `<strong>Map data could not be loaded.</strong><span>${String(error)}</span>`;
}
