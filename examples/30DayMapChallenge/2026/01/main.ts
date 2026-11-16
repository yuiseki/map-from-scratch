import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const base = '../../../../data/baked/30DayMapChallenge-2026-01';
try {
  const map = await mount(canvas, base);
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(map);
  }
} catch (error) {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 16px 16px;background:#400;padding:12px">${String(error)}</pre>`);
}
