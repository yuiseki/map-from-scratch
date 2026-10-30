import { emit } from '../../../harness/page/bench.js';
const ANCHOR = [
    0,
    0
];
const LAND_POINT = [
    20,
    20
];
const OCEAN_POINT = [
    -30,
    30
];
const ICON_SIZE = 64;
const channel = (v)=>Math.round(v / ICON_SIZE * 255);
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
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
    const pixelAt = (x, y)=>Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
    const fmt = (p)=>`rgba(${p.join(',')})`;
    const near = (p, rgb, tol = 1)=>Math.abs(p[0] - rgb[0]) <= tol && Math.abs(p[1] - rgb[1]) <= tol && Math.abs(p[2] - rgb[2]) <= tol;
    const isLand = (p)=>p[0] > 225 && p[1] > 225 && p[2] > 210;
    const isOcean = (p)=>p[0] < 190 && p[1] > 195 && p[2] > 205;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const project = (lon, lat)=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const [cx, cy] = map.center;
        return [
            w / 2 + (mercX(lon) - cx) * scale,
            h / 2 + (mercY(lat) - cy) * scale
        ];
    };
    const iconPixel = (ix, iy)=>{
        const r = map.iconRect();
        return pixelAt(r.x + ix, r.y + iy);
    };
    const expected = (ix, iy)=>[
            channel(ix),
            channel(iy),
            channel(iy)
        ];
    const land = project(LAND_POINT[0], LAND_POINT[1]);
    const ocean = project(OCEAN_POINT[0], OCEAN_POINT[1]);
    emit({
        check: 'map-rendered-at-target',
        pass: map.zoom === 2 && isLand(pixelAt(land[0], land[1])) && isOcean(pixelAt(ocean[0], ocean[1])),
        detail: `zoom ${map.zoom}, land ${fmt(pixelAt(land[0], land[1]))}, ` + `ocean ${fmt(pixelAt(ocean[0], ocean[1]))}`
    });
    const anchor = project(ANCHOR[0], ANCHOR[1]);
    const rect = map.iconRect();
    emit({
        check: 'gradient-icon-generated',
        pass: map.iconReady() && rect.width === ICON_SIZE && rect.height === ICON_SIZE && Math.abs(rect.x + ICON_SIZE / 2 - anchor[0]) < 1e-9 && Math.abs(rect.y + ICON_SIZE / 2 - anchor[1]) < 1e-9,
        detail: `icon ${rect.width}x${rect.height} at (${rect.x},${rect.y}), ` + `anchor (${anchor[0]},${anchor[1]})`
    });
    const corners = [
        [
            2,
            2
        ],
        [
            61,
            2
        ],
        [
            2,
            61
        ],
        [
            61,
            61
        ]
    ].map(([ix, iy])=>({
            ix,
            iy,
            px: iconPixel(ix, iy),
            want: expected(ix, iy)
        }));
    emit({
        check: 'gradient-orientation',
        pass: corners.every((c)=>near(c.px, c.want)),
        detail: corners.map((c)=>`(${c.ix},${c.iy}) ${fmt(c.px)} want ${fmt([
                ...c.want,
                255
            ])}`).join(', ')
    });
    const before = map.iconRect();
    map.panBy(120, 60);
    const after = map.iconRect();
    const afterPixel = iconPixel(61, 2);
    const landMoved = project(LAND_POINT[0], LAND_POINT[1]);
    emit({
        check: 'icon-follows-pan',
        pass: Math.round(after.x - before.x) === 120 && Math.round(after.y - before.y) === 60 && near(afterPixel, expected(61, 2)) && Math.abs(landMoved[0] - (land[0] + 120)) < 1e-6 && Math.abs(landMoved[1] - (land[1] + 60)) < 1e-6,
        detail: `rect (${before.x},${before.y}) -> (${after.x},${after.y}), ` + `pixel ${fmt(afterPixel)}`
    });
    map.resetView();
    const zoomRectBefore = map.iconRect();
    const landBefore = project(LAND_POINT[0], LAND_POINT[1]);
    const centre = project(ANCHOR[0], ANCHOR[1]);
    map.zoomAtPoint(centre[0], centre[1], 5);
    const zoomRectAfter = map.iconRect();
    const landAfter = project(LAND_POINT[0], LAND_POINT[1]);
    emit({
        check: 'icon-keeps-screen-size-on-zoom',
        pass: map.zoom === 5 && zoomRectAfter.width === ICON_SIZE && Math.abs(zoomRectAfter.x - zoomRectBefore.x) < 1e-9 && Math.abs(zoomRectAfter.y - zoomRectBefore.y) < 1e-9 && Math.abs(landAfter[0] - centre[0] - (landBefore[0] - centre[0]) * 8) < 1e-6 && near(iconPixel(2, 61), expected(2, 61)),
        detail: `icon ${zoomRectAfter.width} px at zoom ${map.zoom}, ` + `land offset ${landBefore[0].toFixed(1)} -> ${landAfter[0].toFixed(1)}`
    });
    map.resetView();
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
    map.resetView();
    await sleep(50);
    emit({
        done: true
    });
}
