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
            accidents: map.points,
            cells: map.cells,
            maxCount: map.maxCount
        }
    });
    const initial = {
        ...cam
    };
    await benchFrames(gl, 300, (i)=>{
        const t = i / 299;
        cam.x = initial.x + 0.004 * Math.sin(t * Math.PI * 2);
        cam.y = initial.y + 0.003 * Math.sin(t * Math.PI * 4);
        cam.zoom = initial.zoom + 1.2 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
        cam.bearing = initial.bearing + 25 * Math.sin(t * Math.PI * 2);
        map.draw();
    });
    Object.assign(cam, initial);
    await benchFrames(gl, 60, ()=>map.draw(), {
        prefix: 'whole_'
    });
    emit({
        check: 'all-accidents-binned',
        pass: map.sumCounts() === map.points,
        detail: `${map.sumCounts()} / ${map.points}`
    });
    map.draw();
    const pixels = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let colored = 0, warm = 0;
    for(let i = 0; i < pixels.length; i += 4){
        if (pixels[i + 1] > 65) colored++;
        if (pixels[i] > 140 && pixels[i + 1] > 65) warm++;
    }
    emit({
        check: 'visible-prisms',
        pass: colored > 1000 && warm > 10,
        detail: `colored=${colored}, warm=${warm}`
    });
    const originalCells = map.cells;
    map.setRadius(1000);
    emit({
        metric: 'regroup_ms',
        value: map.aggregateMs
    });
    const smallerCells = map.cells;
    emit({
        check: 'radius-changes-bins',
        pass: smallerCells > originalCells && map.sumCounts() === map.points,
        detail: `${originalCells} -> ${smallerCells}`
    });
    map.setRadius(2000);
    map.setCoverage(0.3);
    const narrow = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, narrow);
    let changed = 0;
    for(let i = 0; i < pixels.length; i += 16)if (pixels[i] !== narrow[i]) changed++;
    emit({
        check: 'coverage-changes-screen',
        pass: changed > 1000,
        detail: `${changed} sampled pixels changed`
    });
    map.setCoverage(0.7);
    map.setUpperPercentile(75);
    emit({
        metric: 'percentile_update_ms',
        value: map.percentileMs
    });
    const clipped = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, clipped);
    changed = 0;
    for(let i = 0; i < pixels.length; i += 16)if (pixels[i] !== clipped[i]) changed++;
    emit({
        check: 'percentile-changes-screen',
        pass: changed > 1000,
        detail: `${changed} sampled pixels changed`
    });
    map.setUpperPercentile(100);
    emit({
        done: true
    });
}
