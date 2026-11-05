import { emit } from '../../../../harness/page/bench.ts';
import type { WalkMap } from './renderer.ts';

export async function run(map: WalkMap) {
  const { stats } = map;
  emit({ metric: 'source_way_count', value: stats.sourceWays });
  emit({ metric: 'graph_node_count', value: stats.graphNodes });
  emit({ metric: 'graph_edge_count', value: stats.graphEdges });
  emit({ metric: 'reached_node_count', value: stats.reachedNodes });
  emit({ metric: 'reachable_segment_count', value: stats.reachableSegments });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ info: { renderer: 'Canvas 2D + OSM street graph / Dijkstra', origin: stats.originName, source_date: stats.sourceDate, source_ways: stats.sourceWays, graph_nodes: stats.graphNodes, graph_edges: stats.graphEdges, reached_nodes: stats.reachedNodes, reachable_segments: stats.reachableSegments } });
  emit({ check: 'connected-origin', pass: stats.originSnapMeters <= 100 && stats.reachedNodes >= 100, detail: `origin snap ${stats.originSnapMeters.toFixed(1)} m; ${stats.reachedNodes} reachable junctions` });
  emit({ check: 'ten-minute-frontier', pass: stats.reachableSegments > 0 && stats.unreachableSegments > 0, detail: `${stats.reachableSegments} reachable and ${stats.unreachableSegments} outside-frontier segments` });
  const sourceLinks = [...document.querySelectorAll('a')].map((a) => a.href);
  emit({ check: 'source-disclosure', pass: document.body.innerText.includes('OpenStreetMap contributors') && document.body.innerText.includes('2026-08-31') && document.body.innerText.includes('ODbL 1.0') && document.body.innerText.includes('推定') && sourceLinks.includes('https://opendatacommons.org/licenses/odbl/1-0/') && sourceLinks.includes('https://www.openstreetmap.org/copyright'), detail: 'snapshot date, OSM attribution, ODbL URI, and estimate caveat visible' });
  const readback = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
  readback.drawImage(map.canvas, Math.floor(map.canvas.width / 2 + 8 * devicePixelRatio), Math.floor(map.canvas.height / 2), 1, 1, 0, 0, 1, 1);
  const originPixel = readback.getImageData(0, 0, 1, 1).data;
  emit({ check: 'origin-pixel', pass: originPixel[0]! > originPixel[1]! && originPixel[0]! > 150, detail: `center sample RGB ${originPixel[0]},${originPixel[1]},${originPixel[2]}` });
  const original = { ...map.state }, frames: number[] = [], drawCpu: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 80; i++) {
    map.state.zoom = 1 + 2 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 79));
    map.state.panX = Math.sin(i / 13) * 28 * devicePixelRatio;
    const start = performance.now(); map.draw(); drawCpu.push(performance.now() - start);
    await new Promise(requestAnimationFrame);
    frames.push(performance.now() - start);
  }
  Object.assign(map.state, original); map.draw();
  emit({ metric: 'draw_cpu_ms', values: drawCpu });
  emit({ metric: 'frame_ms', values: frames });
  emit({ done: true });
}
