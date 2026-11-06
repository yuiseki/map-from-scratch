import { mount } from './canvasmap.js';
let seed = Number(new URLSearchParams(location.search).get('seed') ?? 1);
const rnd = ()=>(seed = seed * 16807 % 2147483647) / 2147483647;
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 400;
const ctx = canvas.getContext('2d');
const R = 20;
const circles = Array.from({
    length: 5
}, ()=>({
        colour: `#${(0x1000000 + rnd() * 0xffffff).toString(16).slice(1, 7)}`,
        x: rnd() * (400 - 2 * R) + R,
        y: rnd() * (400 - 2 * R) + R,
        dx: (rnd() - 0.5) * 2,
        dy: (rnd() - 0.5) * 2
    }));
export let animFrames = 0;
function animate() {
    requestAnimationFrame(animate);
    ctx.clearRect(0, 0, 400, 400);
    for (const c of circles){
        if (c.x + R > 400 || c.x - R < 0) c.dx = -c.dx;
        if (c.y + R > 400 || c.y - R < 0) c.dy = -c.dy;
        c.x += c.dx;
        c.y += c.dy;
        ctx.beginPath();
        ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
        ctx.strokeStyle = c.colour;
        ctx.stroke();
    }
    animFrames++;
}
animate();
const el = document.getElementById('map');
const map = await mount(el, '../../data/baked/26-ml-add-a-canvas-source/basemap.json', [
    95.899147,
    18.088694
], 5, 4);
export const CORNERS = [
    [
        91.4461,
        21.5006
    ],
    [
        100.3541,
        21.5006
    ],
    [
        100.3541,
        13.9706
    ],
    [
        91.4461,
        13.9706
    ]
];
map.addCanvas(canvas, CORNERS);
if (new URLSearchParams(location.search).has('bench')) {
    const [bench] = await Promise.all([
        import('./bench.js'),
        import('../../harness/page/bench.js')
    ]);
    await bench.run(el, map, canvas, CORNERS, ()=>animFrames);
}
