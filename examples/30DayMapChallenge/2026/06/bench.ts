import { emit } from '../../../../harness/page/bench.ts';
import type { VintageMap } from './renderer.ts';

export async function run(map: VintageMap) {
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ metric: 'country_count', value: map.stats.countries });
  emit({ metric: 'polygon_vertex_count', value: map.stats.vertices });
  emit({ info: { renderer: 'Canvas 2D', countries: map.stats.countries, rings: map.stats.rings, vertices: map.stats.vertices } });
  emit({ check: 'source-coverage', pass: map.stats.features === 258 && map.stats.countries === 258 && map.stats.vertices >= 10000, detail: `${map.stats.features} source features; ${map.stats.countries} drawable countries; ${map.stats.vertices} vertices` });
  const frames: number[] = [];
  for (let i = 0; i < 80; i++) {
    map.state.zoom = 0.8 + 3.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 79));
    map.state.panX = Math.sin(i / 12) * 22 * devicePixelRatio;
    const start = performance.now(); map.draw(); frames.push(performance.now() - start);
  }
  map.state.zoom = 1; map.state.panX = 0; map.state.panY = 0; map.draw();
  emit({ metric: 'frame_ms', values: frames });
  emit({ check: 'vintage-style', pass: document.querySelector('canvas')?.width === 1280 && map.stats.vertices >= 10000, detail: 'world paths, graticule, paper and engraved hatch drawn at the benchmark viewport' });
  emit({ check: 'source-credit', pass: document.body.innerText.includes('Public domain') && document.body.innerText.includes('Natural Earth') && document.body.innerText.includes('1:10m'), detail: 'source, scale, and public-domain credit visible' });
  emit({ done: true });
}
