const VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in uint a_id;
uniform vec3 u_cam;   // centre x, centre y (world units 0..1), px per world width
uniform vec2 u_vp;    // viewport in px
flat out uint v_id;
void main() {
  vec2 p = (a_pos - u_cam.xy) * u_cam.z * vec2(1.0, ${(1.3174 / 2.7066).toFixed(6)});
  gl_Position = vec4(p.x / u_vp.x * 2.0, -p.y / u_vp.y * 2.0, 0.0, 1.0);
  v_id = a_id;
}`;
const FS = `#version 300 es
precision mediump float;
flat in uint v_id;
uniform sampler2D u_pal;
uniform int u_mode;   // 0 fill, 1 border, 2 id
uniform uint u_sel;
out vec4 o;
void main() {
  if (u_mode == 2) o = vec4(float(v_id & 255u), float(v_id >> 8), 0.0, 255.0) / 255.0;
  else if (u_mode == 1) o = vec4(1.0, 1.0, 1.0, 0.6);
  else if (v_id == u_sel) o = vec4(0.95, 0.35, 0.2, 1.0);
  else o = texelFetch(u_pal, ivec2(v_id, 0), 0);
}`;
const BREAKS = [
    1e5,
    1e6,
    5e6,
    1e7,
    3e7,
    1e8,
    3e8
];
const COLORS = [
    '#fff7ec',
    '#fee8c8',
    '#fdd49e',
    '#fdbb84',
    '#fc8d59',
    '#e34a33',
    '#b30000',
    '#7f0000'
];
export async function mount(canvas, base, onPick) {
    const [bin, countries] = await Promise.all([
        fetch(`${base}/world.bin`).then((r)=>r.arrayBuffer()),
        fetch(`${base}/countries.json`).then((r)=>r.json())
    ]);
    const [nv, nt, nr] = new Uint32Array(bin, 0, 3);
    let o = 12;
    const take = (T, n)=>{
        const a = new T(bin, o, n);
        o += n * T.BYTES_PER_ELEMENT;
        return a;
    };
    const dx = take(Uint16Array, nv), dy = take(Uint16Array, nv), ids = take(Uint16Array, nv);
    o = o + 3 & ~3;
    const rings = take(Uint32Array, nr), dt = take(Uint32Array, nt);
    const pos = new Uint16Array(nv * 2);
    for(let i = 0, x = 0, y = 0; i < nv; i++){
        pos[2 * i] = x = x + dx[i] & 0xffff;
        pos[2 * i + 1] = y = y + dy[i] & 0xffff;
    }
    const nl = nv * 2;
    const idx = new Uint32Array(nt + nl);
    for(let i = 0, t = 0; i < nt; i++)idx[i] = t = t + dt[i] >>> 0;
    for(let r = 0, k = nt, s = 0; r < nr; s += rings[r++]){
        for(let j = 0; j < rings[r]; j++){
            idx[k++] = s + j;
            idx[k++] = s + (j + 1) % rings[r];
        }
    }
    const ctx = canvas.getContext('webgl2', {
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: false
    });
    if (!ctx) throw new Error('WebGL2 is not available');
    const gl = ctx;
    const sh = (type, src)=>{
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const u = (n)=>gl.getUniformLocation(prog, n);
    const uCam = u('u_cam'), uVp = u('u_vp'), uMode = u('u_mode'), uSel = u('u_sel');
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const pal = new Uint8Array(countries.length * 4);
    countries.forEach(([, , pop], i)=>{
        const c = COLORS[BREAKS.findIndex((b)=>pop < b) + 1 || BREAKS.length];
        for(let k = 0; k < 3; k++)pal[i * 4 + k] = parseInt(c.slice(1 + 2 * k, 3 + 2 * k), 16);
        pal[i * 4 + 3] = 255;
    });
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, countries.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pal);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 1, 1);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const cam = {
        x: 0.5,
        y: 0.5,
        zoom: 1
    };
    let selected = 0xffff, pending = false;
    const W = ()=>canvas.width, H = ()=>canvas.height;
    const scale = ()=>cam.zoom * W();
    function draw() {
        pending = false;
        gl.viewport(0, 0, W(), H());
        gl.clearColor(0.85, 0.91, 0.95, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform3f(uCam, cam.x, cam.y, scale());
        gl.uniform2f(uVp, W(), H());
        gl.uniform1ui(uSel, selected);
        gl.uniform1i(uMode, 0);
        gl.drawElements(gl.TRIANGLES, nt, gl.UNSIGNED_INT, 0);
        gl.enable(gl.BLEND);
        gl.uniform1i(uMode, 1);
        gl.drawElements(gl.LINES, nl, gl.UNSIGNED_INT, nt * 4);
        gl.disable(gl.BLEND);
    }
    const render = ()=>{
        if (!pending) {
            pending = true;
            requestAnimationFrame(draw);
        }
    };
    const toWorld = (sx, sy)=>[
            cam.x + (sx - W() / 2) / scale(),
            cam.y + (sy - H() / 2) / (scale() * (1.3174 / 2.7066))
        ];
    function pick(sx, sy) {
        const [wx, wy] = toWorld(sx, sy);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, 1, 1);
        gl.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform3f(uCam, wx, wy, scale());
        gl.uniform2f(uVp, 1, 1);
        gl.uniform1i(uMode, 2);
        gl.drawElements(gl.TRIANGLES, nt, gl.UNSIGNED_INT, 0);
        const px = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const id = px[0] | px[1] << 8;
        return id === 0xffff ? -1 : id;
    }
    function select(id) {
        selected = id < 0 ? 0xffff : id;
        render();
        if (onPick) onPick(id < 0 ? null : {
            code: countries[id][0],
            name: countries[id][1],
            population: countries[id][2]
        });
    }
    function zoomAt(sx, sy, f) {
        const [wx, wy] = toWorld(sx, sy);
        cam.zoom = Math.min(32, Math.max(1, cam.zoom * f));
        const [nx, ny] = toWorld(sx, sy);
        cam.x += wx - nx;
        cam.y += wy - ny;
        render();
    }
    const ptrs = new Map();
    let down = null;
    const dev = (e)=>{
        const r = canvas.getBoundingClientRect();
        return [
            (e.clientX - r.left) * devicePixelRatio,
            (e.clientY - r.top) * devicePixelRatio
        ];
    };
    canvas.addEventListener('pointerdown', (e)=>{
        canvas.setPointerCapture(e.pointerId);
        ptrs.set(e.pointerId, dev(e));
        down = ptrs.size === 1 ? {
            p: dev(e),
            t: e.timeStamp,
            moved: false
        } : null;
    });
    canvas.addEventListener('pointermove', (e)=>{
        if (!ptrs.has(e.pointerId)) return;
        const prev = ptrs.get(e.pointerId), cur = dev(e);
        if (ptrs.size === 1) {
            cam.x -= (cur[0] - prev[0]) / scale();
            cam.y -= (cur[1] - prev[1]) / (scale() * (1.3174 / 2.7066));
            if (down && Math.hypot(cur[0] - down.p[0], cur[1] - down.p[1]) > 8 * devicePixelRatio) down.moved = true;
            render();
        } else if (ptrs.size === 2) {
            const [a, b] = [
                ...ptrs.values()
            ];
            const other = a === prev ? b : a;
            const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
            const d1 = Math.hypot(cur[0] - other[0], cur[1] - other[1]);
            if (d0 > 0) zoomAt((cur[0] + other[0]) / 2, (cur[1] + other[1]) / 2, d1 / d0);
        }
        ptrs.set(e.pointerId, cur);
    });
    const up = (e)=>{
        ptrs.delete(e.pointerId);
        if (down && !down.moved && e.timeStamp - down.t < 400) select(pick(...dev(e)));
        down = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (e)=>{
        ptrs.delete(e.pointerId);
        down = null;
    });
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        zoomAt(...dev(e), Math.exp(-e.deltaY * 0.002));
    }, {
        passive: false
    });
    new ResizeObserver(()=>{
        canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
        canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
        draw();
    }).observe(canvas);
    return {
        gl,
        cam,
        draw,
        pick,
        select,
        countries,
        vertices: nv,
        triangles: nt / 3
    };
}
