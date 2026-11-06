import { createRenderer } from './render.js';
const canvas = document.getElementById('map');
const status = document.getElementById('status');
const detail = document.getElementById('detail');
const heightInput = document.getElementById('height-scale');
const heightVal = document.getElementById('height-val');
let renderer;
try {
    renderer = await createRenderer(canvas);
} catch (error) {
    status.textContent = String(error);
    status.style.color = '#ff8080';
    throw error;
}
const camera = {
    x: 0,
    y: 0,
    distance: 2.4,
    pitch: 48,
    yaw: 0,
    width: 1,
    height: 1,
    heightScale: 1.4
};
let cells = [];
let totalPopulation = 0;
let scheduled = false;
let frozen = false;
let selectedCell = null;
const fmt = new Intl.NumberFormat('ja-JP');
function schedule() {
    if (scheduled || frozen) return;
    scheduled = true;
    requestAnimationFrame(()=>{
        scheduled = false;
        draw();
    });
}
function draw() {
    camera.width = canvas.clientWidth;
    camera.height = canvas.clientHeight;
    renderer.draw(camera);
}
function readCells(buffer) {
    const view = new DataView(buffer);
    if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'H3P1') {
        throw new Error('H3 データ形式が一致しません');
    }
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
            }
            rings.push(ring);
        }
        result.push({
            h3,
            population,
            rings,
            box
        });
        totalPopulation += population;
    }
    if (at !== buffer.byteLength) throw new Error('H3 データに余分なバイトがあります');
    return result;
}
function pickCell(clientX, clientY) {
    if (cells.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const ndcX = (clientX - rect.left) / rect.width * 2 - 1;
    const ndcY = 1 - (clientY - rect.top) / rect.height * 2;
    const aspect = camera.width / camera.height;
    const tanHalfFov = Math.tan(45 * Math.PI / 180 / 2);
    const yaw = camera.yaw * Math.PI / 180;
    const pitch = camera.pitch * Math.PI / 180;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const eyeX = camera.x + camera.distance * cp * sy;
    const eyeY = camera.y - camera.distance * cp * cy;
    const eyeZ = camera.distance * sp;
    const fx = camera.x - eyeX, fy = camera.y - eyeY, fz = -eyeZ;
    const flen = Math.hypot(fx, fy, fz) || 1;
    const fwdX = fx / flen, fwdY = fy / flen, fwdZ = fz / flen;
    const rlen = Math.hypot(fwdY, -fwdX) || 1;
    const rX = fwdY / rlen, rY = -fwdX / rlen, rZ = 0;
    const uX = rY * fwdZ - rZ * fwdY;
    const uY = rZ * fwdX - rX * fwdZ;
    const uZ = rX * fwdY - rY * fwdX;
    const rayX = fwdX + ndcX * aspect * tanHalfFov * rX + ndcY * tanHalfFov * uX;
    const rayY = fwdY + ndcX * aspect * tanHalfFov * rY + ndcY * tanHalfFov * uY;
    const rayZ = fwdZ + ndcX * aspect * tanHalfFov * rZ + ndcY * tanHalfFov * uZ;
    if (rayZ >= -0.0001) return null;
    const t = -eyeZ / rayZ;
    if (t < 0) return null;
    const hitX = eyeX + t * rayX;
    const hitY = eyeY + t * rayY;
    const mx = (hitX + 1) / 2 * 65535;
    const my = (1 - hitY) / 2 * 65535;
    for (const c of cells){
        const [l, tBox, r, b] = c.box;
        if (mx < l || mx > r || my < tBox || my > b) continue;
        for (const ring of c.rings){
            let inside = false;
            for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
                const a = ring[i], bPt = ring[j];
                if (a[1] > my !== bPt[1] > my && mx < (bPt[0] - a[0]) * (my - a[1]) / (bPt[1] - a[1]) + a[0]) {
                    inside = !inside;
                }
            }
            if (inside) return c;
        }
    }
    return null;
}
const PLACES = {
    world: {
        x: 0,
        y: 0,
        distance: 2.5,
        pitch: 48,
        yaw: 0
    },
    tokyo: {
        x: 0.7765,
        y: 0.354,
        distance: 0.18,
        pitch: 55,
        yaw: 30
    },
    india: {
        x: 0.428,
        y: 0.280,
        distance: 0.28,
        pitch: 52,
        yaw: 15
    },
    europe: {
        x: 0.055,
        y: 0.528,
        distance: 0.24,
        pitch: 50,
        yaw: -10
    },
    nile: {
        x: 0.173,
        y: 0.301,
        distance: 0.16,
        pitch: 58,
        yaw: 20
    },
    us_east: {
        x: -0.41,
        y: 0.40,
        distance: 0.28,
        pitch: 52,
        yaw: 25
    }
};
for (const b of document.querySelectorAll('[data-place]')){
    b.addEventListener('click', ()=>{
        const p = PLACES[b.dataset.place ?? ''];
        if (p) {
            Object.assign(camera, p);
            schedule();
        }
    });
}
heightInput.addEventListener('input', ()=>{
    camera.heightScale = Number(heightInput.value);
    heightVal.textContent = `${camera.heightScale.toFixed(1)}×`;
    schedule();
});
let drag = null;
canvas.addEventListener('pointerdown', (e)=>{
    drag = {
        x: e.clientX,
        y: e.clientY,
        right: e.button === 2 || e.shiftKey
    };
    canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e)=>{
    if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (drag.right) {
            const yaw = camera.yaw * Math.PI / 180;
            const factor = camera.distance * 0.0015;
            camera.x -= (Math.cos(yaw) * dx - Math.sin(yaw) * dy) * factor;
            camera.y += (Math.sin(yaw) * dx + Math.cos(yaw) * dy) * factor;
        } else {
            camera.yaw = (camera.yaw + dx * 0.4) % 360;
            camera.pitch = Math.max(12, Math.min(85, camera.pitch + dy * 0.3));
        }
        schedule();
    } else {
        const cell = pickCell(e.clientX, e.clientY);
        if (cell !== selectedCell) {
            selectedCell = cell;
            if (cell) {
                const pct = (cell.population / totalPopulation * 100).toFixed(4);
                detail.innerHTML = `<strong>${fmt.format(cell.population)} 人</strong><small>H3 ID: ${cell.h3} (解像度4, 世界人口の ${pct}%)</small>`;
            } else {
                detail.innerHTML = `<strong>セルを選択</strong><small>H3 六角柱にカーソルを合わせてください</small>`;
            }
        }
    }
});
canvas.addEventListener('pointerup', ()=>{
    drag = null;
});
canvas.addEventListener('pointercancel', ()=>{
    drag = null;
});
canvas.addEventListener('contextmenu', (e)=>e.preventDefault());
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    camera.distance = Math.max(0.04, Math.min(5.0, camera.distance * Math.exp(e.deltaY * 0.0015)));
    schedule();
}, {
    passive: false
});
new ResizeObserver(schedule).observe(canvas);
try {
    const t0 = performance.now();
    const res = await fetch('../../../data/baked/19-kontur-h3-population/cells.bin');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    cells = readCells(buf);
    const meshInfo = renderer.uploadMesh(cells);
    const elapsed = Math.round(performance.now() - t0);
    status.textContent = `${fmt.format(cells.length)} H3 セル (${(meshInfo.vertexCount / 1000000).toFixed(2)}M 頂点, ${(meshInfo.bytes / 1048576).toFixed(1)} MiB) 準備完了 [${elapsed} ms]`;
    schedule();
} catch (error) {
    status.textContent = `データ読み込みエラー: ${String(error)}`;
    status.style.color = '#ff8080';
}
if (new URLSearchParams(location.search).has('bench')) {
    void import('./bench.js').then(({ run })=>run({
            device: renderer.device,
            gpu: renderer.gpu,
            draw: renderer.draw,
            readScreen: renderer.readScreen,
            camera,
            cells: ()=>cells,
            ready: ()=>cells.length > 0,
            freeze: ()=>{
                frozen = true;
            }
        }));
}
