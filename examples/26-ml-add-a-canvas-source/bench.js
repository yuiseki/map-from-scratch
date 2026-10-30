import { emit } from '../../harness/page/bench.js';
const raf = ()=>new Promise(requestAnimationFrame);
export async function run(el, map, overlay, corners, animFrames) {
    map.base.addEventListener('contextlost', ()=>emit({
            error: 'canvas context lost'
        }));
    await raf();
    await raf();
    emit({
        metric: 'first_frame_ms',
        value: performance.now()
    });
    const gaps = async (n, work)=>{
        const out = [];
        let last = await raf();
        for(let i = 0; i < n; i++){
            work(i);
            const t = await raf();
            out.push(t - last);
            last = t;
        }
        return out;
    };
    const r0 = map.redraws, a0 = animFrames();
    emit({
        metric: 'anim_frame_interval_ms',
        values: await gaps(240, ()=>{})
    });
    emit({
        metric: 'map_redraws_while_animating',
        value: map.redraws - r0
    });
    emit({
        info: {
            animation_frames: animFrames() - a0
        }
    });
    const redraw = [];
    const k = ()=>512 * 2 ** map.cam.z;
    emit({
        metric: 'pan_frame_interval_ms',
        values: await gaps(240, (i)=>{
            map.cam.x += (i < 120 ? 6 : -6) / k();
            const t0 = performance.now();
            map.draw();
            redraw.push(performance.now() - t0);
        })
    });
    emit({
        metric: 'zoom_frame_interval_ms',
        values: await gaps(240, (i)=>{
            const t = i / 240;
            map.cam.z = t < 0.25 ? 5 - 4 * t : t < 0.75 ? 4 + 8 * (t - 0.25) : 8 - 12 * (t - 0.75);
            const t0 = performance.now();
            map.draw();
            redraw.push(performance.now() - t0);
        })
    });
    emit({
        metric: 'redraw_ms',
        values: redraw
    });
    map.view(95.899147, 18.088694, 5);
    const paced = [];
    let last = await raf();
    for(let i = 0; i < 240; i++){
        const wait = last + 1000 / 60 - performance.now();
        if (wait > 0) await new Promise((r)=>setTimeout(r, wait));
        map.cam.x += (i < 120 ? 6 : -6) / k();
        map.draw();
        const t = await raf();
        paced.push(t - last);
        last = t;
    }
    emit({
        metric: 'pan_60hz_frame_interval_ms',
        values: paced
    });
    emit({
        info: {
            timer_resolution_isolated: crossOriginIsolated,
            dpr: devicePixelRatio
        }
    });
    const box = el.getBoundingClientRect();
    const views = [
        [
            95.899147,
            18.088694,
            5
        ],
        [
            96,
            18,
            4
        ],
        [
            97,
            17,
            7.3
        ],
        [
            96 + 360,
            18,
            6
        ]
    ];
    let worst = 0;
    const detail = [];
    for (const [lon, lat, z] of views){
        map.view(lon, lat, z);
        await raf();
        const r = overlay.getBoundingClientRect();
        const tl = map.project(corners[0][0], corners[0][1]), br = map.project(corners[2][0], corners[2][1]);
        const err = Math.max(Math.abs(r.left - box.left - tl[0]), Math.abs(r.top - box.top - tl[1]), Math.abs(r.right - box.left - br[0]), Math.abs(r.bottom - box.top - br[1]));
        worst = Math.max(worst, err);
        detail.push(`z${z} ${err.toFixed(3)}px`);
    }
    emit({
        check: 'overlay-on-corners',
        pass: worst < 0.5,
        detail: detail.join(', ')
    });
    map.view(95.899147, 18.088694, 5);
    const ctx = map.base.getContext('2d');
    const px = (lon, lat)=>{
        const [x, y] = map.project(lon, lat);
        return [
            ...ctx.getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data.slice(0, 3)
        ];
    };
    const hex = (c)=>[
            1,
            3,
            5
        ].map((i)=>parseInt(c.slice(i, i + 2), 16));
    const near = (a, b)=>a.every((v, i)=>Math.abs(v - b[i]) <= 3);
    const probes = [
        [
            'sea (Andaman Sea)',
            96.5,
            12.0,
            '#D8F2FF'
        ],
        [
            'Myanmar (Kachin)',
            97.5,
            25.5,
            '#EAB38F'
        ],
        [
            'Thailand (Isan)',
            103.0,
            16.0,
            '#98DDA1'
        ]
    ];
    const got = probes.map(([name, lon, lat, want])=>({
            name,
            want,
            got: px(lon, lat),
            ok: near(px(lon, lat), hex(want))
        }));
    emit({
        check: 'basemap-colours',
        pass: got.every((g)=>g.ok),
        detail: got.map((g)=>`${g.name} ${g.got.join(',')} want ${g.want}`).join('; ')
    });
    const o = overlay.getContext('2d');
    const a = o.getImageData(0, 0, 400, 400).data;
    await raf();
    await raf();
    const b = o.getImageData(0, 0, 400, 400).data;
    let changed = 0;
    for(let i = 3; i < a.length; i += 4)if (a[i] !== b[i]) changed++;
    emit({
        check: 'overlay-animates',
        pass: changed > 0,
        detail: `${changed} pixels changed in 2 frames`
    });
    emit({
        done: true
    });
}
