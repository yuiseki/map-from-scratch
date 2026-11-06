import { emit, glRenderer } from '../../../harness/page/bench.js';
import { groundAt, summitWorld } from './terrain.js';
import { RATE } from './rigs.js';
export async function run(scene, firstFrameMs) {
    const { canvas, gl } = scene;
    canvas.addEventListener('contextlost', ()=>emit({
            error: 'canvas context lost'
        }));
    const raf = ()=>new Promise(requestAnimationFrame);
    await raf();
    await raf();
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    emit({
        metric: 'rig_bake_ms',
        value: scene.bakeMs
    });
    emit({
        info: {
            gpu: glRenderer(gl)
        }
    });
    const r = scene.relief;
    const dpr = scene.dpr;
    const pixel = (x, y)=>{
        const out = new Uint8Array(4);
        gl.readPixels(Math.round(x * dpr), Math.round(canvas.height - 1 - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return [
            ...out
        ];
    };
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const report = [];
    let worst = Infinity;
    for (const a of scene.animations){
        let min = Infinity;
        for(let i = 0; i < a.frames; i++){
            const s = a.samples;
            min = Math.min(min, s[i * 6 + 2] - groundAt(r, s[i * 6], s[i * 6 + 1]) - a.rig.clearance);
        }
        worst = Math.min(worst, min);
        report.push(`${a.rig.name}: ${a.raised}/${a.frames} lifted, margin ${min.toFixed(1)} m`);
    }
    const rail = scene.animations.find((a)=>a.rig.name === 'rail');
    emit({
        check: 'clearance-holds',
        pass: worst >= -0.01 && rail.raised > 0,
        detail: report.join('; ')
    });
    const summit = summitWorld(r);
    const orbit = scene.animations[0];
    const phi = (i)=>(Math.atan2(orbit.samples[i * 6] - summit[0], orbit.samples[i * 6 + 1] - summit[1]) * 180 / Math.PI + 360) % 360;
    const counts = scene.animations.every((a)=>a.frames === Math.round(a.rig.duration * RATE) + 1);
    emit({
        check: 'orbit-baked-at-60hz',
        pass: counts && Math.abs(phi(0) - 20) < 0.1 && Math.abs(phi(orbit.frames - 1) - 320) < 0.1,
        detail: `frames ${scene.animations.map((a)=>a.frames).join('/')}; orbit phi ${phi(0).toFixed(1)} -> ${phi(orbit.frames - 1).toFixed(1)}`
    });
    scene.choose(1);
    let off = 0, onGround = 0, drawn = 0;
    for(let k = 0; k <= 10; k++){
        scene.seek((scene.animation.frames - 1) * k / 10);
        const s = scene.animation.samples, i = scene.frame * 6;
        const target = [
            s[i + 3],
            s[i + 4],
            s[i + 5]
        ];
        const p = scene.screenOf(target);
        off = Math.max(off, Math.hypot(p[0] - w / 2, p[1] - h / 2));
        if (Math.abs(target[2] - groundAt(r, target[0], target[1])) < 1) onGround++;
        if (pixel(w / 2, h / 2)[3] > 200) drawn++;
    }
    emit({
        check: 'follow-keeps-the-target',
        pass: off < 1 && onGround === 11 && drawn === 11,
        detail: `target at most ${off.toFixed(2)} px from centre; on the ground ${onGround}/11; drawn ${drawn}/11`
    });
    scene.choose(2);
    const probe = ()=>[
            [
                w * 0.3,
                h * 0.6
            ],
            [
                w * 0.5,
                h * 0.5
            ],
            [
                w * 0.7,
                h * 0.7
            ]
        ].map(([x, y])=>pixel(x, y).join(',')).join(' ');
    scene.seek(200);
    const a1 = probe();
    scene.seek(400);
    const a2 = probe();
    scene.seek(200);
    emit({
        check: 'scrub-is-repeatable',
        pass: probe() === a1 && a1 !== a2,
        detail: `frame 200 [${a1}] vs frame 400 [${a2}]`
    });
    const thumbs = [
        ...document.querySelectorAll('canvas[data-phi]')
    ].map((c)=>{
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let sum = 0, opaque = 0;
        for(let i = 0; i < d.length; i += 4){
            sum += d[i] + 2 * d[i + 1] + 3 * d[i + 2];
            if (d[i + 3] > 200) opaque++;
        }
        return {
            sum,
            opaque: opaque / (d.length / 4)
        };
    });
    const distinct = new Set(thumbs.map((t)=>t.sum)).size;
    emit({
        check: 'film-strip-drawn',
        pass: thumbs.length === 3 && thumbs.every((t)=>t.opaque > 0.3) && distinct === 3,
        detail: thumbs.map((t)=>`${(t.opaque * 100).toFixed(0)}% terrain`).join(', ')
    });
    scene.choose(0);
    const before = probe();
    const intervals = [], redraw = [];
    scene.play(true);
    const t0 = await raf();
    let last = t0;
    while(last - t0 < 1000 && scene.playing){
        const now = await raf();
        intervals.push(now - last);
        redraw.push(scene.drawMs);
        last = now;
    }
    const elapsed = last - t0, frame = scene.frame;
    scene.play(false);
    const expected = elapsed / 1000 * RATE;
    emit({
        check: 'playback-follows-the-clock',
        pass: Math.abs(frame - expected) <= 4 && probe() !== before,
        detail: `frame ${frame} after ${elapsed.toFixed(0)} ms (clock says ${expected.toFixed(1)})`
    });
    emit({
        metric: 'redraw_ms',
        values: redraw
    });
    emit({
        metric: 'frame_interval_ms',
        values: intervals
    });
    emit({
        done: true
    });
}
