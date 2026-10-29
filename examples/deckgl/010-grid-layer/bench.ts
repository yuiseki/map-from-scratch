import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import type { TreeMap } from './renderer.ts';

export async function run(map: TreeMap, firstFrameMs: number): Promise<void> {
  const { gl } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ info: { gpu: glRenderer(gl), trees: map.treeCount, bands: map.layers.map((layer) => layer.count) } });
  for (const layer of map.layers) {
    const data = new DataView(layer.buffer);
    let sum = 0;
    for (let i = 0; i < layer.count; i++) sum += data.getUint16(12 + i * 8 + 4, true);
    emit({ check: `all-trees-${layer.size}`, pass: sum === map.treeCount, detail: `${sum}/${map.treeCount}` });
  }
  const initialZoom = map.zoom;
  await benchFrames(gl, 260, (i) => {
    const t = i / 259;
    map.zoom = 10 + 8 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
    map.centerX = 3000 * Math.sin(t * Math.PI * 2);
    map.centerY = 1500 * Math.sin(t * Math.PI * 4);
    map.draw();
  });
  map.centerX = 0; map.centerY = 0; map.zoom = initialZoom; map.draw();
  await benchFrames(gl, 60, () => map.draw(), { prefix: 'whole_' });
  const pixels = () => {
    const out = new Uint8Array(map.canvas.width * map.canvas.height * 4);
    map.draw();
    gl.readPixels(0, 0, map.canvas.width, map.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  };
  const coarse = pixels();
  let green = 0;
  for (let i = 0; i < coarse.length; i += 4) if (coarse[i + 1] > coarse[i] * 1.25 && coarse[i + 1] > 60) green++;
  emit({ check: 'visible-grid', pass: green > 1000, detail: `${green} green pixels` });
  const rect = map.canvas.getBoundingClientRect();
  const gridData = new DataView(map.layers[map.activeBand].buffer);
  let gridIndex = 0, nearest = Infinity;
  for (let i = 0; i < map.layers[map.activeBand].count; i++) {
    const at = 12 + i * 8;
    const distance = Math.abs(gridData.getInt16(at, true)) + Math.abs(gridData.getInt16(at + 2, true));
    if (distance < nearest) { nearest = distance; gridIndex = i; }
  }
  const gridAt = 12 + gridIndex * 8;
  const gridSize = map.layers[map.activeBand].size;
  map.centerX = (gridData.getInt16(gridAt, true) + 0.5) * gridSize;
  map.centerY = (gridData.getInt16(gridAt + 2, true) + 0.5) * gridSize;
  map.draw();
  const gridTip = map.hover(rect.left + rect.width / 2, rect.top + rect.height / 2);
  emit({ check: 'grid-hover-count', pass: !!gridTip?.includes('本'), detail: gridTip ?? 'none' });
  map.centerX = 0; map.centerY = 0; map.draw();
  map.zoom = 18; map.draw();
  emit({ check: 'individual-trees', pass: map.activeBand === 8, detail: map.activeLabel });
  const fine = pixels();
  let changed = 0;
  for (let i = 0; i < coarse.length; i += 16) if (coarse[i] !== fine[i] || coarse[i + 1] !== fine[i + 1]) changed++;
  emit({ check: 'zoom-changes-screen', pass: changed > 1000, detail: `${changed} changed samples` });
  const raw = new DataView(map.treeBuffer);
  const signed24 = (at: number) => ((raw.getUint8(at) | (raw.getUint8(at + 1) << 8) | (raw.getUint8(at + 2) << 16)) << 8) >> 8;
  map.centerX = signed24(8) / 20; map.centerY = signed24(11) / 20;
  map.draw();
  const treeTip = map.hover(rect.left + rect.width / 2, rect.top + rect.height / 2);
  emit({ check: 'tree-hover-species', pass: !!treeTip && treeTip.length > 1, detail: treeTip ?? 'none' });
  map.centerX = 0; map.centerY = 0;
  map.zoom = initialZoom; map.draw();
  emit({ done: true });
}
