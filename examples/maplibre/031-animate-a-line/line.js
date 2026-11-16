function mercY(lat) {
    const sin = Math.sin(lat * Math.PI / 180);
    const clamped = Math.max(-0.9999, Math.min(0.9999, sin));
    return 0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI);
}
function mercX(lon) {
    return (lon + 180) / 360;
}
export function sineLinePoints() {
    const points = [];
    for(let x = 0; x <= 360; x++){
        const lat = Math.sin(x * Math.PI / 90) * 40;
        const lon = x > 180 ? x - 360 : x;
        points.push([
            mercX(lon),
            mercY(lat)
        ]);
    }
    return points;
}
export async function mount(canvas, landUrl) {
    const ctx = canvas.getContext('2d');
    const res = await fetch(landUrl);
    const landPolygons = await res.json();
    let animFrameId = 0;
    let isRunning = false;
    let currentStep = 0;
    const maxSteps = 360;
    const sinePoints = sineLinePoints();
    function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, rect.width * dpr);
        canvas.height = Math.max(1, rect.height * dpr);
    }
    function draw() {
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#dbeafe';
        ctx.fillRect(0, 0, w, h);
        const mapSize = Math.min(w, h * 1.5) * 0.95;
        const offsetX = (w - mapSize) / 2;
        const offsetY = (h - mapSize) / 2;
        ctx.fillStyle = '#f1f5f9';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        for (const poly of landPolygons){
            ctx.beginPath();
            for (const ring of poly){
                for(let i = 0; i < ring.length; i += 2){
                    const sx = offsetX + ring[i] * mapSize;
                    const sy = offsetY + ring[i + 1] * mapSize;
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                }
                ctx.closePath();
            }
            ctx.fill();
            ctx.stroke();
        }
        if (currentStep > 0) {
            ctx.strokeStyle = '#007cbf';
            ctx.lineWidth = 4 * (window.devicePixelRatio || 1);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            let isFirst = true;
            let lastSx = 0;
            for(let i = 0; i <= currentStep && i < sinePoints.length; i++){
                const pt = sinePoints[i];
                const sx = offsetX + pt[0] * mapSize;
                const sy = offsetY + pt[1] * mapSize;
                if (!isFirst && Math.abs(sx - lastSx) > mapSize * 0.5) {
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                } else if (isFirst) {
                    ctx.moveTo(sx, sy);
                    isFirst = false;
                } else {
                    ctx.lineTo(sx, sy);
                }
                lastSx = sx;
            }
            ctx.stroke();
        }
    }
    function step() {
        currentStep = (currentStep + 1) % (maxSteps + 1);
        draw();
    }
    function reset() {
        currentStep = 0;
        draw();
    }
    function loop() {
        if (!isRunning) return;
        step();
        animFrameId = requestAnimationFrame(loop);
    }
    function start() {
        if (isRunning) return;
        isRunning = true;
        animFrameId = requestAnimationFrame(loop);
    }
    function stop() {
        isRunning = false;
        cancelAnimationFrame(animFrameId);
    }
    resize();
    window.addEventListener('resize', ()=>{
        resize();
        draw();
    });
    draw();
    return {
        canvas,
        ctx,
        step,
        reset,
        draw,
        getPointCount: ()=>currentStep,
        readPixel: (x, y)=>{
            const px = ctx.getImageData(x, y, 1, 1).data;
            return [
                px[0],
                px[1],
                px[2],
                px[3]
            ];
        },
        start,
        stop
    };
}
