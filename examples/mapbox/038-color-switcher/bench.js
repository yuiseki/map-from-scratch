import { emit } from '../../../harness/page/bench.js';
const EXPECTED = {
    blue: {
        ocean: [
            170,
            211,
            223
        ],
        land: [
            240,
            238,
            232
        ],
        highlight: [
            0,
            136,
            136
        ]
    },
    dark: {
        ocean: [
            20,
            35,
            46
        ],
        land: [
            65,
            80,
            92
        ],
        highlight: [
            232,
            89,
            12
        ]
    },
    sunset: {
        ocean: [
            247,
            217,
            184
        ],
        land: [
            255,
            243,
            226
        ],
        highlight: [
            179,
            18,
            92
        ]
    }
};
const OCEAN = [
    -30,
    0
];
const LAND = [
    -100,
    40
];
const HIGHLIGHT = [
    -60,
    -8
];
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
export async function run(map, firstFrameMs) {
    const { canvas, ctx } = map;
    canvas.addEventListener('contextlost', ()=>emit({
            error: 'canvas context lost'
        }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const dpr = window.devicePixelRatio || 1;
    const rgba = (x, y)=>Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
    const fmt = (p)=>`rgb(${p[0]},${p[1]},${p[2]})`;
    const near = (p, q)=>Math.abs(p[0] - q[0]) <= 2 && Math.abs(p[1] - q[1]) <= 2 && Math.abs(p[2] - q[2]) <= 2;
    const screenPos = (lon, lat)=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const c = map.center;
        return [
            canvas.clientWidth / 2 + (mercX(lon) - c[0]) * scale,
            canvas.clientHeight / 2 + (mercY(lat) - c[1]) * scale
        ];
    };
    const samples = ()=>{
        const o = rgba(...screenPos(...OCEAN));
        const l = rgba(...screenPos(...LAND));
        const h = rgba(...screenPos(...HIGHLIGHT));
        return {
            o,
            l,
            h,
            text: `${fmt(o)} / ${fmt(l)} / ${fmt(h)}`
        };
    };
    const matches = (id)=>{
        const s = samples();
        const e = EXPECTED[id];
        return near(s.o, e.ocean) && near(s.l, e.land) && near(s.h, e.highlight);
    };
    const click = (id)=>{
        document.getElementById(`palette-${id}`).click();
    };
    emit({
        check: 'default-palette-blue',
        pass: map.palette === 'blue' && matches('blue'),
        detail: `palette ${map.palette}, ${samples().text}`
    });
    click('dark');
    emit({
        check: 'dark-palette-applied',
        pass: map.palette === 'dark' && matches('dark'),
        detail: `palette ${map.palette}, ${samples().text}`
    });
    click('sunset');
    emit({
        check: 'sunset-palette-applied',
        pass: map.palette === 'sunset' && matches('sunset'),
        detail: `palette ${map.palette}, ${samples().text}`
    });
    map.panBy(60, 40);
    emit({
        check: 'palette-persists-on-pan',
        pass: map.palette === 'sunset' && matches('sunset'),
        detail: `after (60,40) pan, ${samples().text}`
    });
    map.setZoom(3.5);
    emit({
        check: 'palette-anchors-on-zoom',
        pass: map.zoom === 3.5 && map.palette === 'sunset' && matches('sunset'),
        detail: `zoom ${map.zoom}, ${samples().text}`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.panBy(Math.sin(i * 0.1) * 2, Math.cos(i * 0.1) * 2);
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
    document.getElementById('palette-blue').click();
    map.resetView();
    emit({
        done: true
    });
}
