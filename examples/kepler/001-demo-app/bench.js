import { emit, glRenderer } from '../../../harness/page/bench.js';
export async function run(map, firstFrameMs) {
    emit({
        info: {
            gpu: glRenderer(map.gl),
            points: map.pointCount
        }
    });
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const sidebar = document.getElementById('sidebar');
    const layerCard = document.querySelector('.layer-card');
    const legend = document.getElementById('legend');
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    const uiMounted = Boolean(sidebar && layerCard && legend && collapseBtn);
    emit({
        check: 'kepler-ui-mounted',
        pass: uiMounted,
        detail: `sidebar=${Boolean(sidebar)}, layerCard=${Boolean(layerCard)}, legend=${Boolean(legend)}`
    });
    const canvas = map.canvas;
    const cw = canvas.width;
    const ch = canvas.height;
    let nonBgPixels = 0;
    for(let dy = -80; dy <= 80; dy += 8){
        for(let dx = -80; dx <= 80; dx += 8){
            const px = map.readPixel(Math.round(cw / 2 + dx), Math.round(ch / 2 + dy));
            if (px[0] > 70) {
                nonBgPixels++;
            }
        }
    }
    emit({
        check: 'earthquakes-rendered',
        pass: nonBgPixels > 5 && map.pointCount === 54936,
        detail: `pointCount=${map.pointCount}, found ${nonBgPixels} point pixels in California viewport`
    });
    if (collapseBtn && sidebar) {
        collapseBtn.click();
        const isCollapsed = sidebar.classList.contains('collapsed');
        collapseBtn.click();
        const isRestored = !sidebar.classList.contains('collapsed');
        emit({
            check: 'sidebar-toggle',
            pass: isCollapsed && isRestored,
            detail: `isCollapsed=${isCollapsed}, isRestored=${isRestored}`
        });
    }
    const layerToggle = document.getElementById('layer-toggle-earthquakes');
    if (layerToggle) {
        layerToggle.click();
        map.draw();
        let hiddenPoints = 0;
        for(let dy = -80; dy <= 80; dy += 8){
            for(let dx = -80; dx <= 80; dx += 8){
                const px = map.readPixel(Math.round(cw / 2 + dx), Math.round(ch / 2 + dy));
                if (px[0] > 70) {
                    hiddenPoints++;
                }
            }
        }
        layerToggle.click();
        map.draw();
        emit({
            check: 'layer-toggle',
            pass: hiddenPoints === 0,
            detail: `hiddenPoints=${hiddenPoints} (expected 0 when layer hidden)`
        });
    }
    const redrawTimes = [];
    const intervals = [];
    let lastFrameTime = performance.now();
    for(let f = 0; f < 60; f++){
        const start = performance.now();
        map.panBy(3, 1);
        const end = performance.now();
        redrawTimes.push(end - start);
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        intervals.push(now - lastFrameTime);
        lastFrameTime = now;
    }
    redrawTimes.sort((a, b)=>a - b);
    intervals.sort((a, b)=>a - b);
    const p95Redraw = redrawTimes[Math.floor(redrawTimes.length * 0.95)];
    const p95Interval = intervals[Math.floor(intervals.length * 0.95)];
    emit({
        metric: 'redraw_ms',
        values: redrawTimes
    });
    emit({
        metric: 'frame_interval_ms',
        values: intervals
    });
    emit({
        check: 'pan-and-zoom',
        pass: p95Redraw < 16.0,
        detail: `p95Redraw=${p95Redraw.toFixed(2)}ms, p95Interval=${p95Interval.toFixed(2)}ms`
    });
    emit({
        done: true
    });
}
