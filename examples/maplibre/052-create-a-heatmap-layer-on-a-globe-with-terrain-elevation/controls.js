import { frame, project, unproject, MAX_PITCH, MAX_ZOOM, MIN_ZOOM } from './camera.js';
const wrap = (b)=>((b + 180) % 360 + 360) % 360 - 180;
export function orbit(v, dx, dy) {
    v.bearing = wrap(v.bearing - dx * 0.4);
    v.pitch = Math.max(0, Math.min(MAX_PITCH, v.pitch - dy * 0.3));
}
export function pan(v, dx, dy) {
    const cx = v.width / 2, cy = v.height / 2;
    const anchor = unproject(frame(v), cx, cy, v.centerH);
    let [mx, my] = [
        dx,
        dy
    ];
    for(let it = 0; it < 4; it++){
        const g = unproject(frame(v), cx - mx, cy - my, v.centerH);
        if (!g || !anchor) return;
        v.lon = g[0];
        v.lat = Math.max(-85, Math.min(85, g[1]));
        const p = project(frame(v), anchor[0], anchor[1], v.centerH);
        if (!p) return;
        const ex = cx + dx - p[0], ey = cy + dy - p[1];
        if (Math.hypot(ex, ey) < 0.05) return;
        [mx, my] = [
            ex,
            ey
        ];
    }
}
export function zoomAt(v, sx, sy, dz) {
    const before = unproject(frame(v), sx, sy, v.centerH);
    v.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom + dz));
    if (!before) return;
    for(let it = 0; it < 10; it++){
        const now = unproject(frame(v), sx, sy, v.centerH);
        if (!now) return;
        v.lon += before[0] - now[0];
        v.lat = Math.max(-85, Math.min(85, v.lat + before[1] - now[1]));
        const p = project(frame(v), before[0], before[1], v.centerH);
        if (!p || Math.hypot(sx - p[0], sy - p[1]) < 0.05) return;
    }
}
export function bindDrag(el, move) {
    let last = null;
    el.addEventListener('pointerdown', (e)=>{
        last = {
            x: e.clientX,
            y: e.clientY
        };
        try {
            el.setPointerCapture(e.pointerId);
        } catch  {}
    });
    el.addEventListener('pointermove', (e)=>{
        if (!last) return;
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        last = {
            x: e.clientX,
            y: e.clientY
        };
        move(dx, dy, !!e.shiftKey);
    });
    const end = ()=>{
        last = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
}
