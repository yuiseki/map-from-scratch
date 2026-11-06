import { emit } from '../../../harness/page/bench.js';
export async function runBench(map, firstFrameMs) {
    const { canvas } = map;
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const info = map.headerInfo;
    const headerPass = info.version === 3 && info.maxZoom === 2 && info.numEntries === 21;
    emit({
        check: 'pmtiles-header-synced',
        pass: headerPass,
        detail: `version=${info.version}, maxZoom=${info.maxZoom}, entries=${info.numEntries} (read synchronously by C)`
    });
    const initialReads = map.getRangeReadCount();
    const initialBytes = map.getRangeBytes();
    const rangePass = initialReads >= 2 && initialBytes > 0;
    emit({
        check: 'jspi-range-reads',
        pass: rangePass,
        detail: `range reads = ${initialReads}, range bytes = ${initialBytes} B via JSPI suspension`
    });
    let hasLandPixel = false;
    let landSample = '';
    const testCoords = [
        [
            512,
            320
        ],
        [
            530,
            340
        ],
        [
            550,
            360
        ],
        [
            480,
            300
        ],
        [
            520,
            260
        ],
        [
            580,
            280
        ],
        [
            620,
            300
        ],
        [
            350,
            320
        ],
        [
            380,
            280
        ],
        [
            512,
            384
        ]
    ];
    for (const [tx, ty] of testCoords){
        const px = map.readPixel(tx, ty);
        if (px[0] > 35 || px[1] > 45 || px[2] > 60) {
            hasLandPixel = true;
            landSample = `rgba(${Array.from(px).join(',')}) at (${tx}, ${ty})`;
            break;
        }
    }
    emit({
        check: 'world-land-rendered',
        pass: hasLandPixel,
        detail: landSample || 'no land pixels found'
    });
    const readsBefore = map.getRangeReadCount();
    map.zoomBy(0.5);
    map.panBy(150, 100);
    await new Promise((r)=>setTimeout(r, 150));
    map.render();
    const readsAfter = map.getRangeReadCount();
    const tilesAfter = map.getTileCount();
    const panPass = readsAfter > readsBefore && tilesAfter > 1;
    emit({
        check: 'pan-triggers-jspi-tiles',
        pass: panPass,
        detail: `tiles in memory: ${tilesAfter}, reads: before=${readsBefore}, after=${readsAfter} (JSPI on-demand fetch)`
    });
    map.panBy(-300, -150);
    await new Promise((r)=>setTimeout(r, 50));
    const raf = ()=>new Promise(requestAnimationFrame);
    await raf();
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const start = performance.now();
        map.panBy(4 * Math.cos(i * 0.1), 3 * Math.sin(i * 0.1));
        const redrawMs = performance.now() - start;
        redrawTimes.push(redrawMs);
        const now = await raf();
        frameIntervals.push(now - last);
        last = now;
    }
    for (const v of redrawTimes)emit({
        metric: 'redraw_ms',
        value: v
    });
    for (const v of frameIntervals)emit({
        metric: 'frame_interval_ms',
        value: v
    });
    emit({
        done: true
    });
}
