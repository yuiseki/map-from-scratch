import { groundAt, summitWorld, worldOf } from './terrain.js';
export const RATE = 60;
export const ORBIT_M = 14000;
const lerp = (a, b, t)=>a.map((v, i)=>v + (b[i] - v) * t);
function along(path, t) {
    const seg = path.slice(1).map((p, i)=>Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
    let d = t * seg.reduce((a, b)=>a + b, 0);
    for(let i = 0; i < seg.length; i++){
        if (d <= seg[i] || i === seg.length - 1) return lerp(path[i], path[i + 1], Math.min(1, d / seg[i]));
        d -= seg[i];
    }
    return path[path.length - 1];
}
export function rigs(r) {
    const summit = summitWorld(r);
    const [W, S, E, N] = r.bounds;
    const at = (lon, lat)=>worldOf(r, (lon - W) / (E - W), (N - lat) / (N - S));
    const ground = (p)=>[
            p[0],
            p[1],
            groundAt(r, p[0], p[1])
        ];
    const trail = [
        at(-121.7353, 46.7865),
        at(-121.7316, 46.8358),
        summit
    ].map(ground);
    return [
        {
            name: 'orbit',
            label: 'Orbit',
            duration: 6,
            clearance: 120,
            at: (t)=>{
                const az = (20 + 300 * t) * Math.PI / 180, el = 40 * Math.PI / 180;
                return {
                    eye: [
                        summit[0] + Math.sin(az) * Math.cos(el) * ORBIT_M,
                        summit[1] + Math.cos(az) * Math.cos(el) * ORBIT_M,
                        summit[2] + Math.sin(el) * ORBIT_M
                    ],
                    target: summit
                };
            }
        },
        {
            name: 'follow',
            label: 'Follow',
            duration: 10,
            clearance: 120,
            at: (t)=>{
                const target = ground(along(trail, t));
                const ahead = along(trail, Math.min(1, t + 0.02)), back = along(trail, Math.max(0, t - 0.02));
                const dx = ahead[0] - back[0], dy = ahead[1] - back[1], l = Math.hypot(dx, dy) || 1;
                return {
                    eye: [
                        target[0] - dx / l * 1400,
                        target[1] - dy / l * 1400,
                        target[2] + 350
                    ],
                    target
                };
            }
        },
        {
            name: 'rail',
            label: 'Rail',
            duration: 8,
            clearance: 150,
            at: (t)=>({
                    eye: [
                        summit[0] - 8000 + 16000 * t,
                        summit[1] + 7000,
                        2000
                    ],
                    target: summit
                })
        }
    ];
}
export function bake(r, rig) {
    const frames = Math.round(rig.duration * RATE) + 1;
    const samples = new Float32Array(frames * 6);
    const planned = [], lifted = [];
    for(let i = 0; i < frames; i++){
        const { eye, target } = rig.at(i / (frames - 1));
        samples.set(eye, i * 6);
        samples.set(target, i * 6 + 3);
        planned.push(eye[2]);
        lifted.push(Math.max(eye[2], groundAt(r, eye[0], eye[1]) + rig.clearance));
    }
    const half = Math.round(RATE / 4);
    const win = (i)=>[
            Math.max(0, i - half),
            Math.min(frames - 1, i + half)
        ];
    const maxed = lifted.map((_, i)=>{
        const [a, b] = win(i);
        return Math.max(...lifted.slice(a, b + 1));
    });
    let raised = 0;
    for(let i = 0; i < frames; i++){
        const [a, b] = win(i);
        const z = maxed.slice(a, b + 1).reduce((s, v)=>s + v, 0) / (b - a + 1);
        if (z > planned[i] + 0.01) raised++;
        samples[i * 6 + 2] = Math.max(planned[i], z);
    }
    return {
        rig,
        frames,
        samples,
        raised
    };
}
