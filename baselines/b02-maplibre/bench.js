import { emit, glRenderer, benchFrames, zoomPath } from '../../harness/page/bench.js';
export async function run(map, Z0, idle) {
    const gl = map.getCanvas().getContext('webgl2');
    emit({
        metric: 'first_frame_ms',
        value: idle
    });
    emit({
        info: {
            gpu: glRenderer(gl),
            maplibre: maplibregl.getVersion()
        }
    });
    const path = zoomPath(300, {
        cx: 138,
        cy: 37,
        z0: 0,
        z1: 5,
        pan: 0.5
    });
    const cam = (p)=>({
            center: [
                p.cx,
                p.cy
            ],
            zoom: Z0 + p.zoom
        });
    await benchFrames(gl, path.length, (i)=>{
        map.jumpTo(cam(path[i]));
        map.redraw();
    }, {
        prefix: 'cold_'
    });
    await benchFrames(gl, path.length, (i)=>{
        map.jumpTo(cam(path[i]));
        map.redraw();
    });
    const settle = [];
    for (const z of [
        0.5,
        1.5,
        2.5,
        3.5,
        4.5
    ]){
        map.jumpTo({
            center: [
                0,
                0
            ],
            zoom: Z0
        });
        await new Promise((r)=>map.once('idle', r));
        const t0 = performance.now();
        map.jumpTo({
            center: [
                138,
                37
            ],
            zoom: Z0 + z
        });
        await new Promise((r)=>map.once('idle', r));
        settle.push(performance.now() - t0);
    }
    emit({
        metric: 'settle_ms',
        values: settle
    });
    map.jumpTo({
        center: [
            0,
            0
        ],
        zoom: Z0
    });
    await new Promise((r)=>map.once('idle', r));
    const tap = [];
    let seed = 7;
    const rnd = ()=>(seed = seed * 16807 % 2147483647) / 2147483647;
    for(let i = 0; i < 200; i++){
        const t0 = performance.now();
        map.queryRenderedFeatures([
            rnd() * innerWidth,
            rnd() * innerHeight
        ], {
            layers: [
                'fill'
            ]
        });
        tap.push(performance.now() - t0);
    }
    emit({
        metric: 'pick_ms',
        values: tap
    });
    const jp = map.queryRenderedFeatures(map.project([
        139.7,
        35.7
    ]), {
        layers: [
            'fill'
        ]
    })[0];
    emit({
        check: 'pick-tokyo',
        pass: jp?.properties.code === 'JPN',
        detail: String(jp?.properties.code)
    });
    map.jumpTo({
        center: [
            138,
            37
        ],
        zoom: Z0 + Math.log2(6)
    });
    await new Promise((r)=>map.once('idle', r));
    emit({
        done: true
    });
}
