import { project, worldOf, groundAt } from './terrain.js';
export const NAME_PX = 14;
export const EN_PX = 11;
const GAP = 6;
const PAD = 2;
export function blockSize(l, measure) {
    const w = Math.max(measure(l.name, NAME_PX), l.en ? measure(l.en, EN_PX) : 0);
    return [
        Math.ceil(w),
        l.en ? NAME_PX + EN_PX + 3 : NAME_PX
    ];
}
export function occluded(r, p, eye) {
    const d = [
        eye[0] - p[0],
        eye[1] - p[1],
        eye[2] - p[2]
    ];
    const len = Math.hypot(d[0], d[1], d[2]);
    const step = r.cellM * 0.75;
    for(let t = 150; t < len; t += step){
        const k = t / len;
        const x = p[0] + d[0] * k, y = p[1] + d[1] * k, z = p[2] + d[2] * k;
        if (z > r.maxElev) return false;
        if (groundAt(r, x, y) > z) return true;
    }
    return false;
}
const overlaps = (a, b)=>a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
export function planLabels(r, view, dpr, labels, sizes) {
    const w = view.w / dpr, h = view.h / dpr;
    const plan = {
        placed: [],
        rejected: []
    };
    labels.forEach((label, i)=>{
        const world = worldOf(r, label.u, label.v);
        world[2] += 20;
        const s = project(view, world);
        if (!s) {
            plan.rejected.push({
                label,
                reason: 'behind-camera'
            });
            return;
        }
        const ax = s[0] / dpr, ay = s[1] / dpr;
        if (ax < 0 || ay < 0 || ax > w || ay > h) {
            plan.rejected.push({
                label,
                reason: 'offscreen'
            });
            return;
        }
        if (occluded(r, world, view.eye)) {
            plan.rejected.push({
                label,
                reason: 'occluded'
            });
            return;
        }
        const [bw, bh] = sizes[i];
        const sides = [
            [
                ax + GAP,
                ay - bh / 2
            ],
            [
                ax - GAP - bw,
                ay - bh / 2
            ],
            [
                ax - bw / 2,
                ay - GAP - bh
            ],
            [
                ax - bw / 2,
                ay + GAP
            ]
        ];
        for(let side = 0; side < sides.length; side++){
            const [x, y] = sides[side];
            const box = {
                x0: x - PAD,
                y0: y - PAD,
                x1: x + bw + PAD,
                y1: y + bh + PAD
            };
            if (box.x0 < 0 || box.y0 < 0 || box.x1 > w || box.y1 > h) continue;
            if (plan.placed.some((p)=>overlaps(p.box, box))) continue;
            plan.placed.push({
                label,
                anchor: [
                    ax,
                    ay
                ],
                box,
                side
            });
            return;
        }
        plan.rejected.push({
            label,
            reason: 'collision'
        });
    });
    return plan;
}
export function drawLabels(ctx, plan, dpr, font) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    for (const { label, anchor, box } of plan.placed){
        const summit = label.rank === 0;
        ctx.fillStyle = summit ? '#b91c1c' : '#1e293b';
        ctx.beginPath();
        ctx.arc(anchor[0], anchor[1], summit ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
        const x = box.x0 + PAD, y = box.y0 + PAD;
        const lines = [
            [
                label.name,
                NAME_PX,
                summit ? '#7f1d1d' : '#0f172a'
            ]
        ];
        if (label.en) lines.push([
            label.en,
            EN_PX,
            '#334155'
        ]);
        let dy = 0;
        for (const [text, px, colour] of lines){
            ctx.font = `${px === NAME_PX ? 700 : 500} ${px}px ${font}`;
            ctx.strokeStyle = 'rgba(255,255,255,0.92)';
            ctx.lineWidth = 3;
            ctx.strokeText(text, x, y + dy);
            ctx.fillStyle = colour;
            ctx.fillText(text, x, y + dy);
            dy += px + 3;
        }
    }
}
