import { emit, glRenderer } from '../../../harness/page/bench.js';
const DEFAULT = {
    az: 18,
    el: 36,
    radius: 26000
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
    const relief = scene.relief;
    const dpr = scene.dpr;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const terrainPixel = (x, y)=>{
        const out = new Uint8Array(4);
        gl.readPixels(Math.round(x * dpr), Math.round(canvas.height - 1 - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return [
            ...out
        ];
    };
    const labelPixel = (x, y)=>[
            ...scene.ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data
        ];
    const placedNamed = (plan, name)=>plan.placed.find((p)=>p.label.name === name);
    const reasonOf = (plan, name)=>plan.rejected.find((r)=>r.label.name === name)?.reason ?? 'placed';
    scene.setCamera(DEFAULT);
    scene.draw();
    const sky = terrainPixel(w / 2, 4);
    const mid = terrainPixel(w / 2, h * 0.6);
    emit({
        check: 'terrain-fills-view',
        pass: sky[3] < 10 && mid[3] > 200,
        detail: `sky rgba(${sky}); centre rgba(${mid})`
    });
    const plan0 = scene.plan;
    const reasons = {};
    for (const r of plan0.rejected)reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    emit({
        check: 'every-label-accounted',
        pass: plan0.placed.length + plan0.rejected.length === scene.labels.length && plan0.placed.length >= 10,
        detail: `${plan0.placed.length} placed, rejected ${JSON.stringify(reasons)} of ${scene.labels.length}`
    });
    const summit = placedNamed(plan0, '富士山');
    const summitAt = scene.screenOf(relief.summitU, relief.summitV, 20);
    let summitOk = false, summitDetail = 'summit label not placed';
    if (summit && summitAt) {
        const err = Math.hypot(summit.anchor[0] - summitAt[0], summit.anchor[1] - summitAt[1]);
        const dot = labelPixel(summit.anchor[0], summit.anchor[1]);
        summitOk = err < 0.5 && dot[3] > 200 && dot[0] > 150 && dot[1] < 80;
        summitDetail = `anchor ${summit.anchor.map((v)=>v.toFixed(1))} vs summit ${summitAt.map((v)=>v.toFixed(1))} (err ${err.toFixed(2)} px); dot rgba(${dot})`;
    }
    emit({
        check: 'summit-label-on-summit',
        pass: summitOk,
        detail: summitDetail
    });
    let overlap = 0, blank = 0;
    for(let i = 0; i < plan0.placed.length; i++){
        const a = plan0.placed[i].box;
        for(let j = i + 1; j < plan0.placed.length; j++){
            const b = plan0.placed[j].box;
            if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) overlap++;
        }
        const img = scene.ctx.getImageData(Math.round(a.x0 * dpr), Math.round(a.y0 * dpr), Math.max(1, Math.round((a.x1 - a.x0) * dpr)), Math.max(1, Math.round((a.y1 - a.y0) * dpr))).data;
        let ink = 0;
        for(let k = 3; k < img.length; k += 4)if (img[k] > 200) ink++;
        if (ink < 20) blank++;
    }
    emit({
        check: 'labels-do-not-overlap',
        pass: overlap === 0 && blank === 0,
        detail: `${plan0.placed.length} placed, ${overlap} overlapping pairs, ${blank} without ink`
    });
    scene.setCamera({
        az: 0,
        el: 10,
        radius: 22000
    });
    scene.draw();
    const fromNorth = reasonOf(scene.plan, '富士宮口五合目');
    scene.setCamera({
        az: 180,
        el: 10,
        radius: 22000
    });
    scene.draw();
    const fromSouth = reasonOf(scene.plan, '富士宮口五合目');
    emit({
        check: 'far-side-occluded',
        pass: fromNorth === 'occluded' && fromSouth !== 'occluded',
        detail: `Fujinomiya 5th Station from the north: ${fromNorth}; from the south: ${fromSouth}`
    });
    scene.setCamera(DEFAULT);
    scene.draw();
    const key = (p)=>JSON.stringify(p.placed.map((x)=>[
                x.label.name,
                x.side,
                x.anchor.map((v)=>v.toFixed(2))
            ]));
    const k1 = key(scene.plan);
    scene.setCamera({
        az: DEFAULT.az + 90
    });
    scene.draw();
    scene.setCamera(DEFAULT);
    scene.draw();
    emit({
        check: 'plan-is-deterministic',
        pass: k1 === key(scene.plan),
        detail: `${scene.plan.placed.length} placed both times`
    });
    const name = '須走五合目';
    const before = placedNamed(scene.plan, name);
    scene.setCamera({
        az: DEFAULT.az + 40
    });
    scene.draw();
    const after = placedNamed(scene.plan, name);
    const moved = before && after ? Math.hypot(after.anchor[0] - before.anchor[0], after.anchor[1] - before.anchor[1]) : 0;
    const dotAfter = after ? labelPixel(after.anchor[0], after.anchor[1]) : [
        0,
        0,
        0,
        0
    ];
    emit({
        check: 'labels-follow-orbit',
        pass: moved > 30 && dotAfter[3] > 200,
        detail: `${name} moved ${moved.toFixed(0)} px for +40° azimuth; dot alpha ${dotAfter[3]}`
    });
    scene.setCamera(DEFAULT);
    scene.draw();
    const raf = ()=>new Promise(requestAnimationFrame);
    const redraw = [], plans = [], intervals = [];
    let last = await raf();
    for(let i = 0; i < 120; i++){
        scene.setCamera({
            az: scene.camera.az + 1
        });
        scene.draw();
        redraw.push(scene.drawMs);
        plans.push(scene.planMs);
        const now = await raf();
        intervals.push(now - last);
        last = now;
    }
    emit({
        metric: 'redraw_ms',
        values: redraw
    });
    emit({
        metric: 'label_ms',
        values: plans
    });
    emit({
        metric: 'frame_interval_ms',
        values: intervals
    });
    scene.setCamera(DEFAULT);
    scene.draw();
    emit({
        done: true
    });
}
