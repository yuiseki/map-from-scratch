import { emit, glRenderer, benchFrames, zoomPath } from '../../harness/page/bench.js';
export async function run(map, mounted) {
    const { gl, cam } = map;
    gl.canvas.addEventListener('webglcontextlost', ()=>emit({
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
            points: map.points
        }
    });
    const [w, s, e, n] = map.bbox;
    const k = Math.cos((s + n) / 2 * Math.PI / 180), span = Math.max((e - w) * k, n - s);
    const grid = (lon, lat)=>[
            (lon - w) * k / span,
            (n - lat) / span
        ];
    const [cx, cy] = grid(139.7016, 35.658);
    const path = zoomPath(300, {
        cx,
        cy,
        z0: 1,
        z1: 256,
        pan: 0.0005
    });
    await benchFrames(gl, path.length, (i)=>{
        cam.x = path[i].cx;
        cam.y = path[i].cy;
        cam.zoom = path[i].zoom;
        map.draw();
    });
    for (const [prefix, zoom] of [
        [
            'whole_',
            1
        ],
        [
            'street_',
            256
        ]
    ]){
        cam.x = cx;
        cam.y = cy;
        cam.zoom = zoom;
        await benchFrames(gl, 60, ()=>map.draw(), {
            prefix
        });
    }
    cam.x = 0.5;
    cam.y = 0.5;
    cam.zoom = 0.9;
    map.draw();
    const t = map.countTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const px = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let sum = 0, max = 0;
    for(let i = 0; i < px.length; i += 4){
        sum += px[i];
        max = Math.max(max, px[i]);
    }
    emit({
        info: {
            counted: sum,
            max_per_pixel: max
        }
    });
    emit({
        check: 'count-conservation',
        pass: sum === map.points,
        detail: `${sum} of ${map.points}`
    });
    cam.x = cx;
    cam.y = cy;
    cam.zoom = 6;
    map.draw();
    const shown = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, shown);
    const mid = ((gl.canvas.height >> 1) * gl.canvas.width + (gl.canvas.width >> 1)) * 4;
    let brightest = 0;
    for(let i = 0; i < shown.length; i += 4)brightest = Math.max(brightest, shown[i + 1]);
    emit({
        info: {
            centre_rgb: [
                ...shown.subarray(mid, mid + 3)
            ].join(','),
            brightest_green: brightest
        }
    });
    emit({
        check: 'shibuya-not-empty',
        pass: !(shown[mid] < 20 && shown[mid + 1] < 20),
        detail: [
            ...shown.subarray(mid, mid + 3)
        ].join(',')
    });
    emit({
        check: 'ramp-reaches-bright',
        pass: brightest >= 200,
        detail: `max green ${brightest}`
    });
    emit({
        done: true
    });
}
