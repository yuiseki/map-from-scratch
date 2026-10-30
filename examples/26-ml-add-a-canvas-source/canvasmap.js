const merc = (lon, lat)=>{
    const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
    return [
        lon / 360 + 0.5,
        0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
    ];
};
const stops = (z, s)=>{
    for(let i = 2; i < s.length; i += 2)if (z < s[i] || i + 2 >= s.length) {
        const t = Math.max(0, Math.min(1, (z - s[i - 2]) / (s[i] - s[i - 2])));
        return s[i - 1] + t * (s[i + 1] - s[i - 1]);
    }
    return s[1];
};
const GEOLINES = [
    [
        0,
        'Equator'
    ],
    [
        23.4366,
        'Tropic of Cancer'
    ],
    [
        -23.4366,
        'Tropic of Capricorn'
    ],
    [
        66.5634,
        'Arctic Circle'
    ],
    [
        -66.5634,
        'Antarctic Circle'
    ]
];
export async function mount(el, url, center, zoom, minZoom = 0, maxZoom = 12) {
    const { g, c: colours, f } = await (await fetch(url)).json();
    const paths = [];
    const base = document.createElement('canvas');
    const ctx = base.getContext('2d', {
        alpha: false
    });
    el.style.touchAction = 'none';
    el.append(base);
    const [cx, cy] = merc(center[0], center[1]);
    const cam = {
        x: cx,
        y: cy,
        z: zoom
    };
    const layers = [];
    let W = 0, H = 0, dpr = 1, pending = 0;
    function draw() {
        map.redraws++;
        cam.z = Math.max(minZoom, Math.min(maxZoom, cam.z));
        const k = 512 * 2 ** cam.z, z = cam.z, half = H / 2 / k;
        cam.x -= Math.floor(cam.x);
        cam.y = half < 0.5 ? Math.max(half, Math.min(1 - half, cam.y)) : 0.5;
        const ox = W / 2 - cam.x * k, oy = H / 2 - cam.y * k, s = k / g;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#D8F2FF';
        ctx.fillRect(0, 0, W, H);
        const vis = [];
        for(let w = Math.floor(-ox / k); ox + w * k < W; w++){
            const tx = ox + w * k;
            f.forEach((r, i)=>{
                if (tx + r[6] * s < 0 || tx + r[4] * s > W || oy + r[7] * s < 0 || oy + r[5] * s > H) return;
                vis.push([
                    paths[i] ??= new Path2D(r[8]),
                    r[0],
                    tx
                ]);
            });
        }
        ctx.lineJoin = ctx.lineCap = 'round';
        const pass = (fn)=>{
            for (const [p, c, tx] of vis){
                ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * oy);
                fn(p, c);
            }
        };
        ctx.strokeStyle = '#198EC8';
        ctx.lineWidth = stops(z, [
            0,
            2,
            6,
            6,
            14,
            9,
            22,
            18
        ]) / s;
        pass((p)=>ctx.stroke(p));
        pass((p, c)=>{
            ctx.fillStyle = colours[c];
            ctx.fill(p, 'evenodd');
        });
        ctx.strokeStyle = '#fff';
        ctx.globalAlpha = stops(z, [
            3,
            0.5,
            6,
            1
        ]);
        ctx.lineWidth = stops(z, [
            1,
            1,
            6,
            2,
            14,
            6,
            22,
            12
        ]) / s;
        pass((p)=>ctx.stroke(p));
        ctx.globalAlpha = 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = (lines, x, y, size, halo, colour)=>{
            ctx.font = `600 ${size}px 'Open Sans',sans-serif`;
            ctx.lineWidth = 2 * halo;
            ctx.strokeStyle = '#fff';
            ctx.fillStyle = colour;
            lines.forEach((t, i)=>{
                const ly = y + (i - (lines.length - 1) / 2) * size * 1.2;
                ctx.strokeText(t, x, ly);
                ctx.fillText(t, x, ly);
            });
        };
        ctx.lineWidth = 1;
        ctx.setLineDash([
            3,
            3
        ]);
        ctx.strokeStyle = '#1077B0';
        const gs = stops(z, [
            2,
            12,
            6,
            16
        ]), step = 512 * 2 ** (z - Math.floor(z));
        for (const [lat, name] of GEOLINES){
            const y = oy + merc(0, lat)[1] * k;
            if (y < -20 || y > H + 20) continue;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
            ctx.setLineDash([]);
            for(let x = (ox % step + step) % step - step / 2; x < W + step; x += step)label([
                name
            ], x, y, gs, 1, '#1077B0');
            ctx.setLineDash([
                3,
                3
            ]);
        }
        ctx.setLineDash([]);
        const size = stops(z, [
            2,
            10,
            4,
            12,
            6,
            16
        ]), halo = stops(z, [
            2,
            1,
            6,
            1.6
        ]), boxes = [];
        ctx.font = `600 ${size}px 'Open Sans',sans-serif`;
        for(let w = Math.floor(-ox / k); ox + w * k < W; w++){
            for (const r of f){
                const x = ox + w * k + r[2] * s, y = oy + r[3] * s;
                if (x < -100 || x > W + 100 || y < -50 || y > H + 50) continue;
                const lines = [];
                for (const word of r[1].split(' ')){
                    const l = lines.length - 1;
                    if (l >= 0 && ctx.measureText(lines[l] + ' ' + word).width < 10 * size) lines[l] += ' ' + word;
                    else lines.push(word);
                }
                const bw = Math.max(...lines.map((t)=>ctx.measureText(t).width)) / 2 + 2, bh = lines.length * size * 0.6 + 2;
                if (boxes.some(([a, b, c, d])=>x - bw < c && x + bw > a && y - bh < d && y + bh > b)) continue;
                boxes.push([
                    x - bw,
                    y - bh,
                    x + bw,
                    y + bh
                ]);
                label(lines, x, y, size, halo, '#08254D');
                ctx.font = `600 ${size}px 'Open Sans',sans-serif`;
            }
        }
        for (const [c, q] of layers){
            const sh = Math.round(cam.x - q[0][0]);
            const [ax, ay, bx, by, dx, dy] = [
                0,
                1,
                3
            ].flatMap((i)=>[
                    ox + (q[i][0] + sh) * k,
                    oy + q[i][1] * k
                ]);
            c.style.transform = `matrix(${(bx - ax) / c.width},${(by - ay) / c.width},${(dx - ax) / c.height},${(dy - ay) / c.height},${ax},${ay})`;
        }
    }
    const schedule = ()=>{
        pending ||= requestAnimationFrame(()=>{
            pending = 0;
            draw();
        });
    };
    const zoomAt = (px, py, z)=>{
        const k0 = 512 * 2 ** cam.z;
        z = Math.max(minZoom, Math.min(maxZoom, z));
        const k1 = 512 * 2 ** z;
        cam.x += (px - W / 2) * (1 / k0 - 1 / k1);
        cam.y += (py - H / 2) * (1 / k0 - 1 / k1);
        cam.z = z;
        schedule();
    };
    const at = (e)=>{
        const r = el.getBoundingClientRect();
        return [
            e.clientX - r.left,
            e.clientY - r.top
        ];
    };
    const down = new Map();
    el.addEventListener('pointerdown', (e)=>{
        down.set(e.pointerId, at(e));
    });
    addEventListener('pointermove', (e)=>{
        const p = down.get(e.pointerId);
        if (!p) return;
        const q = at(e), o = [
            ...down.entries()
        ].find(([id])=>id !== e.pointerId)?.[1];
        const k = 512 * 2 ** cam.z;
        if (o) {
            const d0 = Math.hypot(p[0] - o[0], p[1] - o[1]), d1 = Math.hypot(q[0] - o[0], q[1] - o[1]);
            if (d0 > 0 && d1 > 0) zoomAt(o[0], o[1], cam.z + Math.log2(d1 / d0));
        } else {
            cam.x -= (q[0] - p[0]) / k;
            cam.y -= (q[1] - p[1]) / k;
            schedule();
        }
        down.set(e.pointerId, q);
    });
    const up = (e)=>down.delete(e.pointerId);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const [x, y] = at(e);
        zoomAt(x, y, cam.z - e.deltaY * (e.deltaMode ? 40 : 1) / 450);
    }, {
        passive: false
    });
    el.addEventListener('dblclick', (e)=>{
        const [x, y] = at(e);
        zoomAt(x, y, cam.z + (e.shiftKey ? -1 : 1));
    });
    new ResizeObserver(()=>{
        W = el.clientWidth;
        H = el.clientHeight;
        dpr = devicePixelRatio;
        base.width = Math.round(W * dpr);
        base.height = Math.round(H * dpr);
        base.style.width = W + 'px';
        base.style.height = H + 'px';
        draw();
    }).observe(el);
    const map = {
        cam,
        base,
        redraws: 0,
        draw,
        view (lon, lat, z) {
            [cam.x, cam.y] = merc(lon, lat);
            cam.z = z;
            draw();
        },
        project (lon, lat) {
            const k = 512 * 2 ** cam.z, [x, y] = merc(lon, lat);
            return [
                W / 2 + (x - cam.x + Math.round(cam.x - x)) * k,
                H / 2 + (y - cam.y) * k
            ];
        },
        addCanvas (c, corners) {
            layers.push([
                c,
                corners.map(([lon, lat])=>merc(lon, lat))
            ]);
            c.style.cssText = `display:block;position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;width:${c.width}px;height:${c.height}px`;
            el.append(c);
            draw();
        }
    };
    W = el.clientWidth;
    H = el.clientHeight;
    dpr = devicePixelRatio;
    base.width = Math.round(W * dpr);
    base.height = Math.round(H * dpr);
    base.style.width = W + 'px';
    base.style.height = H + 'px';
    draw();
    return map;
}
