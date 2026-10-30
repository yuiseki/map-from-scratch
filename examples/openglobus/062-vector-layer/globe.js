export class OpenGlobusVectorGlobe {
    canvas;
    ctx;
    polygons = [];
    sphere = new Float32Array(0);
    yaw = 0;
    pitch = 0.3;
    zoom = 1.0;
    dpr = 1;
    isDragging = false;
    dragStart = {
        x: 0,
        y: 0
    };
    onRender;
    oceanGrad = null;
    constructor(canvas, onRender){
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context not available');
        this.ctx = ctx;
        this.onRender = onRender;
        this.resize();
        window.addEventListener('resize', ()=>{
            this.resize();
            this.draw();
        });
        this.setupInteractions();
    }
    async load(baseDir = '../../..') {
        const [res, tri] = await Promise.all([
            fetch(`${baseDir}/data/baked/openglobus-062-vector-layer/countries.json`),
            fetch(`${baseDir}/data/baked/openglobus-062-vector-layer/land.bin`)
        ]);
        this.polygons = await res.json();
        this.sphere = toSphere(new Int16Array(await tri.arrayBuffer()));
        this.draw();
    }
    resize() {
        this.dpr = window.devicePixelRatio || 1;
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) * 0.42 * this.zoom;
        const grad = this.ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, R * 0.1, cx, cy, R);
        grad.addColorStop(0, '#0f2240');
        grad.addColorStop(0.75, '#071326');
        grad.addColorStop(1, '#030814');
        this.oceanGrad = grad;
    }
    rotateBy(dyaw, dpitch) {
        this.yaw += dyaw;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dpitch));
        this.draw();
    }
    setZoom(zoom) {
        this.zoom = zoom;
        this.resize();
        this.draw();
    }
    setupInteractions() {
        this.canvas.addEventListener('mousedown', (e)=>{
            this.isDragging = true;
            this.dragStart = {
                x: e.clientX,
                y: e.clientY
            };
        });
        window.addEventListener('mousemove', (e)=>{
            if (!this.isDragging) return;
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            this.dragStart = {
                x: e.clientX,
                y: e.clientY
            };
            this.rotateBy(dx * 0.005, -dy * 0.005);
        });
        window.addEventListener('mouseup', ()=>{
            this.isDragging = false;
        });
        this.canvas.addEventListener('wheel', (e)=>{
            e.preventDefault();
            const zoomDelta = -e.deltaY * 0.002;
            this.setZoom(Math.max(0.6, Math.min(2.5, this.zoom + zoomDelta)));
        }, {
            passive: false
        });
    }
    project(lonDeg, latDeg) {
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) * 0.42 * this.zoom;
        const lon = lonDeg * Math.PI / 180;
        const lat = latDeg * Math.PI / 180;
        const cosLat = Math.cos(lat);
        const gx = cosLat * Math.cos(lon);
        const gy = cosLat * Math.sin(lon);
        const gz = Math.sin(lat);
        const cosY = Math.cos(this.yaw);
        const sinY = Math.sin(this.yaw);
        const x1 = gx * cosY + gy * sinY;
        const y1 = -gx * sinY + gy * cosY;
        const z1 = gz;
        const cosP = Math.cos(this.pitch);
        const sinP = Math.sin(this.pitch);
        const camX = y1;
        const camY = -x1 * sinP + z1 * cosP;
        const camZ = x1 * cosP + z1 * sinP;
        return {
            sx: cx + camX * R,
            sy: cy - camY * R,
            visible: camZ > 0.02,
            depth: camZ
        };
    }
    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) * 0.42 * this.zoom;
        ctx.save();
        ctx.scale(this.dpr, this.dpr);
        ctx.fillStyle = '#030712';
        ctx.fillRect(0, 0, w, h);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fillStyle = this.oceanGrad || '#071326';
        ctx.fill();
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
        ctx.clip();
        const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
        const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
        const s = this.sphere;
        const px = [
            0,
            0,
            0
        ], py = [
            0,
            0,
            0
        ], pz = [
            0,
            0,
            0
        ];
        ctx.fillStyle = '#162032';
        ctx.beginPath();
        for(let i = 0; i < s.length; i += 9){
            let front = 0;
            for(let k = 0; k < 3; k++){
                const gx = s[i + k * 3], gy = s[i + k * 3 + 1], gz = s[i + k * 3 + 2];
                const x1 = gx * cosY + gy * sinY;
                px[k] = -gx * sinY + gy * cosY;
                py[k] = -x1 * sinP + gz * cosP;
                pz[k] = x1 * cosP + gz * sinP;
                if (pz[k] > 0) front++;
            }
            if (front === 0) continue;
            if (front < 3) {
                for(let k = 0; k < 3; k++){
                    if (pz[k] > 0) continue;
                    const n = Math.hypot(px[k], py[k]) || 1;
                    px[k] /= n;
                    py[k] /= n;
                }
            }
            ctx.moveTo(cx + px[0] * R, cy - py[0] * R);
            ctx.lineTo(cx + px[1] * R, cy - py[1] * R);
            ctx.lineTo(cx + px[2] * R, cy - py[2] * R);
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
        ctx.lineWidth = 3.5;
        for (const poly of this.polygons){
            for (const ring of poly){
                ctx.beginPath();
                let anyVisible = false;
                let started = false;
                for(let i = 0; i < ring.length; i++){
                    const pt = this.project(ring[i][0], ring[i][1]);
                    if (pt.visible) {
                        anyVisible = true;
                        if (!started) {
                            ctx.moveTo(pt.sx, pt.sy);
                            started = true;
                        } else {
                            ctx.lineTo(pt.sx, pt.sy);
                        }
                    } else {
                        started = false;
                    }
                }
                if (anyVisible) ctx.stroke();
            }
        }
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1.2;
        for (const poly of this.polygons){
            for (const ring of poly){
                ctx.beginPath();
                let anyVisible = false;
                let started = false;
                for(let i = 0; i < ring.length; i++){
                    const pt = this.project(ring[i][0], ring[i][1]);
                    if (pt.visible) {
                        anyVisible = true;
                        if (!started) {
                            ctx.moveTo(pt.sx, pt.sy);
                            started = true;
                        } else {
                            ctx.lineTo(pt.sx, pt.sy);
                        }
                    } else {
                        started = false;
                    }
                }
                if (anyVisible) ctx.stroke();
            }
        }
        ctx.restore();
        ctx.restore();
        if (this.onRender) this.onRender();
    }
}
const MAX_EDGE = 20;
function toSphere(v) {
    const out = [];
    const d = (p, q)=>Math.hypot(p[0] - q[0], p[1] - q[1]);
    const split = (a, b, c)=>{
        if (d(b, c) > d(a, b) && d(b, c) >= d(c, a)) return split(b, c, a);
        if (d(c, a) > d(a, b)) return split(c, a, b);
        if (d(a, b) > MAX_EDGE) {
            const h = [
                (a[0] + b[0]) / 2,
                (a[1] + b[1]) / 2
            ];
            split(a, h, c);
            return split(h, b, c);
        }
        for (const [l, p] of [
            a,
            b,
            c
        ]){
            const L = l * Math.PI / 180, P = p * Math.PI / 180;
            out.push(Math.cos(P) * Math.cos(L), Math.cos(P) * Math.sin(L), Math.sin(P));
        }
    };
    const at = (i)=>[
            v[i] / 100,
            v[i + 1] / 100
        ];
    for(let i = 0; i + 5 < v.length; i += 6)split(at(i), at(i + 2), at(i + 4));
    return new Float32Array(out);
}
