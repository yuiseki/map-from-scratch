import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.js';
export async function run(map, firstFrameMs) {
    const { gl } = map;
    gl.canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'WebGL context lost'
        }));
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    emit({
        info: {
            gpu: glRenderer(gl),
            cells: map.count
        }
    });
    emit({
        check: 'grid-complete',
        pass: map.count === 720 * 361,
        detail: String(map.count)
    });
    await benchFrames(gl, 180, (i)=>{
        map.step = 2 + i % 11;
        map.draw();
    });
    map.setStep(5);
    await benchFrames(gl, 60, ()=>map.draw(), {
        prefix: 'whole_'
    });
    const pixels = ()=>{
        const out = new Uint8Array(map.canvas.width * map.canvas.height * 4);
        map.draw();
        gl.readPixels(0, 0, map.canvas.width, map.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return out;
    };
    const a = pixels();
    let nonBackground = 0;
    for(let i = 0; i < a.length; i += 4)if (a[i] > 40 && a[i + 1] > 20) nonBackground++;
    emit({
        check: 'visible-globe',
        pass: nonBackground > 100000,
        detail: `${nonBackground} globe pixels`
    });
    map.setStep(10);
    const b = pixels();
    let changed = 0;
    for(let i = 0; i < a.length; i += 16)if (a[i] !== b[i] || a[i + 1] !== b[i + 1]) changed++;
    emit({
        check: 'step-changes-screen',
        pass: changed > 1000,
        detail: `${changed} changed samples`
    });
    map.setStep(5);
    emit({
        done: true
    });
}
