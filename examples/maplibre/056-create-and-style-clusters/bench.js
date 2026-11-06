import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.js';
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
            earthquakes: map.count,
            clusters: map.clusters
        }
    });
    emit({
        check: 'all-earthquakes-accounted',
        pass: map.sumCounts() === map.count,
        detail: `${map.sumCounts()} / ${map.count}`
    });
    const initial = {
        ...cam
    };
    await benchFrames(gl, 300, (i)=>{
        const t = i / 299;
        cam.x = initial.x + 0.025 * Math.sin(t * Math.PI * 2);
        cam.y = initial.y + 0.018 * Math.sin(t * Math.PI * 2);
        cam.zoom = initial.zoom + 3 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
        map.draw();
    });
    Object.assign(cam, initial);
    map.draw();
    const pixels = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let circles = 0, highlighted = 0;
    for(let i = 0; i < pixels.length; i += 4){
        if (pixels[i + 1] > 100 && pixels[i + 2] > 100) circles++;
        if (pixels[i] > 170 && pixels[i + 1] > 100) highlighted++;
    }
    emit({
        check: 'visible-clusters',
        pass: circles > 500 && highlighted > 10,
        detail: `colored=${circles}, warm=${highlighted}`
    });
    const before = map.clusters;
    const large = map.levels[3].find((c)=>c.count > 10);
    if (!large) throw new Error('no large cluster');
    map.expand(large);
    emit({
        check: 'cluster-click-expands',
        pass: cam.zoom > 3 && map.clusters > before && map.sumCounts() === map.count,
        detail: `zoom=${cam.zoom}, clusters=${before}->${map.clusters}`
    });
    emit({
        metric: 'cluster_upload_ms',
        value: map.uploadMs
    });
    cam.zoom = 15;
    map.draw();
    emit({
        check: 'individual-earthquakes-at-high-zoom',
        pass: map.clusters === map.count && map.sumCounts() === map.count,
        detail: `${map.clusters} individual points`
    });
    Object.assign(cam, initial);
    map.draw();
    emit({
        done: true
    });
}
