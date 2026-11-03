import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import type { Globe } from './globe.ts';

export async function run(globe: Globe, firstFrameMs: number, comparison = false, route = false, morphing = false, dragging = false): Promise<void> {
  await new Promise(requestAnimationFrame);
  emit({ info: { gpu: glRenderer(globe.gl), renderer: 'WebGL2 textured globe' } });
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  const gl = globe.gl;
  globe.draw();
  gl.finish();
  const pixels = new Uint8Array(4);
  const x = Math.round(gl.canvas.width * (comparison ? 0.25 : 0.5));
  gl.readPixels(x, Math.floor(gl.canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const visible = pixels[1] > 20 && pixels[2] > 30;
  const equatorOcean = pixels[0] < 80;
  emit({ check: 'equator-ocean-facing', pass: equatorOcean, detail: `equator rgba(${pixels.join(',')})` });
  emit({ check: 'surface-visible', pass: visible, detail: `center sample rgba(${pixels.join(',')})` });
  if (dragging) {
    const before = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0,0,gl.canvas.width,gl.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,before);
    const rect=globe.canvas.getBoundingClientRect(), cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
    const t0=performance.now();
    globe.canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:9,clientX:cx,clientY:cy,bubbles:true}));
    globe.canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:9,clientX:cx+rect.height*0.35,clientY:cy,bubbles:true}));
    globe.canvas.dispatchEvent(new PointerEvent('pointerup',{pointerId:9,clientX:cx+rect.height*0.35,clientY:cy,bubbles:true}));
    const dragMs=performance.now()-t0; gl.finish();
    const after=new Uint8Array(before.length); gl.readPixels(0,0,gl.canvas.width,gl.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,after);
    let difference=0; for(let i=0;i<before.length;i+=4) difference+=Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2]);
    emit({ metric:'drag_dispatch_ms', value:dragMs });
    emit({ check:'drag-updates-view', pass:difference>10000, detail:`pixel color difference ${difference}` });
  }
  if (comparison) {
    const right = new Uint8Array(4);
    gl.readPixels(Math.round(gl.canvas.width * 0.75), Math.floor(gl.canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right);
    const rightVisible = right[1] > 20 && right[2] > 30;
    emit({ check: 'both-projections-visible', pass: visible && rightVisible, detail: `orthographic rgba(${pixels.join(',')}), equirectangular rgba(${right.join(',')})` });
  }
  const error = gl.getError();
  emit({ check: 'webgl-clean', pass: error === gl.NO_ERROR, detail: `WebGL error ${error}` });
  await benchFrames(gl, 60, () => globe.draw());
  emit({ done: true });
}
