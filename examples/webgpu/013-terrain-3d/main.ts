// Main entry point for WebGPU Mt. Fuji 3D Terrain visualization.
import { WebGPUTerrainRenderer, type Camera } from './render.ts';

async function init() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const statusEl = document.getElementById('status') as HTMLElement;
  const pitchInput = document.getElementById('pitch') as HTMLInputElement;

  if (!navigator.gpu) {
    statusEl.textContent = 'WebGPU is not supported in this browser.';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    statusEl.textContent = 'No suitable WebGPU adapter found.';
    return;
  }

  const device = await adapter.requestDevice();
  const gpu = `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) {
    statusEl.textContent = 'Failed to get WebGPU context.';
    return;
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', () => {
    resize();
    render();
  });
  resize();

  const renderer = new WebGPUTerrainRenderer(device, context);

  // Summit coordinates: col 1233.5, row 1739.5 in L0 px from NW corner
  // 4.7 km west and 3.2 km south of the area centre (matching 17-fuji-terrain-3d)
  const cell = 15.578601873;
  const sx = (1233.5 - 1536) * cell;
  const sy = (1536 - 1739.5) * cell;

  // Initial camera: looking toward Mt. Fuji summit (3,776m) from North looking SSW
  const camera: Camera = {
    yaw: 200,
    pitch: parseFloat(pitchInput.value) || 28,
    dist: 36000, // 36 km
    tx: sx,
    ty: sy,
    tz: 1800,
    width: canvas.width,
    height: canvas.height,
  };

  function render() {
    camera.width = canvas.width;
    camera.height = canvas.height;
    renderer.render(camera);
  }

  try {
    console.log('Fetching fuji.terr...');
    statusEl.textContent = 'Loading Mt. Fuji .terr data...';
    const res = await fetch('../../../data/baked/17-fuji-terrain-3d/fuji.terr');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bin = await res.arrayBuffer();
    console.log(`Loaded fuji.terr (${bin.byteLength} bytes)`);
    renderer.loadTerrain(new Uint8Array(bin));
    statusEl.textContent = 'Ready (Mt. Fuji 3,776 m)';
    console.log('Terrain loaded and ready');
  } catch (err: unknown) {
    statusEl.textContent = `Failed to load terrain: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  pitchInput.addEventListener('input', () => {
    camera.pitch = parseFloat(pitchInput.value);
    render();
  });

  // Orbit camera interaction
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    camera.yaw = (camera.yaw + dx * 0.4) % 360;
    camera.pitch = Math.max(10, Math.min(85, camera.pitch + dy * 0.3));
    pitchInput.value = camera.pitch.toFixed(1);
    render();
  });

  const stopDrag = (e: PointerEvent) => {
    if (isDragging) {
      isDragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.001);
    camera.dist = Math.max(5000, Math.min(100000, camera.dist * factor));
    render();
  }, { passive: false });

  render();

  if (window.location.search.includes('bench')) {
    import('./bench.ts').then((mod) => {
      mod.run({
        device,
        gpu,
        renderer,
        camera,
        ready: () => renderer.hasData(),
      });
    });
  }
}

init().catch((err) => {
  console.error('init failed:', err);
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
