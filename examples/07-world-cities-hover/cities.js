const AY = 1.3174 / 2.7066;
const CAM = `uniform vec3 u_cam; uniform vec2 u_vp;
vec4 place(vec2 w) {
  vec2 p = (w - u_cam.xy) * u_cam.z * vec2(1.0, ${AY.toFixed(6)});
  return vec4(p.x / u_vp.x * 2.0, -p.y / u_vp.y * 2.0, 0.0, 1.0);
}`;
const LAND_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
${CAM}
void main() { gl_Position = place(a_pos); }`;
const LAND_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.87, 0.86, 0.82, 1.0); }`;
const BORDER_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.47, 0.46, 0.43, 1.0); }`;
const CITY_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_r;   // radius * 10, CSS px
${CAM}
uniform float u_px;                // device pixel ratio
out float v_r;
void main() {
  gl_Position = place(a_pos);
  v_r = a_r * 0.1 * u_px;
  gl_PointSize = 2.0 * v_r + 2.0;
}`;
const CITY_FS = `#version 300 es
precision mediump float;
in float v_r;
uniform int u_hl;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - 0.5) * (2.0 * v_r + 2.0);   // device px from centre
  if (d > v_r + 0.5) discard;
  float edge = clamp(v_r + 0.5 - d, 0.0, 1.0);                 // antialiased rim
  vec3 fill = u_hl == 1 ? vec3(0.1, 0.25, 0.75) : vec3(0.85, 0.3, 0.15);
  vec3 c = d > v_r - 1.0 ? vec3(1.0) : fill;
  o = vec4(c, (u_hl == 1 ? 1.0 : 0.75) * edge);
}`;
export async function mount(canvas, base, onHover) {
    const [land, borders, cbin, nbin] = await Promise.all([
        'land.bin',
        'borders.bin',
        'cities.bin',
        'names.bin'
    ].map((f)=>fetch(`${base}/${f}`).then((r)=>r.arrayBuffer())));
    const ctx = canvas.getContext('webgl2', {
        antialias: true,
        alpha: false,
        stencil: true
    });
    if (!ctx) throw new Error('WebGL2 is not available');
    const gl = ctx;
    const program = (vs, fs)=>{
        const p = gl.createProgram();
        for (const [type, src] of [
            [
                gl.VERTEX_SHADER,
                vs
            ],
            [
                gl.FRAGMENT_SHADER,
                fs
            ]
        ]){
            const s = gl.createShader(type);
            if (!s) throw new Error('createShader failed');
            gl.shaderSource(s, src);
            gl.compileShader(s);
            gl.attachShader(p, s);
        }
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? '');
        const u = (n)=>gl.getUniformLocation(p, n);
        return {
            p,
            cam: u('u_cam'),
            vp: u('u_vp'),
            px: u('u_px'),
            hl: u('u_hl')
        };
    };
    const landP = program(LAND_VS, LAND_FS), borderP = program(LAND_VS, BORDER_FS), cityP = program(CITY_VS, CITY_FS);
    const undelta = (src, n)=>{
        const out = new Uint16Array(2 * n);
        for(let i = 0, x = 0, y = 0; i < n; i++){
            out[2 * i] = x = x + src[i] & 0xffff;
            out[2 * i + 1] = y = y + src[n + i] & 0xffff;
        }
        return out;
    };
    const buffer = (target, data)=>{
        gl.bindBuffer(target, gl.createBuffer());
        gl.bufferData(target, data, gl.STATIC_DRAW);
    };
    const [lv, lr] = new Uint32Array(land, 0, 2);
    const rings = new Uint32Array(land, 8 + (lv * 4 + 3 & ~3), lr);
    const fan = new Uint16Array(3 * (lv - 2 * lr));
    for(let r = 0, s = 0, k = 0; r < lr; s += rings[r++]){
        for(let j = 1; j < rings[r] - 1; j++){
            fan[k++] = s;
            fan[k++] = s + j;
            fan[k++] = s + j + 1;
        }
    }
    const landVao = gl.createVertexArray();
    gl.bindVertexArray(landVao);
    buffer(gl.ARRAY_BUFFER, undelta(new Uint16Array(land, 8, 2 * lv), lv));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 0, 0);
    buffer(gl.ELEMENT_ARRAY_BUFFER, fan);
    const [bv, bl] = new Uint32Array(borders, 0, 2);
    const blens = new Uint16Array(borders, 8 + 4 * bv, bl);
    const bpos = undelta(new Uint16Array(borders, 8, 2 * bv), bv);
    const seg = new Uint16Array(4 * (bv - bl));
    for(let r = 0, s = 0, k = 0; r < bl; s += blens[r++]){
        for(let j = 1; j < blens[r]; j++, k += 4){
            seg[k] = bpos[2 * (s + j - 1)];
            seg[k + 1] = bpos[2 * (s + j - 1) + 1];
            seg[k + 2] = bpos[2 * (s + j)];
            seg[k + 3] = bpos[2 * (s + j) + 1];
        }
    }
    const borderVao = gl.createVertexArray();
    gl.bindVertexArray(borderVao);
    buffer(gl.ARRAY_BUFFER, seg);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 0, 0);
    const n = new Uint32Array(cbin, 0, 1)[0];
    const pos = undelta(new Uint16Array(cbin, 4, 2 * n), n);
    const rad = new Uint8Array(cbin, 4 + 4 * n, n), country = new Uint8Array(cbin, 4 + 5 * n, n);
    const pop = new Uint32Array(cbin, 4 + (6 * n + 3 & ~3), n);
    const cityVao = gl.createVertexArray();
    gl.bindVertexArray(cityVao);
    buffer(gl.ARRAY_BUFFER, pos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 0, 0);
    buffer(gl.ARRAY_BUFFER, rad);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.bindVertexArray(null);
    const [cn, nn] = new TextDecoder('utf-16le').decode(nbin).split('\n\n').map((t)=>t.split('\n'));
    const cam = {
        x: 0.5,
        y: 0.5,
        zoom: 1
    };
    let hover = -1, pending = false;
    const W = ()=>canvas.width, H = ()=>canvas.height;
    const scale = ()=>cam.zoom * W();
    function draw() {
        pending = false;
        gl.viewport(0, 0, W(), H());
        gl.clearColor(0.8, 0.88, 0.93, 1);
        gl.clearStencil(0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        for (const { p, cam: c, vp } of [
            landP,
            borderP,
            cityP
        ]){
            gl.useProgram(p);
            gl.uniform3f(c, cam.x, cam.y, scale());
            gl.uniform2f(vp, W(), H());
        }
        gl.useProgram(landP.p);
        gl.bindVertexArray(landVao);
        gl.enable(gl.STENCIL_TEST);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 0, 1);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        gl.drawElements(gl.TRIANGLES, fan.length, gl.UNSIGNED_SHORT, 0);
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.NOTEQUAL, 0, 1);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
        gl.drawElements(gl.TRIANGLES, fan.length, gl.UNSIGNED_SHORT, 0);
        gl.disable(gl.STENCIL_TEST);
        gl.useProgram(borderP.p);
        gl.bindVertexArray(borderVao);
        gl.drawArrays(gl.LINES, 0, seg.length / 2);
        gl.useProgram(cityP.p);
        gl.uniform1f(cityP.px, devicePixelRatio);
        gl.bindVertexArray(cityVao);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1i(cityP.hl, 0);
        gl.drawArrays(gl.POINTS, 0, n);
        if (hover >= 0) {
            gl.uniform1i(cityP.hl, 1);
            gl.drawArrays(gl.POINTS, hover, 1);
        }
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
            cam.y + (sy - H() / 2) / (scale() * AY)
        ];
    function pick(sx, sy) {
        const [wx, wy] = toWorld(sx, sy);
        const kx = scale() / 65535, ky = kx * AY, dpr = devicePixelRatio;
        const ux = wx * 65535, uy = wy * 65535;
        for(let i = n - 1; i >= 0; i--){
            const dx = (pos[2 * i] - ux) * kx, dy = (pos[2 * i + 1] - uy) * ky;
            const r = Math.max(rad[i] * 0.1, 2) * dpr;
            if (dx * dx + dy * dy <= r * r) return i;
        }
        return -1;
    }
    const city = (i)=>({
            name: nn[i],
            country: cn[country[i]],
            population: pop[i]
        });
    function setHover(i) {
        if (i === hover) return;
        hover = i;
        render();
        if (onHover) onHover(i < 0 ? null : city(i));
    }
    function zoomAt(sx, sy, f) {
        const [wx, wy] = toWorld(sx, sy);
        cam.zoom = Math.min(32, Math.max(1, cam.zoom * f));
        const [nx, ny] = toWorld(sx, sy);
        cam.x += wx - nx;
        cam.y += wy - ny;
        render();
    }
    const dev = (e)=>{
        const r = canvas.getBoundingClientRect();
        return [
            (e.clientX - r.left) * devicePixelRatio,
            (e.clientY - r.top) * devicePixelRatio
        ];
    };
    let drag = null;
    canvas.addEventListener('pointerdown', (e)=>{
        drag = dev(e);
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', ()=>{
        drag = null;
    });
    canvas.addEventListener('pointerleave', ()=>setHover(-1));
    canvas.addEventListener('pointermove', (e)=>{
        const p = dev(e);
        if (drag) {
            cam.x -= (p[0] - drag[0]) / scale();
            cam.y -= (p[1] - drag[1]) / (scale() * AY);
            drag = p;
            render();
        }
        setHover(pick(...p));
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
        setHover,
        city,
        n,
        pos,
        rad,
        landVertices: lv,
        fanTriangles: fan.length / 3,
        borderVertices: bv,
        borderSegments: seg.length / 4
    };
}
