export class CesiumGlobe {
    canvas;
    ctx;
    sphere = new Float32Array(0);
    yaw = 0.5;
    pitch = 0.3;
    zoomScale = 1.0;
    dpr = 1;
    isDragging = false;
    dragStart = {
        x: 0,
        y: 0
    };
    onRender;
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
        const res = await fetch(`${baseDir}/data/baked/cesium-180-hello-world/land.bin`);
        const ab = await res.arrayBuffer();
        this.sphere = toSphere(new Int16Array(ab));
        this.draw();
    }
    resize() {
        this.dpr = window.devicePixelRatio || 1;
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
    }
    rotateBy(dYaw, dPitch) {
        this.yaw += dYaw;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dPitch));
        this.draw();
    }
    zoomBy(factor) {
        this.zoomScale = Math.max(0.5, Math.min(3.0, this.zoomScale * factor));
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
            this.rotateBy(-dx * 0.005, dy * 0.005);
        });
        window.addEventListener('mouseup', ()=>{
            this.isDragging = false;
        });
        this.canvas.addEventListener('wheel', (e)=>{
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.95 : 1.05;
            this.zoomBy(factor);
        }, {
            passive: false
        });
    }
    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const cx = w / 2;
        const cy = h / 2;
        const baseRadius = Math.min(w, h) * 0.38;
        const radius = baseRadius * this.zoomScale;
        ctx.save();
        ctx.scale(this.dpr, this.dpr);
        ctx.fillStyle = '#05080f';
        ctx.fillRect(0, 0, w, h);
        const atmoGrad = ctx.createRadialGradient(cx, cy, radius * 0.95, cx, cy, radius * 1.06);
        atmoGrad.addColorStop(0, 'rgba(64, 148, 240, 0.5)');
        atmoGrad.addColorStop(1, 'rgba(64, 148, 240, 0.0)');
        ctx.fillStyle = atmoGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();
        const oceanGrad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.1, cx, cy, radius);
        oceanGrad.addColorStop(0, '#2b78b8');
        oceanGrad.addColorStop(0.7, '#144e80');
        oceanGrad.addColorStop(1, '#092542');
        ctx.fillStyle = oceanGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        const cosP = Math.cos(this.pitch);
        const sinP = Math.sin(this.pitch);
        const cosY = Math.cos(this.yaw);
        const sinY = Math.sin(this.yaw);
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
        ctx.fillStyle = '#3e7d43';
        ctx.beginPath();
        for(let i = 0; i < s.length; i += 9){
            let front = 0;
            for(let k = 0; k < 3; k++){
                const X = s[i + k * 3], Y = s[i + k * 3 + 1], Z = s[i + k * 3 + 2];
                const zr = Z * cosY + X * sinY;
                px[k] = X * cosY - Z * sinY;
                py[k] = Y * cosP - zr * sinP;
                pz[k] = Y * sinP + zr * cosP;
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
            ctx.moveTo(cx + px[0] * radius, cy - py[0] * radius);
            ctx.lineTo(cx + px[1] * radius, cy - py[1] * radius);
            ctx.lineTo(cx + px[2] * radius, cy - py[2] * radius);
        }
        ctx.fill();
        const shadeGrad = ctx.createRadialGradient(cx - radius * 0.25, cy - radius * 0.25, radius * 0.1, cx, cy, radius);
        shadeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
        shadeGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.0)');
        shadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
        ctx.fillStyle = shadeGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
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
            out.push(Math.cos(P) * Math.sin(L), Math.sin(P), Math.cos(P) * Math.cos(L));
        }
    };
    const at = (i)=>[
            v[i] / 100,
            v[i + 1] / 100
        ];
    for(let i = 0; i + 5 < v.length; i += 6)split(at(i), at(i + 2), at(i + 4));
    return new Float32Array(out);
}
