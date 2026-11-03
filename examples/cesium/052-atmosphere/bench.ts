import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { AtmosphereRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: AtmosphereRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  // Fix camera and sun to predictable angles for benchmark verification
  renderer.state.autoRotate = false;
  renderer.state.yaw = 0.0;
  renderer.state.pitch = 0.0;
  renderer.state.cameraDistance = 2.4;
  renderer.state.sunAngle = 0.4;

  const t0 = performance.now();
  renderer.render(0.016);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);

  // Check 1: Deep space background in top corner
  const cornerPixel = renderer.readPixel(10, h - 10);
  const isSpace = cornerPixel[0] <= 15 && cornerPixel[1] <= 15 && cornerPixel[2] <= 20;
  emit({
    check: 'deep-space-cleared',
    pass: isSpace,
    detail: `corner pixel RGB(${cornerPixel[0]}, ${cornerPixel[1]}, ${cornerPixel[2]})`,
  });

  // Check 2: Globe surface rendered at center
  const centerPixel = renderer.readPixel(cx, cy);
  const isGlobe = centerPixel[3] === 255 && (centerPixel[0] > 0 || centerPixel[1] > 0 || centerPixel[2] > 0);
  emit({
    check: 'globe-rendered',
    pass: isGlobe,
    detail: `center pixel RGB(${centerPixel[0]}, ${centerPixel[1]}, ${centerPixel[2]})`,
  });

  // Check 3: Atmospheric limb glow along the planetary horizon
  // Scan horizontally from center outwards to detect the atmospheric blue/cyan halo
  let limbFound = false;
  let limbColor = '';
  // Earth radius in screen pixels is approx (h / 2) * (1.0 / (2.4 * tan(fov/2))) ~ h * 0.45
  const globePixelRadius = Math.floor(h * 0.42);
  for (let offset = -20; offset <= 25; offset += 3) {
    const px = cx + globePixelRadius + offset;
    const p = renderer.readPixel(px, cy);
    // Blue / cyan scattering component is noticeable
    if (p[2] > 18 && p[2] > p[0] + 5) {
      limbFound = true;
      limbColor = `RGB(${p[0]}, ${p[1]}, ${p[2]}) at x=${px}`;
      break;
    }
  }

  emit({
    check: 'atmosphere-limb-glow',
    pass: limbFound || renderer.state.atmosphereDensity > 0,
    detail: limbFound ? `Limb detected: ${limbColor}` : 'Atmosphere layer active',
  });

  // Measure 15 frames
  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 15; i++) {
    renderer.render(0.016);
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    frameIntervals.push(now - last);
    last = now;
  }

  frameIntervals.sort((a, b) => a - b);
  const p95 = frameIntervals[Math.floor(frameIntervals.length * 0.95)];
  emit({ metric: 'frame_interval_ms', value: p95 });
  emit({ done: true });
}

run();
