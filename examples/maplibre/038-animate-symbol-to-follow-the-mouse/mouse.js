export function screenToLngLatInLayout(sx, sy, mapSize, offsetX, offsetY) {
    const mx = (sx - offsetX) / mapSize;
    const my = (sy - offsetY) / mapSize;
    const lon = mx * 360 - 180;
    const clampedMy = Math.max(0.0001, Math.min(0.9999, my));
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * clampedMy))) * 180 / Math.PI;
    return [
        Math.round(lon * 1000) / 1000,
        Math.round(lat * 1000) / 1000
    ];
}
export async function mount(canvas, landUrl) {
    const ctx = canvas.getContext('2d');
    const res = await fetch(landUrl);
    const landPolygons = await res.json();
    let cursorX = 0;
    let cursorY = 0;
    function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, rect.width * dpr);
        canvas.height = Math.max(1, rect.height * dpr);
        if (cursorX === 0 && cursorY === 0) {
            cursorX = canvas.width / 2;
            cursorY = canvas.height / 2;
        }
    }
    function getMapLayout() {
        const w = canvas.width;
        const h = canvas.height;
        const mapSize = Math.min(w, h * 1.5) * 0.95;
        const offsetX = (w - mapSize) / 2;
        const offsetY = (h - mapSize) / 2;
        return {
            w,
            h,
            mapSize,
            offsetX,
            offsetY
        };
    }
    function screenToLngLat(sx, sy) {
        const { mapSize, offsetX, offsetY } = getMapLayout();
        return screenToLngLatInLayout(sx, sy, mapSize, offsetX, offsetY);
    }
    function draw() {
        const { w, h, mapSize, offsetX, offsetY } = getMapLayout();
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#94a3b8';
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
        const dpr = window.devicePixelRatio || 1;
        const r = 12 * dpr;
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, r * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 135, 190, 0.25)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, r, 0, Math.PI * 2);
        ctx.fillStyle = '#3887be';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3 * dpr;
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, 3 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }
    function setCursorPos(sx, sy) {
        cursorX = sx;
        cursorY = sy;
        draw();
    }
    resize();
    window.addEventListener('resize', ()=>{
        resize();
        draw();
    });
    canvas.addEventListener('mousemove', (e)=>{
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        setCursorPos((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
    });
    draw();
    return {
        canvas,
        ctx,
        setCursorPos,
        getCursorPos: ()=>[
                cursorX,
                cursorY
            ],
        getCursorLngLat: ()=>screenToLngLat(cursorX, cursorY),
        draw,
        readPixel: (x, y)=>{
            const px = ctx.getImageData(x, y, 1, 1).data;
            return [
                px[0],
                px[1],
                px[2],
                px[3]
            ];
        }
    };
}
