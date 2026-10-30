export { };
const canvas = document.getElementById('map');
const overlay = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const over = overlay.getContext('2d');
const status = document.getElementById('status');
const detail = document.getElementById('detail');
const zoomText = document.getElementById('zoom');
const COLORS = [
    '#325a6d',
    '#386f76',
    '#42877a',
    '#63a679',
    '#9fbd70',
    '#d7c970',
    '#e9aa61',
    '#e47a54',
    '#cb4e49'
];
const BREAKS = [
    10,
    100,
    500,
    2000,
    10000,
    50000,
    200000,
    1000000
];
const paths = COLORS.map(()=>new Path2D());
let cells = [];
let width = 1, height = 1, scale = 1, base = 1, ox = 0, oy = 0, factor = 1;
let selected = null;
let pointer = {
    x: 0,
    y: 0
};
const fmt = new Intl.NumberFormat('ja-JP');
const classOf = (n)=>BREAKS.findIndex((b)=>n < b) === -1 ? COLORS.length - 1 : BREAKS.findIndex((b)=>n < b);
function readCells(buffer) {
    const view = new DataView(buffer);
    if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'H3P1') throw new Error('H3 data version mismatch');
    const count = view.getUint32(4, true);
    const result = [];
    let at = 8;
    for(let i = 0; i < count; i++){
        const h3 = view.getBigUint64(at, true).toString(16);
        at += 8;
        const population = view.getUint32(at, true);
        at += 4;
        const ringCount = view.getUint8(at++);
        const rings = [];
        const box = [
            65535,
            65535,
            0,
            0
        ];
        const path = paths[classOf(population)];
        for(let r = 0; r < ringCount; r++){
            const n = view.getUint8(at++);
            const ring = [];
            for(let j = 0; j < n; j++){
                const x = view.getUint16(at, true), y = view.getUint16(at + 2, true);
                at += 4;
                ring.push([
                    x,
                    y
                ]);
                box[0] = Math.min(box[0], x);
                box[1] = Math.min(box[1], y);
                box[2] = Math.max(box[2], x);
                box[3] = Math.max(box[3], y);
                if (j === 0) path.moveTo(x, y);
                else path.lineTo(x, y);
            }
            path.closePath();
            rings.push(ring);
        }
        result.push({
            h3,
            population,
            rings,
            box
        });
    }
    if (at !== buffer.byteLength) throw new Error('H3 data has trailing bytes');
    return result;
}
function viewport() {
    const dpr = devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = overlay.width = Math.round(width * dpr);
    canvas.height = overlay.height = Math.round(height * dpr);
    base = Math.min(width, height) / 65535;
    scale = base * factor;
    draw();
}
function draw() {
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#102b39';
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
    for(let i = 0; i < paths.length; i++){
        ctx.fillStyle = COLORS[i];
        ctx.fill(paths[i]);
    }
    if (factor >= 7) {
        ctx.lineWidth = Math.max(0.65 / scale, 0.7);
        ctx.strokeStyle = '#102b3970';
        for (const path of paths)ctx.stroke(path);
    }
    zoomText.textContent = `${Math.round(factor)}×`;
    highlight();
}
function highlight() {
    const dpr = devicePixelRatio || 1;
    over.setTransform(1, 0, 0, 1, 0, 0);
    over.clearRect(0, 0, overlay.width, overlay.height);
    if (!selected) return;
    over.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
    over.beginPath();
    for (const ring of selected.rings){
        ring.forEach(([x, y], i)=>i ? over.lineTo(x, y) : over.moveTo(x, y));
        over.closePath();
    }
    over.strokeStyle = '#fff';
    over.lineWidth = 2.5 / scale;
    over.stroke();
}
function inside(ring, x, y) {
    let hit = false;
    for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
        const a = ring[i], b = ring[j];
        if (a[1] > y !== b[1] > y && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
}
function pick(sx, sy) {
    const x = (sx - ox) / scale, y = (sy - oy) / scale;
    let found = null;
    for (const cell of cells){
        const [left, top, right, bottom] = cell.box;
        if (x < left || x > right || y < top || y > bottom) continue;
        if (cell.rings.some((ring)=>inside(ring, x, y))) {
            found = cell;
            break;
        }
    }
    if (found === selected) return;
    selected = found;
    detail.innerHTML = found ? `<strong>${fmt.format(found.population)} 人</strong><small>H3 ${found.h3} · 解像度4</small>` : '<strong>セルを選択</strong><small>六角形にカーソルを合わせてください</small>';
    highlight();
}
function focus(lon, lat, zoom) {
    factor = zoom;
    scale = base * factor;
    const x = (lon + 180) / 360 * 65535;
    const sin = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 65535;
    ox = width / 2 - x * scale;
    oy = height / 2 - y * scale;
    draw();
}
function zoomAt(multiplier, sx, sy) {
    const next = Math.max(1, Math.min(130, factor * multiplier));
    const ratio = next / factor;
    ox = sx - (sx - ox) * ratio;
    oy = sy - (sy - oy) * ratio;
    factor = next;
    scale = base * factor;
    draw();
}
const places = {
    world: [
        0,
        0,
        1
    ],
    tokyo: [
        139.767,
        35.681,
        70
    ],
    india: [
        77.2,
        28.61,
        35
    ],
    europe: [
        10,
        49,
        18
    ]
};
document.querySelectorAll('[data-place]').forEach((button)=>{
    button.addEventListener('click', ()=>{
        const p = places[button.dataset.place];
        focus(...p);
    });
});
document.getElementById('plus').addEventListener('click', ()=>zoomAt(1.8, width / 2, height / 2));
document.getElementById('minus').addEventListener('click', ()=>zoomAt(1 / 1.8, width / 2, height / 2));
canvas.addEventListener('wheel', (event)=>{
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * 0.0014), event.clientX - rect.left, event.clientY - rect.top);
}, {
    passive: false
});
let drag = null;
canvas.addEventListener('pointerdown', (event)=>{
    canvas.setPointerCapture(event.pointerId);
    drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        sx: event.clientX,
        sy: event.clientY,
        moved: false
    };
});
canvas.addEventListener('pointermove', (event)=>{
    const rect = canvas.getBoundingClientRect();
    pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
    if (drag?.id === event.pointerId) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) > 3) drag.moved = true;
        ox += dx;
        oy += dy;
        drag.x = event.clientX;
        drag.y = event.clientY;
        draw();
    } else pick(pointer.x, pointer.y);
});
canvas.addEventListener('pointerup', (event)=>{
    if (drag?.id === event.pointerId) {
        drag = null;
        pick(pointer.x, pointer.y);
    }
});
canvas.addEventListener('pointerleave', ()=>{
    if (!drag) {
        selected = null;
        highlight();
    }
});
new ResizeObserver(viewport).observe(canvas);
try {
    const response = await fetch('../../data/baked/19-kontur-h3-population/cells.bin');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cells = readCells(await response.arrayBuffer());
    status.textContent = `${fmt.format(cells.length)} H3 セル · Kontur Population 2023-11-01`;
    focus(...places.world);
} catch (error) {
    status.textContent = `人口データを読み込めませんでした: ${String(error)}`;
}
