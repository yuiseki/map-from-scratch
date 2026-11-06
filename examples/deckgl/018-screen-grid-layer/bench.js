import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.js';
export async function run(map, firstFrameMs) {
    const { gl, cam } = map;
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
            points: map.points,
            weight: map.totalWeight
        }
    });
    const [west, north, east, south] = map.bounds;
    const spanX = east - west, spanY = south - north;
    const allZoom = Math.log2(Math.min(gl.canvas.width / spanX, gl.canvas.height / spanY) * 0.9 / 512);
    const initial = {
        x: cam.x,
        y: cam.y,
        zoom: cam.zoom
    };
    await benchFrames(gl, 300, (i)=>{
        const phase = i / 299;
        const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
        cam.x = initial.x + (0.5 - initial.x) * t;
        cam.y = initial.y + (0.5 - initial.y) * t;
        cam.zoom = initial.zoom + (allZoom - initial.zoom) * t;
        map.draw();
    });
    cam.x = 0.5;
    cam.y = 0.5;
    cam.zoom = allZoom;
    await benchFrames(gl, 60, ()=>map.draw(), {
        prefix: 'whole_'
    });
    map.draw();
    const target = map.countTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    const counts = new Float32Array(target.w * target.h * 4);
    gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.FLOAT, counts);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let total = 0;
    for(let i = 0; i < counts.length; i += 4)total += counts[i];
    emit({
        check: 'weighted-total',
        pass: total === map.totalWeight,
        detail: `${total} / ${map.totalWeight}`
    });
    cam.x = initial.x;
    cam.y = initial.y;
    cam.zoom = initial.zoom;
    map.draw();
    const pixels = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let occupied = 0, hot = 0;
    for(let i = 0; i < pixels.length; i += 4){
        if (pixels[i] > 35) occupied++;
        if (pixels[i] > 180 && pixels[i + 1] > 70) hot++;
    }
    emit({
        check: 'visible-grid',
        pass: occupied > 1000 && hot > 10,
        detail: `occupied=${occupied}, hot=${hot}`
    });
    map.setCellSize(10);
    const small = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, small);
    map.setCellSize(40);
    const large = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, large);
    let changed = 0;
    for(let i = 0; i < small.length; i += 16)if (small[i] !== large[i]) changed++;
    emit({
        check: 'cell-size-changes-screen',
        pass: changed > 1000,
        detail: `${changed} sampled pixels changed`
    });
    map.setCellSize(20);
    emit({
        done: true
    });
}
