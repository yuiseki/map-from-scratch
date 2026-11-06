import { emit, glRenderer, benchFrames, zoomPath } from '../../harness/page/bench.js';
import { equalEarth } from '../../tools/geo.js';
export async function run(map, mounted) {
    const { gl, cam } = map;
    const canvas = gl.canvas;
    canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webgl context lost'
        }));
    const t0 = performance.now();
    map.draw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    emit({
        metric: 'first_frame_ms',
        value: mounted + performance.now() - t0
    });
    emit({
        info: {
            gpu: glRenderer(gl),
            vertices: map.vertices,
            triangles: map.triangles
        }
    });
    const world = (lon, lat)=>{
        const [x, y] = equalEarth([
            lon,
            lat
        ]);
        return [
            (x + 2.7066) / (2 * 2.7066),
            (1.3174 - y) / (2 * 1.3174)
        ];
    };
    const [jx, jy] = world(138, 37);
    const path = zoomPath(300, {
        cx: jx,
        cy: jy,
        z0: 1,
        z1: 32,
        pan: 0.002
    });
    await benchFrames(gl, path.length, (i)=>{
        cam.x = path[i].cx;
        cam.y = path[i].cy;
        cam.zoom = path[i].zoom;
        map.draw();
    });
    cam.x = 0.5;
    cam.y = 0.5;
    cam.zoom = 1;
    map.draw();
    const tap = [];
    let seed = 7;
    const rnd = ()=>(seed = seed * 16807 % 2147483647) / 2147483647;
    for(let i = 0; i < 200; i++){
        const t0 = performance.now();
        map.pick(rnd() * canvas.width, rnd() * canvas.height);
        tap.push(performance.now() - t0);
    }
    emit({
        metric: 'pick_ms',
        values: tap
    });
    const where = [
        [
            'pick-tokyo',
            139.7,
            35.7,
            'JPN'
        ],
        [
            'pick-paris',
            2.35,
            48.86,
            'FRA'
        ],
        [
            'pick-brasilia',
            -47.9,
            -15.8,
            'BRA'
        ],
        [
            'pick-pacific',
            -150,
            0,
            null
        ]
    ];
    for (const [check, lon, lat, want] of where){
        const [x, y] = world(lon, lat);
        const sx = (x - cam.x) * cam.zoom * canvas.width + canvas.width / 2;
        const sy = (y - cam.y) * cam.zoom * canvas.width * (1.3174 / 2.7066) + canvas.height / 2;
        const id = map.pick(sx, sy);
        const got = id < 0 ? null : map.countries[id][0];
        emit({
            check,
            pass: got === want,
            detail: String(got)
        });
    }
    cam.x = jx;
    cam.y = jy;
    cam.zoom = 6;
    map.select(map.countries.findIndex((c)=>c[0] === 'JPN'));
    map.draw();
    emit({
        done: true
    });
}
