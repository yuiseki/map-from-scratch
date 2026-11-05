// Main entry point for htmlcanvas-002-webgpu-map-label
import { mount, type WebGpuLabelMap } from './map.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const hudGpu = document.getElementById('hud-gpu');
const hudUploads = document.getElementById('hud-uploads');
const hudPath = document.getElementById('hud-path');
const hudCount = document.getElementById('hud-count');
const btnUpdate = document.getElementById('btn-update');

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();

const DATA_URL = '../../../data/baked/htmlcanvas-002-webgpu-map-label/landmarks.json';

const startTime = performance.now();
const mapInstance = await mount(canvas, DATA_URL);
const firstFrameMs = performance.now() - startTime;
// Registered after mount: a resize during the await read mapInstance in its
// temporal dead zone and threw.
window.addEventListener('resize', () => {
  resize();
  mapInstance.render();
});

function updateHud(): void {
  if (hudGpu) hudGpu.textContent = mapInstance.gpuName;
  if (hudCount) hudCount.textContent = String(mapInstance.landmarks.length);
  if (hudUploads) hudUploads.textContent = String(mapInstance.textureUploadCount);
  if (hudPath) hudPath.textContent = mapInstance.htmlInCanvas
    ? 'HTML-in-Canvas → WebGPU texture'
    : 'DOM overlay (no HTML-in-Canvas, or SwiftShader)';
}

const originalRender = mapInstance.render;
mapInstance.render = async () => {
  await originalRender();
  updateHud();
};
updateHud();
// Cards are uploaded in the canvas's paint event, outside render().
canvas.addEventListener('paint', () => requestAnimationFrame(updateHud));

if (btnUpdate) {
  btnUpdate.addEventListener('click', async () => {
    await mapInstance.updateLabelContent(
      0,
      '東京タワー [更新]',
      '人気スポット',
      '★ 4.9',
    );
    updateHud();
  });
}

// Benchmark hook
if (new URLSearchParams(window.location.search).has('bench')) {
  const { runBench } = await import('./bench.ts');
  await runBench(mapInstance, firstFrameMs);
}
