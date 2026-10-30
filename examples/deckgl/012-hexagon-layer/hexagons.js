const EARTH_CIRCUMFERENCE = 40075016.686;
const ANCHOR_LAT = 52.232395;
const COS_ANCHOR = Math.cos(ANCHOR_LAT * Math.PI / 180);
const METERS_PER_WORLD = EARTH_CIRCUMFERENCE * COS_ANCHOR;
const SQRT3 = Math.sqrt(3);
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const anchorX = mercX(-1.415727), anchorY = mercY(ANCHOR_LAT);
const VERTEX = `#version 300 es
layout(location=0) in vec4 a_vertex; // unit x, unit y, bottom/top, light
layout(location=1) in vec3 a_cell;   // world x, world y, accident count
uniform vec2 u_center, u_view;
uniform float u_world_px, u_radius_world, u_coverage, u_pitch, u_bearing, u_max, u_height;
out float v_count, v_light;
void main() {
  vec2 world = a_cell.xy + a_vertex.xy * u_radius_world * u_coverage;
  vec2 delta = (world - u_center) * u_world_px;
  float c = cos(u_bearing), s = sin(u_bearing);
  vec2 rotated = vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
  float height = a_vertex.z * pow(min(1.0, a_cell.z / max(1.0, u_max)), 0.60) * u_height;
  float y = rotated.y * cos(u_pitch) - height * sin(u_pitch);
  float depth = rotated.y * sin(u_pitch) + height * cos(u_pitch);
  gl_Position = vec4(rotated.x / (u_view.x * 0.5), -y / (u_view.y * 0.5),
                     clamp(-depth / (u_view.y * 4.0), -0.95, 0.95), 1.0);
  v_count = a_cell.z;
  v_light = a_vertex.w;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in float v_count, v_light;
uniform float u_max;
out vec4 o;
void main() {
  float t = clamp(log(1.0 + v_count) / log(1.0 + max(2.0, u_max)), 0.0, 1.0);
  vec3 color = t < 0.25 ? mix(vec3(0.05, 0.47, 0.59), vec3(0.29, 0.85, 0.77), t * 4.0) :
               t < 0.50 ? mix(vec3(0.29, 0.85, 0.77), vec3(0.84, 0.97, 0.72), (t - 0.25) * 4.0) :
               t < 0.75 ? mix(vec3(0.84, 0.97, 0.72), vec3(1.0, 0.72, 0.35), (t - 0.50) * 4.0) :
                          mix(vec3(1.0, 0.72, 0.35), vec3(0.91, 0.22, 0.28), (t - 0.75) * 4.0);
  o = vec4(color * v_light, 1.0);
}`;
function mesh() {
    const out = [];
    const corner = (i)=>[
            Math.cos(i % 6 * Math.PI / 3),
            Math.sin(i % 6 * Math.PI / 3)
        ];
    const vertex = (x, y, z, light)=>out.push(x, y, z, light);
    for(let i = 0; i < 6; i++){
        const [ax, ay] = corner(i), [bx, by] = corner(i + 1);
        vertex(0, 0, 1, 1);
        vertex(ax, ay, 1, 1);
        vertex(bx, by, 1, 1);
        const light = 0.52 + 0.28 * Math.cos((i + 0.5) * Math.PI / 3 - 0.8);
        vertex(ax, ay, 0, light);
        vertex(bx, by, 0, light);
        vertex(bx, by, 1, light);
        vertex(ax, ay, 0, light);
        vertex(bx, by, 1, light);
        vertex(ax, ay, 1, light);
    }
    return new Float32Array(out);
}
function hexRound(q, r) {
    const x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return [
        rx,
        rz
    ];
}
const keyOf = (q, r)=>(q + 32768) * 65536 + r + 32768;
const axial = (x, y, radius)=>hexRound((SQRT3 / 3 * x - y / 3) / radius, 2 / 3 * y / radius);
export async function mount(canvas, url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`data HTTP ${response.status}`);
    const bin = await response.arrayBuffer();
    const head = new DataView(bin);
    if (head.getUint32(0, true) !== 0x31305848) throw new Error('invalid accident data');
    const points = head.getUint32(4, true);
    const bounds = [
        head.getFloat32(8, true),
        head.getFloat32(12, true),
        head.getFloat32(16, true),
        head.getFloat32(20, true)
    ];
    if (bin.byteLength !== 32 + points * 4) throw new Error('truncated accident data');
    const quantized = new Uint16Array(bin, 32);
    const world = new Float32Array(points * 2);
    for(let i = 0; i < points; i++){
        world[2 * i] = bounds[0] + quantized[2 * i] / 65535 * (bounds[2] - bounds[0]);
        world[2 * i + 1] = bounds[1] + quantized[2 * i + 1] / 65535 * (bounds[3] - bounds[1]);
    }
    const ctx = canvas.getContext('webgl2', {
        antialias: false,
        alpha: false
    });
    if (!ctx) throw new Error('WebGL2 unavailable');
    const gl = ctx;
    const program = gl.createProgram();
    if (!program) throw new Error('createProgram failed');
    for (const [kind, source] of [
        [
            gl.VERTEX_SHADER,
            VERTEX
        ],
        [
            gl.FRAGMENT_SHADER,
            FRAGMENT
        ]
    ]){
        const shader = gl.createShader(kind);
        if (!shader) throw new Error('createShader failed');
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed');
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    const loc = (name)=>gl.getUniformLocation(program, name);
    const vao = gl.createVertexArray(), instanceBuffer = gl.createBuffer(), vertexBuffer = gl.createBuffer();
    if (!vao || !instanceBuffer || !vertexBuffer) throw new Error('GPU buffer allocation failed');
    const unitMesh = mesh();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unitMesh, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(1, 1);
    const cam = {
        x: anchorX,
        y: anchorY,
        zoom: 6.6,
        pitch: 40.5,
        bearing: -27
    };
    let radius = 2000, coverage = 0.7, upperPercentile = 100;
    let cells = new Map();
    let cellCount = 0, maxCount = 1, clipCount = 1, aggregateMs = 0, percentileMs = 0;
    const worldPx = ()=>512 * 2 ** cam.zoom;
    function uploadCells() {
        const started = performance.now();
        const counts = [
            ...cells.values()
        ].sort((a, b)=>a - b);
        maxCount = counts[counts.length - 1] ?? 1;
        clipCount = counts[Math.max(0, Math.ceil(counts.length * upperPercentile / 100) - 1)] ?? 1;
        const instances = new Float32Array(cells.size * 3);
        let i = 0;
        for (const [key, count] of cells){
            const q = Math.floor(key / 65536) - 32768;
            const r = key % 65536 - 32768;
            const x = SQRT3 * radius * (q + r / 2);
            const y = 1.5 * radius * r;
            instances[i++] = anchorX + x / METERS_PER_WORLD;
            instances[i++] = anchorY + y / METERS_PER_WORLD;
            instances[i++] = Math.min(count, clipCount);
        }
        cellCount = cells.size;
        gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);
        percentileMs = performance.now() - started;
    }
    function regroup() {
        const started = performance.now();
        cells = new Map();
        for(let i = 0; i < points; i++){
            const x = (world[2 * i] - anchorX) * METERS_PER_WORLD;
            const y = (world[2 * i + 1] - anchorY) * METERS_PER_WORLD;
            const [q, r] = axial(x, y, radius);
            const key = keyOf(q, r);
            cells.set(key, (cells.get(key) ?? 0) + 1);
        }
        uploadCells();
        aggregateMs = performance.now() - started;
    }
    const resize = ()=>{
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
        draw();
    };
    function draw() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.045, 0.075, 0.11, 1);
        gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(program);
        gl.uniform2f(loc('u_center'), cam.x, cam.y);
        gl.uniform2f(loc('u_view'), canvas.width, canvas.height);
        gl.uniform1f(loc('u_world_px'), worldPx());
        gl.uniform1f(loc('u_radius_world'), radius / METERS_PER_WORLD);
        gl.uniform1f(loc('u_coverage'), coverage);
        gl.uniform1f(loc('u_pitch'), cam.pitch * Math.PI / 180);
        gl.uniform1f(loc('u_bearing'), cam.bearing * Math.PI / 180);
        gl.uniform1f(loc('u_max'), clipCount);
        gl.uniform1f(loc('u_height'), 160 * 2 ** (cam.zoom - 6.6));
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, unitMesh.length / 4, cellCount);
        gl.disable(gl.DEPTH_TEST);
    }
    const inverseScreen = (x, y)=>{
        const sx = x - canvas.width / 2;
        const sy = (y - canvas.height / 2) / Math.cos(cam.pitch * Math.PI / 180);
        const a = cam.bearing * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        return {
            x: cam.x + (c * sx + s * sy) / worldPx(),
            y: cam.y + (-s * sx + c * sy) / worldPx()
        };
    };
    const screen = (e)=>{
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * devicePixelRatio,
            y: (e.clientY - r.top) * devicePixelRatio
        };
    };
    let pending = false;
    const render = ()=>{
        if (pending) return;
        pending = true;
        requestAnimationFrame(()=>{
            pending = false;
            draw();
        });
    };
    let dragging = null;
    canvas.addEventListener('pointerdown', (e)=>{
        dragging = {
            ...screen(e),
            shift: e.shiftKey
        };
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', ()=>{
        dragging = null;
    });
    canvas.addEventListener('pointercancel', ()=>{
        dragging = null;
    });
    canvas.addEventListener('pointermove', (e)=>{
        const p = screen(e);
        if (dragging) {
            if (dragging.shift) {
                cam.bearing += (p.x - dragging.x) * 0.25;
                cam.pitch = Math.max(0, Math.min(70, cam.pitch + (p.y - dragging.y) * 0.15));
            } else {
                const a = inverseScreen(dragging.x, dragging.y), b = inverseScreen(p.x, p.y);
                cam.x += a.x - b.x;
                cam.y += a.y - b.y;
            }
            dragging = {
                ...p,
                shift: dragging.shift
            };
            render();
        } else {
            const w = inverseScreen(p.x, p.y);
            const [q, r] = axial((w.x - anchorX) * METERS_PER_WORLD, (w.y - anchorY) * METERS_PER_WORLD, radius);
            const count = cells.get(keyOf(q, r));
            const tip = document.getElementById('tooltip');
            if (tip) {
                tip.textContent = count ? `${count.toLocaleString('ja-JP')} 件の事故` : '';
                tip.style.display = count ? 'block' : 'none';
                tip.style.left = `${e.clientX + 12}px`;
                tip.style.top = `${e.clientY + 12}px`;
            }
        }
    });
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const p = screen(e), before = inverseScreen(p.x, p.y);
        cam.zoom = Math.max(5, Math.min(15, cam.zoom - e.deltaY * 0.002));
        const after = inverseScreen(p.x, p.y);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        render();
    }, {
        passive: false
    });
    new ResizeObserver(resize).observe(canvas);
    regroup();
    resize();
    return {
        gl,
        cam,
        draw,
        points,
        bounds,
        get cells () {
            return cellCount;
        },
        get maxCount () {
            return maxCount;
        },
        get aggregateMs () {
            return aggregateMs;
        },
        get percentileMs () {
            return percentileMs;
        },
        sumCounts: ()=>[
                ...cells.values()
            ].reduce((a, b)=>a + b, 0),
        setRadius: (value)=>{
            radius = Math.max(500, Math.min(10000, value));
            regroup();
            draw();
        },
        setCoverage: (value)=>{
            coverage = Math.max(0.1, Math.min(1, value));
            draw();
        },
        setUpperPercentile: (value)=>{
            upperPercentile = Math.max(50, Math.min(100, value));
            uploadCells();
            draw();
        }
    };
}
