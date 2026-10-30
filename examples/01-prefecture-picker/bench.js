import { emit } from '../../harness/page/bench.js';
export async function run(el, map) {
    const canvas = el.querySelector('canvas');
    canvas.addEventListener('contextlost', ()=>emit({
            error: 'canvas context lost'
        }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: performance.now()
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const gaps = async (n, work)=>{
        const out = [];
        let last = performance.now();
        for(let i = 0; i < n; i++){
            work(i);
            await raf();
            const t = performance.now();
            out.push(t - last);
            last = t;
        }
        return out;
    };
    await raf();
    emit({
        metric: 'idle_frame_interval_ms',
        values: await gaps(120, ()=>{})
    });
    const redraw = [];
    emit({
        metric: 'frame_interval_ms',
        values: await gaps(240, (i)=>{
            const t0 = performance.now();
            map.setHover(i % map.prefs.length);
            redraw.push(performance.now() - t0);
        })
    });
    emit({
        metric: 'redraw_ms',
        values: redraw
    });
    const r = el.getBoundingClientRect();
    let seed = 1;
    const rnd = ()=>(seed = seed * 16807 % 2147483647) / 2147483647;
    const pick = [];
    let hits = 0;
    for(let i = 0; i < 2000; i++){
        const x = rnd() * r.width, y = rnd() * r.height;
        const t0 = performance.now();
        if (map.pick(x, y) >= 0) hits++;
        pick.push(performance.now() - t0);
    }
    emit({
        metric: 'pick_ms',
        values: pick
    });
    emit({
        info: {
            hit_ratio: hits / 2000,
            prefectures: map.prefs.length,
            timer_resolution_isolated: crossOriginIsolated
        }
    });
    map.setHover(-1);
    const tokyo = map.prefs.findIndex((p)=>p.code === 'JP-13');
    let at = null;
    for(let y = 0; y < r.height && !at; y += 2)for(let x = 0; x < r.width && !at; x += 2)if (map.pick(x, y) === tokyo) at = [
        x,
        y
    ];
    if (!at) throw new Error('no point inside Tokyo found');
    const got = new Promise((res)=>el.addEventListener('prefecture', (e)=>res(e.detail.code), {
            once: true
        }));
    canvas.dispatchEvent(new MouseEvent('click', {
        clientX: r.left + at[0],
        clientY: r.top + at[1],
        bubbles: true
    }));
    const code = await got;
    emit({
        check: 'click-tokyo',
        pass: code === 'JP-13',
        detail: code
    });
    emit({
        done: true
    });
}
