import { emit, benchFramesGpu } from '../../../harness/page/bench.js';
export async function runBench(map, firstFrameMs) {
    const { canvas } = map;
    await new Promise(requestAnimationFrame);
    emit({
        info: {
            gpu: map.gpu
        }
    });
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    emit({
        check: 'roads-loaded',
        pass: map.nodeCount === 87904 && map.roadCount === 11238,
        detail: `roads = ${map.roadCount}, nodes = ${map.nodeCount}, segments = ${map.segmentCount}`
    });
    const initialUploads = map.uploadCount;
    map.zoomBy(0.5);
    map.panBy(20, 20);
    map.zoomBy(-0.5);
    map.panBy(-20, -20);
    const uploadsAfter = map.uploadCount;
    emit({
        check: 'static-gpu-buffers',
        pass: initialUploads === 1 && uploadsAfter === 1,
        detail: `uploadCount before = ${initialUploads}, after zoom & pan = ${uploadsAfter} (zero CPU tessellation / buffer rebinding)`
    });
    let renderedRoadPixels = 0;
    let sampleColor = '';
    const testCoords = [
        [
            515,
            384
        ],
        [
            512,
            380
        ],
        [
            520,
            390
        ],
        [
            500,
            370
        ],
        [
            480,
            360
        ],
        [
            550,
            400
        ],
        [
            450,
            350
        ],
        [
            600,
            420
        ],
        [
            400,
            300
        ],
        [
            512,
            450
        ],
        [
            300,
            200
        ],
        [
            700,
            500
        ],
        [
            512,
            250
        ],
        [
            512,
            550
        ],
        [
            250,
            384
        ]
    ];
    for (const [tx, ty] of testCoords){
        const px = await map.readPixel(tx, ty);
        if (px[0] > 35 || px[1] > 35 || px[2] > 40) {
            renderedRoadPixels++;
            sampleColor = `rgba(${Array.from(px).join(',')}) at (${tx}, ${ty})`;
            break;
        }
    }
    emit({
        check: 'roads-rendered',
        pass: renderedRoadPixels > 0,
        detail: sampleColor || `no road pixels found (tested ${testCoords.length} points)`
    });
    const dpr = window.devicePixelRatio || 1;
    const isRoad = (p)=>p[0] > 35 || p[1] > 35 || p[2] > 40;
    const found = [];
    for(let y = 300; y < 460 && found.length < 8; y += 9){
        for(let x = 380; x < 640 && found.length < 8; x += 9){
            if (isRoad(await map.readPixel(x * dpr, y * dpr))) found.push([
                x,
                y
            ]);
        }
    }
    map.panBy(50, 30);
    let moved = 0;
    for (const [x, y] of found)if (isRoad(await map.readPixel((x + 50) * dpr, (y + 30) * dpr))) moved++;
    emit({
        check: 'pan-updates-road-positions',
        pass: found.length === 8 && moved >= 7,
        detail: `${moved}/${found.length} road pixels found again 50 px right, 30 px down after panBy(50, 30)`
    });
    map.panBy(-50, -30);
    await benchFramesGpu(map.device, 60, (i, ts)=>{
        map.panBy(Math.sin(i * 0.1) * 3, Math.cos(i * 0.1) * 2, ts, true);
    });
    emit({
        done: true
    });
}
