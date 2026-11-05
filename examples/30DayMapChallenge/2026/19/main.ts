import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const base = '../../../../data/baked/30DayMapChallenge-2026-19';

try {
  const renderer = await mount(canvas, base);
  document.getElementById('zoom-in')!.addEventListener('click', () => renderer.setZoom(renderer.zoomLevel * 1.35));
  document.getElementById('zoom-out')!.addEventListener('click', () => renderer.setZoom(renderer.zoomLevel / 1.35));
  document.getElementById('reset')!.addEventListener('click', () => renderer.resetView());
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(renderer);
  }
} catch (error) {
  console.error(error);
  document.getElementById('notice')!.innerHTML = `<strong>地図データを読み込めませんでした</strong><span>${String(error)}</span>`;
}
