import { mount } from './renderer.ts';
const canvas = document.getElementById('map') as HTMLCanvasElement;
try {
  const map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-07');
  document.getElementById('count')!.textContent = `${map.stats.reachedNodes.toLocaleString()} junctions · ${map.stats.reachableSegments.toLocaleString()} street segments`;
  document.getElementById('origin')!.textContent = `${map.stats.originName} · network snap ${map.stats.originSnapMeters.toFixed(0)} m`;
  document.getElementById('speed')!.textContent = `${map.stats.walkMinutes} min · ${map.stats.walkingSpeedMps.toFixed(1)} m/s assumed pace`;
  if (new URLSearchParams(location.search).has('bench')) { const { run } = await import('./bench.ts'); await run(map); }
} catch (error) {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:16px;left:16px;background:#32141a;padding:12px;color:white">${String(error)}</pre>`);
}
