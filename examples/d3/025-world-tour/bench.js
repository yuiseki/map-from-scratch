import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.js';
export async function run(globe, firstFrameMs, comparison = false, route = false) {
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
    if (route) {
        const frame = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
        gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        let glowing = 0;
        for(let i = 0; i < frame.length; i += 4)if (frame[i] > 180 && frame[i + 1] > 45 && frame[i + 1] < 150 && frame[i + 2] < 100) glowing++;
        emit({
            check: 'tour-route-visible',
            pass: glowing > 12,
            detail: `${glowing} glowing route pixels`
        });
    } else {
        const equatorOcean = pixels[0] < 80;
        emit({
            check: 'equator-ocean-facing',
            pass: equatorOcean,
            detail: `equator rgba(${pixels.join(',')})`
        });
    }
    emit({
        check: 'surface-visible',
        pass: visible,
        detail: `center sample rgba(${pixels.join(',')})`
    });
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
