import type { GlobeRenderer } from './render.ts';

declare global {
  interface Window {
    __mfsEmit?: (payload: unknown) => void;
  }
}

export async function runBench(renderer: GlobeRenderer): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2');
  if (!gl) return;

  // Let renderer draw 5 warm-up frames
  for (let i = 0; i < 5; i++) {
    renderer.render(0.016);
    await new Promise((r) => requestAnimationFrame(r));
  }

  const w = canvas.width;
  const h = canvas.height;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);

  // Check 1: Earth surface rendered at center
  const centerPixel = new Uint8Array(4);
  gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, centerPixel);
  const centerHasEarth = centerPixel[0] > 5 || centerPixel[1] > 5 || centerPixel[2] > 5;
  if (window.__mfsEmit) {
    window.__mfsEmit({
      type: 'verification',
      check: 'globe-rendered',
      pass: centerHasEarth,
      detail: `center pixel RGB(${centerPixel[0]}, ${centerPixel[1]}, ${centerPixel[2]})`,
    });
  }

  // Check 2: Atmosphere glow near globe silhouette rim
  // Looking offset from center towards edge
  const rimPixel = new Uint8Array(4);
  // Estimate rim offset based on camera distance (roughly 38% screen height at distance 2.6)
  const rimOffset = Math.floor(h * 0.35);
  gl.readPixels(cx + rimOffset, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rimPixel);
  const hasAtmosphere = rimPixel[2] > 15 && rimPixel[2] >= rimPixel[0];
  if (window.__mfsEmit) {
    window.__mfsEmit({
      type: 'verification',
      check: 'atmosphere-halo-rendered',
      pass: hasAtmosphere,
      detail: `rim pixel RGB(${rimPixel[0]}, ${rimPixel[1]}, ${rimPixel[2]})`,
    });
  }

  // Check 3: Deep space background in outer corner
  const cornerPixel = new Uint8Array(4);
  gl.readPixels(10, 10, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, cornerPixel);
  const spaceClear = cornerPixel[0] < 20 && cornerPixel[1] < 25 && cornerPixel[2] < 35;
  if (window.__mfsEmit) {
    window.__mfsEmit({
      type: 'verification',
      check: 'space-background-clear',
      pass: spaceClear,
      detail: `corner pixel RGB(${cornerPixel[0]}, ${cornerPixel[1]}, ${cornerPixel[2]})`,
    });
  }

  // Measure 30 frames
  const frameTimes: number[] = [];
  let prev = performance.now();
  for (let i = 0; i < 30; i++) {
    renderer.render(0.016);
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    frameTimes.push(now - prev);
    prev = now;
  }

  frameTimes.sort((a, b) => a - b);
  const medianMs = frameTimes[Math.floor(frameTimes.length / 2)];
  if (window.__mfsEmit) {
    window.__mfsEmit({
      type: 'metric',
      name: 'frame_time_ms',
      value: medianMs,
    });
  }
}
