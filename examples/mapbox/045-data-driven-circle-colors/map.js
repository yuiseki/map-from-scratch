const VS = `#version 300 es
layout(location=0) in vec3 a_point;
uniform vec2 u_center;
uniform vec2 u_view;
uniform float u_world_px;
uniform float u_dpr;
uniform vec3 u_low, u_mid, u_high;
out vec3 v_color;
void main() {
  vec2 delta = a_point.xy - u_center;
  delta.x -= floor(delta.x + 0.5);
  vec2 px = delta * u_world_px;
  gl_Position = vec4(px.x / (u_view.x * 0.5), -px.y / (u_view.y * 0.5), 0.0, 1.0);
  float m = a_point.z;
  vec3 color = m <= 1.0 ? u_low :
               m <= 3.0 ? mix(u_low, u_mid, (m - 1.0) * 0.5) :
               m <= 6.0 ? mix(u_mid, u_high, (m - 3.0) / 3.0) : u_high;
  float radius = m <= 1.0 ? 3.0 :
                 m <= 3.0 ? mix(3.0, 6.0, (m - 1.0) * 0.5) :
                 m <= 6.0 ? mix(6.0, 14.0, (m - 3.0) / 3.0) : 14.0;
  v_color = color;
  gl_PointSize = max(1.0, radius * 2.0 * u_dpr);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 v_color;
out vec4 o;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0) discard;
  float a = 1.0 - smoothstep(0.86, 1.0, d);
  o = vec4(v_color * a, a);
}`;
export const STOPS = [
    {
        mag: 1,
        radius: 3,
        color: [
            252,
            161,
            7
        ]
    },
    {
        mag: 3,
        radius: 6,
        color: [
            46,
            83,
            255
        ]
    },
    {
        mag: 6,
        radius: 14,
        color: [
            255,
            0,
            64
        ]
    }
];
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
export function colorForMag(mag) {
    if (mag <= STOPS[0].mag) return [
        ...STOPS[0].color
    ];
    if (mag >= STOPS[2].mag) return [
        ...STOPS[2].color
    ];
    for(let i = 1; i < STOPS.length; i++){
        const hi = STOPS[i];
        if (mag > hi.mag) continue;
        const lo = STOPS[i - 1];
        const t = (mag - lo.mag) / (hi.mag - lo.mag);
        return lo.color.map((c, k)=>Math.round(c + (hi.color[k] - c) * t));
    }
    return [
        ...STOPS[2].color
    ];
}
export function radiusForMag(mag) {
    if (mag <= STOPS[0].mag) return STOPS[0].radius;
    if (mag >= STOPS[2].mag) return STOPS[2].radius;
    for(let i = 1; i < STOPS.length; i++){
        const hi = STOPS[i];
        if (mag > hi.mag) continue;
        const lo = STOPS[i - 1];
        return lo.radius + (hi.radius - lo.radius) * ((mag - lo.mag) / (hi.mag - lo.mag));
    }
    return STOPS[2].radius;
}
function compile(gl, kind, source) {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('createShader failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
    return shader;
}
export class DataDrivenCirclesMap {
    canvas;
    gl;
    landCanvas;
    landCtx;
    points = new Float32Array(0);
    count = 0;
    magMin = 0;
    magMax = 0;
    cam = {
        x: mercX(0),
        y: mercY(20),
        zoom: 2
    };
    dpr = 1;
    landPaths = [];
    program;
    vao;
    buffer;
    uniform;
    drag = null;
    constructor(canvas, landCanvas){
        this.canvas = canvas;
        this.landCanvas = landCanvas;
        const gl = canvas.getContext('webgl2', {
            antialias: false,
            alpha: true,
            preserveDrawingBuffer: true
        });
        const landCtx = landCanvas.getContext('2d');
        if (!gl || !landCtx) throw new Error('WebGL2 or Canvas2D unavailable');
        this.gl = gl;
        this.landCtx = landCtx;
        const program = gl.createProgram();
        const vao = gl.createVertexArray();
        const buffer = gl.createBuffer();
        if (!program || !vao || !buffer) throw new Error('WebGL allocation failed');
        this.program = program;
        this.vao = vao;
        this.buffer = buffer;
        const vs = compile(gl, gl.VERTEX_SHADER, VS);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this.uniform = (name)=>gl.getUniformLocation(program, name);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.resize();
        new ResizeObserver(()=>{
            this.resize();
            this.draw();
        }).observe(canvas);
        this.setupInteractions();
    }
    async load(baseDir = '../../..') {
        const [quakeRes, landRes] = await Promise.all([
            fetch(`${baseDir}/data/baked/mapbox-045-data-driven-circle-colors/quakes.bin`),
            fetch(`${baseDir}/data/baked/mapbox-045-data-driven-circle-colors/land.json`)
        ]);
        if (!quakeRes.ok || !landRes.ok) throw new Error(`data HTTP ${quakeRes.status} / ${landRes.status}`);
        const [quakeBuf, polygons] = await Promise.all([
            quakeRes.arrayBuffer(),
            landRes.json()
        ]);
        const view = new DataView(quakeBuf);
        if (view.getUint32(0, true) !== 0x31434444) throw new Error('invalid quake data');
        const count = view.getUint32(4, true);
        if (quakeBuf.byteLength !== 8 + count * 12) throw new Error('truncated quake data');
        this.count = count;
        this.points = new Float32Array(count * 3);
        let minMag = Infinity;
        let maxMag = -Infinity;
        for(let i = 0; i < count; i++){
            const at = 8 + i * 12;
            this.points[i * 3] = view.getFloat32(at, true);
            this.points[i * 3 + 1] = view.getFloat32(at + 4, true);
            this.points[i * 3 + 2] = view.getFloat32(at + 8, true);
            minMag = Math.min(minMag, this.points[i * 3 + 2]);
            maxMag = Math.max(maxMag, this.points[i * 3 + 2]);
        }
        this.magMin = minMag;
        this.magMax = maxMag;
        this.landPaths = polygons.map((rings)=>{
            const path = new Path2D();
            for (const ring of rings){
                if (!ring.length) continue;
                path.moveTo(ring[0][0], ring[0][1]);
                for(let i = 1; i < ring.length; i++)path.lineTo(ring[i][0], ring[i][1]);
                path.closePath();
            }
            return path;
        });
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.points, gl.STATIC_DRAW);
        this.draw();
    }
    worldPx() {
        return 512 * 2 ** this.cam.zoom * this.dpr;
    }
    resize() {
        this.dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round((this.canvas.clientWidth || window.innerWidth) * this.dpr));
        const h = Math.max(1, Math.round((this.canvas.clientHeight || window.innerHeight) * this.dpr));
        this.canvas.width = w;
        this.canvas.height = h;
        this.landCanvas.width = w;
        this.landCanvas.height = h;
    }
    panBy(dx, dy) {
        const scale = 512 * 2 ** this.cam.zoom;
        this.cam.x -= dx / scale;
        this.cam.y -= dy / scale;
        this.draw();
    }
    setZoom(zoom) {
        this.cam.zoom = Math.max(1, Math.min(6, zoom));
        this.draw();
    }
    zoomAt(zoom, x, y) {
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const scale = 512 * 2 ** this.cam.zoom;
        const mx = this.cam.x + (x - w / 2) / scale;
        const my = this.cam.y + (y - h / 2) / scale;
        this.cam.zoom = Math.max(1, Math.min(6, zoom));
        const next = 512 * 2 ** this.cam.zoom;
        this.cam.x = mx - (x - w / 2) / next;
        this.cam.y = my - (y - h / 2) / next;
        this.draw();
    }
    setCenter(lon, lat) {
        this.cam.x = mercX(lon);
        this.cam.y = mercY(lat);
        this.draw();
    }
    centerOn(index) {
        this.cam.x = this.points[index * 3];
        this.cam.y = this.points[index * 3 + 1];
        this.draw();
    }
    magOf(index) {
        return this.points[index * 3 + 2];
    }
    screenOf(index) {
        let dx = this.points[index * 3] - this.cam.x;
        dx -= Math.floor(dx + 0.5);
        const scale = 512 * 2 ** this.cam.zoom;
        return {
            x: this.canvas.width / (2 * this.dpr) + dx * scale,
            y: this.canvas.height / (2 * this.dpr) + (this.points[index * 3 + 1] - this.cam.y) * scale
        };
    }
    readPixel(x, y) {
        const px = new Uint8Array(4);
        this.gl.readPixels(Math.round(x * this.dpr), Math.round(this.canvas.height - 1 - y * this.dpr), 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
        return px;
    }
    setupInteractions() {
        this.canvas.addEventListener('pointerdown', (e)=>{
            this.drag = {
                x: e.clientX,
                y: e.clientY
            };
            this.canvas.setPointerCapture(e.pointerId);
        });
        this.canvas.addEventListener('pointermove', (e)=>{
            if (!this.drag) return;
            const dx = e.clientX - this.drag.x;
            const dy = e.clientY - this.drag.y;
            this.drag = {
                x: e.clientX,
                y: e.clientY
            };
            this.panBy(dx, dy);
        });
        this.canvas.addEventListener('pointerup', (e)=>{
            this.drag = null;
            try {
                this.canvas.releasePointerCapture(e.pointerId);
            } catch  {}
        });
        this.canvas.addEventListener('wheel', (e)=>{
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            this.zoomAt(this.cam.zoom + (e.deltaY < 0 ? 0.25 : -0.25), e.clientX - rect.left, e.clientY - rect.top);
        }, {
            passive: false
        });
    }
    drawLand() {
        const ctx = this.landCtx;
        const scale = this.worldPx();
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#b8dcf2';
        ctx.fillRect(0, 0, w, h);
        const minWrap = Math.floor(this.cam.x - w / (2 * scale)) - 1;
        const maxWrap = Math.ceil(this.cam.x + w / (2 * scale)) + 1;
        ctx.fillStyle = '#f4f2e8';
        ctx.strokeStyle = '#cbc6b6';
        ctx.lineWidth = this.dpr / scale;
        for(let wrap = minWrap; wrap <= maxWrap; wrap++){
            ctx.setTransform(scale, 0, 0, scale, w / 2 - (this.cam.x - wrap) * scale, h / 2 - this.cam.y * scale);
            for (const path of this.landPaths){
                ctx.fill(path, 'evenodd');
                ctx.stroke(path);
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    draw() {
        this.drawLand();
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);
        gl.uniform2f(this.uniform('u_center'), this.cam.x, this.cam.y);
        gl.uniform2f(this.uniform('u_view'), this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniform('u_world_px'), this.worldPx());
        gl.uniform1f(this.uniform('u_dpr'), this.dpr);
        gl.uniform3f(this.uniform('u_low'), ...STOPS[0].color.map((c)=>c / 255));
        gl.uniform3f(this.uniform('u_mid'), ...STOPS[1].color.map((c)=>c / 255));
        gl.uniform3f(this.uniform('u_high'), ...STOPS[2].color.map((c)=>c / 255));
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.POINTS, 0, this.count);
    }
}
