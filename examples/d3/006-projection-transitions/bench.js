import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.js';
export async function run(globe, firstFrameMs, comparison = false, route = false, morphing = false) {
    await new Promise(requestAnimationFrame);
    emit({
        info: {
            gpu: glRenderer(globe.gl),
            renderer: 'WebGL2 textured globe'
        }
    });
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const gl = globe.gl;
    globe.draw();
    gl.finish();
    const pixels = new Uint8Array(4);
    const x = Math.round(gl.canvas.width * (comparison ? 0.25 : 0.5));
    gl.readPixels(x, Math.floor(gl.canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const visible = pixels[1] > 20 && pixels[2] > 30;
    const equatorOcean = pixels[0] < 80;
    emit({
        check: 'equator-ocean-facing',
        pass: equatorOcean,
        detail: `equator rgba(${pixels.join(',')})`
    });
    emit({
        check: 'surface-visible',
        pass: visible,
        detail: `center sample rgba(${pixels.join(',')})`
    });
    if (morphing) {
        const edge = Math.round(gl.canvas.width * 0.04), centerY = Math.floor(gl.canvas.height / 2);
        globe.setMorph(0);
        gl.finish();
        const globeEdge = new Uint8Array(4);
        gl.readPixels(edge, centerY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, globeEdge);
        globe.setMorph(1);
        gl.finish();
        const mapEdge = new Uint8Array(4);
        gl.readPixels(edge, centerY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, mapEdge);
        const delta = globeEdge.reduce((sum, v, i)=>sum + Math.abs(v - mapEdge[i]), 0);
        const changed = delta > 20;
        emit({
            metric: 'morph_delta',
            value: delta
        });
        emit({
            check: 'morph-endpoints-visible',
            pass: changed,
            detail: `globe edge rgba(${globeEdge.join(',')}), map edge rgba(${mapEdge.join(',')})`
        });
        globe.setMorph(0);
    }
    if (comparison) {
        const right = new Uint8Array(4);
        gl.readPixels(Math.round(gl.canvas.width * 0.75), Math.floor(gl.canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right);
        const rightVisible = right[1] > 20 && right[2] > 30;
        emit({
            check: 'both-projections-visible',
            pass: visible && rightVisible,
            detail: `orthographic rgba(${pixels.join(',')}), equirectangular rgba(${right.join(',')})`
        });
    }
    const error = gl.getError();
    emit({
        check: 'webgl-clean',
        pass: error === gl.NO_ERROR,
        detail: `WebGL error ${error}`
    });
    await benchFrames(gl, 60, ()=>globe.draw());
    emit({
        done: true
    });
}
