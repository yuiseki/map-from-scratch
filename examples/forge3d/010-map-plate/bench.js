import { emit } from '../../../harness/page/bench.js';
export async function run(plate, firstFrameMs) {
    const { canvas, ctx } = plate;
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
    const pxNeatline = ctx.getImageData(Math.round(32 * dpr), Math.round(50 * dpr), 1, 1).data;
    const isNeatlineDark = pxNeatline[0] < 50 && pxNeatline[1] < 50 && pxNeatline[2] < 60;
    const pxMargin = ctx.getImageData(Math.round(10 * dpr), Math.round(10 * dpr), 1, 1).data;
    const isMarginCream = pxMargin[0] > 230 && pxMargin[1] > 230 && pxMargin[2] > 220;
    emit({
        check: 'plate-neatline-rendered',
        pass: isNeatlineDark && isMarginCream,
        detail: `neatline rgba(${pxNeatline.join(',')}), margin rgba(${pxMargin.join(',')})`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        plate.panBy(Math.sin(i * 0.1) * 2, Math.cos(i * 0.1) * 2);
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
    plate.panOffset = {
        x: 0,
        y: 0
    };
    plate.zoom = 1.0;
    plate.draw();
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const mx = 36;
    const my = 40;
    const mapW = w - mx * 2;
    const mapH = h - my * 2;
    const drawSize = Math.min(mapW, mapH) * 1.05;
    const peakNormX = (plate.dem?.peak[0] ?? 0.655) - 0.5;
    const peakNormY = (plate.dem?.peak[1] ?? 0.780) - 0.5;
    const peakSx = mx + mapW / 2 + peakNormX * drawSize;
    const peakSy = my + mapH / 2 + peakNormY * drawSize;
    const pxPeak = ctx.getImageData(Math.round(peakSx * dpr), Math.round(peakSy * dpr), 1, 1).data;
    const isPeakWhite = pxPeak[0] > 210 && pxPeak[1] > 210 && pxPeak[2] > 210;
    emit({
        check: 'dem-relief-rendered',
        pass: isPeakWhite,
        detail: `summit (${Math.round(peakSx)}, ${Math.round(peakSy)}) rgba(${pxPeak.join(',')}) expected white peak snow/marker`
    });
    const nx = mx + mapW - 40;
    const ny = my + 44;
    const pxNorth = ctx.getImageData(Math.round((nx - 3) * dpr), Math.round(ny * dpr), 1, 1).data;
    const isNorthDark = pxNorth[0] < 50 && pxNorth[1] < 50 && pxNorth[2] < 60;
    const tw = 280;
    const tx = mx + (mapW - tw) / 2;
    const ty = my + 14;
    const pxTitle = ctx.getImageData(Math.round((tx + 12) * dpr), Math.round((ty + 12) * dpr), 1, 1).data;
    const isTitleCream = pxTitle[0] > 220 && pxTitle[1] > 220 && pxTitle[2] > 210;
    const sbW = 120;
    const sbH = 34;
    const sbX = mx + mapW - sbW - 16;
    const sbY = my + mapH - sbH - 16;
    const barX = sbX + 14;
    const barY = sbY + 16;
    const segW = 90 / 4;
    const pxBarBlack = ctx.getImageData(Math.round((barX + 5) * dpr), Math.round((barY + 2) * dpr), 1, 1).data;
    const pxBarWhite = ctx.getImageData(Math.round((barX + segW + 5) * dpr), Math.round((barY + 2) * dpr), 1, 1).data;
    const isScaleBarValid = pxBarBlack[0] < 60 && pxBarWhite[0] > 200;
    emit({
        check: 'furniture-rendered',
        pass: isNorthDark && isTitleCream && isScaleBarValid,
        detail: `north-needle rgba(${pxNorth.join(',')}), title-bg rgba(${pxTitle.join(',')}), scalebar [black:${pxBarBlack[0]}, white:${pxBarWhite[0]}]`
    });
    emit({
        done: true
    });
}
const plateInstance = window.__map;
if (plateInstance) {
    void run(plateInstance, performance.now());
}
