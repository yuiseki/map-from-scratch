import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import type { EarthRenderer } from './globe.ts';

export async function run(renderer: EarthRenderer, draw: (timeMs: number) => void, overlay: HTMLCanvasElement, firstFrame: () => number): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); emit({ error: 'webglcontextlost' }); });
  emit({ info: { gpu: glRenderer(gl), route: 'San Francisco to New York', sphere_triangles: 96 * 192 * 2, runtime_dependencies: 0 } });
  for (let i = 0; i < 30 && !firstFrame(); i++) await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrame() });

  const drawAndRead = (time: number) => {
    renderer.render(0.15, -0.12, 3.45);
    draw(time);
    const pixels = overlay.getContext('2d')!.getImageData(0, 0, overlay.width, overlay.height).data;
    let cyan = 0, gold = 0, goldX = 0, goldY = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 1] > 170 && pixels[i + 2] > 190 && pixels[i] < 180 && pixels[i + 3] > 0) cyan++;
      if (pixels[i] > 220 && pixels[i + 1] > 150 && pixels[i + 2] < 190 && pixels[i + 3] > 0) {
        gold++;
        const pixel = i / 4;
        goldX += pixel % overlay.width;
        goldY += Math.floor(pixel / overlay.width);
      }
    }
    return { cyan, gold, goldX: gold ? goldX / gold : 0, goldY: gold ? goldY / gold : 0 };
  };
  const startPixels = drawAndRead(0);
  emit({ check: 'globe-visible', pass: renderer.readPixel(Math.floor(gl.canvas.width / 2), Math.floor(gl.canvas.height / 2))[3] === 255, detail: 'Earth center pixel read from WebGL framebuffer' });
  emit({ check: 'route-and-aircraft-visible', pass: startPixels.cyan > 20 && startPixels.gold > 0, detail: `route cyan pixels=${startPixels.cyan}, aircraft gold pixels=${startPixels.gold}` });
  const laterPixels = drawAndRead(4500);
  const aircraftMoved = Math.hypot(laterPixels.goldX - startPixels.goldX, laterPixels.goldY - startPixels.goldY);
  emit({ check: 'aircraft-animates', pass: laterPixels.gold > 0 && laterPixels.cyan > 0 && aircraftMoved > 8, detail: `after 4.5s: route=${laterPixels.cyan}, aircraft=${laterPixels.gold}; center moved ${aircraftMoved.toFixed(1)} px` });
  await benchFrames(gl, 40, (i) => draw(i * 1000 / 60));
  emit({ done: true });
}
