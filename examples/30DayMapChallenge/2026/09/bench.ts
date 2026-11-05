import { emit } from '../../../../harness/page/bench.ts';
import type { UrbanMap } from './renderer.ts';

export async function run(map: UrbanMap) {
  const { stats, records } = map;
  emit({ metric: 'active_cell_count', value: stats.cells });
  emit({ metric: 'population_cell_count', value: stats.populationCells });
  emit({ metric: 'built_only_cell_count', value: stats.builtOnlyCells });
  emit({ metric: 'matched_cell_count', value: stats.matchedCellCount });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ info: { renderer: 'WebGL2 shader point renderer', population_product: stats.populationProduct,
    gpu: 'WebGL2 hardware point draw',
    built_product: stats.builtProduct, cells: stats.cells, matched_cells: stats.matchedCellCount,
    population_estimate: Math.round(stats.populationEstimate), output_bytes: stats.outputBytes } });
  emit({ check: 'aligned-source-cells', pass: stats.matchedCellCount >= 100_000 && stats.spatialJoin.includes('contains'), detail: `${stats.matchedCellCount} cells have population and geometrically matched built surface` });
  emit({ check: 'population-built-separation', pass: stats.populationCells >= 100_000 && stats.builtOnlyCells > 0 && records.length === stats.cells * 4,
    detail: `${stats.populationCells} cells with population; ${stats.builtOnlyCells} built-only; ${records.length / 4} fixed-width records` });
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity, invalid = 0;
  for (let i = 0; i < records.length; i += 4) {
    const lon = records[i]!, lat = records[i + 1]!, pop = records[i + 2]!, built = records[i + 3]!;
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    if (!Number.isFinite(lon + lat + pop + built) || pop < 0 || built < 0 || (pop === 0 && built === 0)) invalid++;
  }
  emit({ check: 'japan-mask-and-active-cells', pass: invalid === 0 && minLon >= 122 && maxLon <= 146.1 && minLat >= 29.099 && maxLat <= 46,
    detail: `extent ${minLon.toFixed(2)}–${maxLon.toFixed(2)}°E, ${minLat.toFixed(2)}–${maxLat.toFixed(2)}°N; invalid or empty ${invalid}` });
  const body = document.body.innerText;
  const links = [...document.querySelectorAll('a')].map((link) => link.href);
  emit({ check: 'model-and-extent-disclosure', pass: body.includes('推計') && body.includes('建成地') && body.includes('2020') && body.includes('30秒')
    && body.includes('29.0995') && body.includes('国勢調査の実数ではありません')
    && links.includes('https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php')
    && links.includes('https://human-settlement.emergency.copernicus.eu/ghs_buS2023.php')
    && links.includes('https://creativecommons.org/licenses/by/4.0/'), detail: 'modeled data, epoch, grid size, tile coverage caveat and JRC citations are visible' });
  const webgl2 = map.canvas.getContext('webgl2') as WebGL2RenderingContext | null;
  emit({ check: 'webgl2-renderer', pass: Boolean(webgl2 && String(webgl2.getParameter(webgl2.VERSION)).includes('WebGL 2')), detail: webgl2 ? String(webgl2.getParameter(webgl2.VERSION)) : 'WebGL2 context unavailable' });
  const original = { ...map.state }, frames: number[] = [], drawCpu: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 80; i++) {
    map.state.zoom = 1 + 2.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 79));
    map.state.panX = Math.sin(i / 17) * 38 * devicePixelRatio;
    map.state.panY = Math.cos(i / 19) * 22 * devicePixelRatio;
    const start = performance.now(); map.draw(); drawCpu.push(performance.now() - start);
    await new Promise(requestAnimationFrame); frames.push(performance.now() - start);
  }
  Object.assign(map.state, original); map.draw();
  emit({ metric: 'draw_cpu_ms', values: drawCpu });
  emit({ metric: 'frame_ms', values: frames });
  emit({ done: true });
}
