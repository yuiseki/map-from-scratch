function mercY(lat) {
    const sin = Math.sin(lat * Math.PI / 180);
    const clamped = Math.max(-0.9999, Math.min(0.9999, sin));
    return 0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI);
}
function mercX(lon) {
    return (lon + 180) / 360;
}
export const nextBearing = (bearing, delta = 0.5)=>(bearing + delta) % 360;
export async function mount(canvas, landUrl) {
    const ctx = canvas.getContext('2d');
    const res = await fetch(landUrl);
    const landPolygons = await res.json();
    let animFrameId = 0;
    let isRunning = false;
    let bearing = 0;
    const focalMx = mercX(-87.62712);
    const focalMy = mercY(41.89033);
    const zoom = 2.0;
    function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, rect.width * dpr);
        canvas.height = Math.max(1, rect.height * dpr);
    }
    function draw() {
        const w = canvas.width;
        const h = canvas.height;
        const dpr = window.devicePixelRatio || 1;
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        const scale = Math.pow(2, zoom) * h;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(bearing * Math.PI / 180);
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        for (const poly of landPolygons){
            ctx.beginPath();
            for (const ring of poly){
                for(let i = 0; i < ring.length; i += 2){
                    const sx = (ring[i] - focalMx) * scale;
                    const sy = (ring[i + 1] - focalMy) * scale;
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                }
                ctx.closePath();
            }
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2 * dpr;
        const r = 8 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - r * 1.5, cy);
        ctx.lineTo(cx + r * 1.5, cy);
        ctx.moveTo(cx, cy - r * 1.5);
        ctx.lineTo(cx, cy + r * 1.5);
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
    }
    function step(delta = 0.5) {
        bearing = nextBearing(bearing, delta);
        draw();
    }
    function reset() {
        bearing = 0;
        draw();
    }
    function loop() {
        if (!isRunning) return;
        step(0.4);
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
        getBearing: ()=>bearing,
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
