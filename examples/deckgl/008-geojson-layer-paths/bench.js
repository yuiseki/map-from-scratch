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
            roads: map.roadCount,
            segments: map.segmentCount,
            years: 26
        }
    });
    emit({
        check: 'all-roads-loaded',
        pass: map.roadCount === 20592,
        detail: String(map.roadCount)
    });
    emit({
        check: 'all-segments-loaded',
        pass: map.segmentCount === 272317,
        detail: String(map.segmentCount)
    });
    const initial = {
        x: map.centerX,
        y: map.centerY,
        zoom: map.zoom
    };
    await benchFrames(gl, 240, (i)=>{
        const t = i / 239;
        map.zoom = 4 + 2 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
        map.centerX = initial.x + 200000 * Math.sin(t * Math.PI * 2);
        map.centerY = initial.y + 100000 * Math.sin(t * Math.PI * 4);
        map.draw();
    });
    Object.assign(map, {
        centerX: initial.x,
        centerY: initial.y,
        zoom: initial.zoom
    });
    await benchFrames(gl, 60, ()=>map.draw(), {
        prefix: 'whole_'
    });
    const pixels = ()=>{
        map.draw();
        const out = new Uint8Array(map.canvas.width * map.canvas.height * 4);
        gl.readPixels(0, 0, map.canvas.width, map.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return out;
    };
    const old = pixels();
    let colored = 0;
    for(let i = 0; i < old.length; i += 4)if (old[i] > 25 && old[i + 1] > 50) colored++;
    emit({
        check: 'visible-highways',
        pass: colored > 1000,
        detail: `${colored} colored pixels`
    });
    const timings = [];
    const onePixel = new Uint8Array(4);
    for(let y = 1991; y <= 2015; y++){
        const started = performance.now();
        map.setYear(y, false);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, onePixel);
        timings.push(performance.now() - started);
    }
    emit({
        metric: 'year_update_ms',
        values: timings
    });
    const newer = pixels();
    let changed = 0;
    for(let i = 0; i < old.length; i += 16)if (old[i] !== newer[i] || old[i + 1] !== newer[i + 1]) changed++;
    emit({
        check: 'year-changes-screen',
        pass: changed > 1000,
        detail: `${changed} changed samples`
    });
    map.setYear(1990, false);
    map.centerX = map.sampleX;
    map.centerY = map.sampleY;
    map.zoom = 8;
    map.draw();
    const rect = map.canvas.getBoundingClientRect();
    let picked = null;
    const pickTimings = [];
    for (const dy of [
        0,
        -1,
        1,
        -2,
        2,
        3,
        4,
        5,
        6,
        7
    ]){
        const started = performance.now();
        const result = map.pick(rect.left + rect.width / 2, rect.top + rect.height / 2 + dy);
        pickTimings.push(performance.now() - started);
        picked ??= result;
    }
    emit({
        metric: 'pick_ms',
        values: pickTimings
    });
    emit({
        check: 'pick-road-stats',
        pass: !!picked && Number.isInteger(picked.incidents) && Number.isInteger(picked.fatalities),
        detail: picked ? String(picked.road) : 'none'
    });
    Object.assign(map, {
        centerX: initial.x,
        centerY: initial.y,
        zoom: initial.zoom
    });
    map.draw();
    emit({
        done: true
    });
}
