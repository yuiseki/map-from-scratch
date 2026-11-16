import { emit, glRenderer } from '../../../harness/page/bench.js';
import { worldOf } from './terrain.js';
const DEFAULT = {
    az: 49,
    el: 28,
    radius: 6000
};
export async function run(scene, firstFrameMs) {
    const { canvas, gl } = scene;
    canvas.addEventListener('contextlost', ()=>emit({
            error: 'canvas context lost'
        }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    emit({
        info: {
            gpu: glRenderer(gl)
        }
    });
    scene.draw();
    const dpr = window.devicePixelRatio || 1;
    const pixel = (xCss, yCss)=>{
        const out = new Uint8Array(4);
        const x = Math.round(xCss * dpr), y = Math.round(canvas.height - 1 - yCss * dpr);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return [
            out[0],
            out[1],
            out[2],
            out[3]
        ];
    };
    const relief = scene.relief;
    if (!relief) {
        emit({
            check: 'terrain-fills-view',
            pass: false,
            detail: 'terrain not loaded'
        });
        return;
    }
    const sky = pixel(20, 20);
    const mid = pixel(canvas.clientWidth / 2, canvas.clientHeight * 0.62);
    emit({
        check: 'terrain-fills-view',
        pass: sky[3] < 10 && mid[3] > 200,
        detail: `sky (20,20) rgba(${sky.join(',')}); terrain centre rgba(${mid.join(',')})`
    });
    const summit = scene.screenOf(relief.summitU, relief.summitV);
    let summitOk = false, summitDetail = 'summit behind the camera';
    if (summit) {
        const p = pixel(summit[0], summit[1]);
        const lum = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
        const spread = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
        summitOk = p[3] > 200 && lum > 90 && spread < 30;
        summitDetail = `summit (${summit[0].toFixed(0)}, ${summit[1].toFixed(0)}) rgba(${p.join(',')}) lum=${lum.toFixed(0)} spread=${spread}`;
    }
    emit({
        check: 'summit-is-snow',
        pass: summitOk,
        detail: summitDetail
    });
    const summitW = worldOf(relief, relief.summitU, relief.summitV);
    const azRad = scene.camera.az * Math.PI / 180;
    let low = null;
    for(let v = 0.02; v < 0.98; v += 0.01){
        for(let u = 0.02; u < 0.98; u += 0.01){
            const w = worldOf(relief, u, v);
            const dx = w[0] - summitW[0], dy = w[1] - summitW[1];
            const d = Math.hypot(dx, dy);
            if (d < 1200 || d > 4000) continue;
            const bearing = Math.atan2(dx, dy);
            const off = Math.abs((bearing - azRad + Math.PI * 3) % (Math.PI * 2) - Math.PI);
            if (off > Math.PI / 4) continue;
            const s = scene.screenOf(u, v);
            if (!s || s[0] < 20 || s[0] > canvas.clientWidth - 20 || s[1] < 20 || s[1] > canvas.clientHeight - 20) continue;
            if (!low || w[2] < low.h) low = {
                u,
                v,
                h: w[2],
                x: s[0],
                y: s[1]
            };
        }
    }
    let aboveOk = false, aboveDetail = 'no valley in frame within 1.2-4 km toward the camera';
    if (low && summit) {
        const drop = low.y - summit[1];
        aboveOk = drop > 6 && pixel(low.x, low.y)[3] > 200;
        aboveDetail = `summit y=${summit[1].toFixed(0)}, valley ${low.h.toFixed(0)} m at (${low.x.toFixed(0)}, ${low.y.toFixed(0)}) drop=${drop.toFixed(0)} px`;
    }
    emit({
        check: 'summit-stands-above-valley',
        pass: aboveOk,
        detail: aboveDetail
    });
    const du4 = 2000 / ((relief.width - 1) * relief.cellM);
    const probe0 = scene.screenOf(relief.summitU + du4, relief.summitV);
    scene.setCamera({
        az: scene.camera.az + 60
    });
    scene.draw();
    const probe1 = scene.screenOf(relief.summitU + du4, relief.summitV);
    const centre = pixel(canvas.clientWidth / 2, canvas.clientHeight * 0.62);
    const shifted = probe0 && probe1 ? Math.abs(probe1[0] - probe0[0]) : 0;
    emit({
        check: 'orbit-moves-terrain',
        pass: !!probe0 && !!probe1 && shifted > 40 && centre[3] > 200,
        detail: `east probe x ${probe0 ? probe0[0].toFixed(0) : 'off'} -> ${probe1 ? probe1[0].toFixed(0) : 'off'} (+60° az); centre alpha ${centre[3]}`
    });
    const du = 1500 / ((relief.width - 1) * relief.cellM);
    const separation = ()=>{
        const a = scene.screenOf(relief.summitU, relief.summitV);
        const b = scene.screenOf(relief.summitU + du, relief.summitV);
        return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0;
    };
    scene.setCamera({
        az: DEFAULT.az,
        el: DEFAULT.el,
        radius: 9000
    });
    scene.draw();
    const d9 = separation();
    scene.setCamera({
        radius: 5000
    });
    scene.draw();
    const d5 = separation();
    emit({
        check: 'zoom-changes-scale',
        pass: d9 > 0 && d5 / d9 > 1.5,
        detail: `1.5 km spans ${d9.toFixed(1)} px at r=9 km, ${d5.toFixed(1)} px at r=5 km (ratio ${(d5 / d9).toFixed(2)})`
    });
    scene.setCamera(DEFAULT);
    scene.draw();
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        scene.setCamera({
            az: scene.camera.az + 1
        });
        scene.draw();
        redrawTimes.push(performance.now() - t0);
        const now = await raf();
        frameIntervals.push(now - last);
        last = now;
    }
    emit({
        metric: 'redraw_ms',
        values: redrawTimes
    });
    emit({
        metric: 'frame_interval_ms',
        values: frameIntervals
    });
    emit({
        done: true
    });
}
