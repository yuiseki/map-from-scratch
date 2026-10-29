import { mount } from './heatmap.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const heatmap = await mount(canvas, '../../../data/baked/deckgl-011-heatmap-layer/points.bin');
document.getElementById('status')!.textContent = `${heatmap.points.toLocaleString('ja-JP')} 地点 · 重み合計 ${heatmap.totalWeight.toLocaleString('ja-JP')}`;
heatmap.gl.readPixels(0, 0, 1, 1, heatmap.gl.RGBA, heatmap.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;

const bind = (id: string, scale: number, unit: string, update: (n: number) => void) => {
  const slider = document.getElementById(id) as HTMLInputElement;
  const value = document.getElementById(`${id}-value`)!;
  slider.addEventListener('input', () => {
    const n = Number(slider.value) * scale;
    update(n);
    value.textContent = `${n.toFixed(scale < 1 ? 2 : 0)}${unit}`;
  });
};
bind('radius', 1, ' px', heatmap.setRadius);
bind('intensity', 0.1, '', heatmap.setIntensity);
bind('threshold', 0.01, '', heatmap.setThreshold);
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(heatmap, firstFrameMs);
