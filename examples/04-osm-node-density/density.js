const POINT_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
uniform vec3 u_cam;   // centre (grid units 0..1), px per grid unit
uniform vec2 u_vp;
void main() {
  vec2 p = (a_pos - u_cam.xy) * u_cam.z;
  gl_Position = vec4(p.x / u_vp.x * 2.0, -p.y / u_vp.y * 2.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;
const POINT_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(1.0); }`;
const FULL_VS = `#version 300 es
void main() { gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0); }`;
const MAX_FS = `#version 300 es
precision highp float;
uniform highp sampler2D u_src;
out vec4 o;
void main() {
  ivec2 size = textureSize(u_src, 0) - 1, b = ivec2(gl_FragCoord.xy) * 4;
  float m = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) m = max(m, texelFetch(u_src, min(b + ivec2(i, j), size), 0).r);
  o = vec4(m);
}`;
const COLOR_FS = `#version 300 es
precision highp float;
uniform highp sampler2D u_count, u_max;
out vec4 o;
void main() {
  float c = texelFetch(u_count, ivec2(gl_FragCoord.xy), 0).r;
  float t = log(1.0 + c) / log(1.0 + max(texelFetch(u_max, ivec2(0), 0).r, 1.0));
  // magma-like ramp: black, purple, orange, pale yellow
  vec3 col = c == 0.0 ? vec3(0.03, 0.03, 0.06)
    : mix(mix(vec3(0.23, 0.06, 0.44), vec3(0.96, 0.42, 0.24), smoothstep(0.0, 0.6, t)), vec3(0.99, 0.95, 0.74), smoothstep(0.6, 1.0, t));
  o = vec4(col, 1.0);
}`;
export async function mount(canvas, url) {
    const bin = await fetch(url).then((r)=>r.arrayBuffer());
    const n = new Uint32Array(bin, 0, 1)[0];
    const bbox = new Float64Array(bin, 8, 4);
    const dx = new Uint16Array(bin, 40, n), dy = new Uint16Array(bin, 40 + n * 2, n);
    const S = 128;
    const per = Math.ceil(n / S);
    const pos = new Uint16Array(n * 2);
    for(let i = 0, x = 0, y = 0; i < n; i++){
        const j = i % S * per + Math.floor(i / S);
        x = x + dx[i] & 0xffff;
        y = y + dy[i] & 0xffff;
        pos[2 * j] = x;
        pos[2 * j + 1] = y;
    }
    const ctx = canvas.getContext('webgl2', {
        antialias: false,
        alpha: false
    });
    if (!ctx) throw new Error('WebGL2 unavailable');
    const gl = ctx;
    for (const e of [
        'EXT_color_buffer_float',
        'EXT_float_blend'
    ])if (!gl.getExtension(e)) throw new Error(`${e} unavailable`);
    const program = (vs, fs)=>{
        const p = gl.createProgram();
        for (const [t, src] of [
            [
                gl.VERTEX_SHADER,
                vs
            ],
            [
                gl.FRAGMENT_SHADER,
                fs
            ]
        ]){
            const s = gl.createShader(t);
            if (!s) throw new Error('createShader failed');
            gl.shaderSource(s, src);
            gl.compileShader(s);
            gl.attachShader(p, s);
        }
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link failed');
        return p;
    };
    const pointP = program(POINT_VS, POINT_FS), maxP = program(FULL_VS, MAX_FS), colorP = program(FULL_VS, COLOR_FS);
    const uni = (p, name)=>gl.getUniformLocation(p, name);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 0, 0);
    const empty = gl.createVertexArray();
    let levels = [];
    const target = (w, h)=>{
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return {
            tex,
            fbo,
            w,
            h
        };
    };
    function resize() {
        for (const l of levels){
            gl.deleteTexture(l.tex);
            gl.deleteFramebuffer(l.fbo);
        }
        let w = canvas.width, h = canvas.height;
        levels = [
            target(w, h)
        ];
        while(w > 1 || h > 1){
            w = Math.ceil(w / 4);
            h = Math.ceil(h / 4);
            levels.push(target(w, h));
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const cam = {
        x: 0.5,
        y: 0.5,
        zoom: 1
    };
    const scale = ()=>cam.zoom * Math.min(canvas.width, canvas.height);
    function draw() {
        const [count] = levels;
        gl.bindFramebuffer(gl.FRAMEBUFFER, count.fbo);
        gl.viewport(0, 0, count.w, count.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(pointP);
        gl.uniform3f(uni(pointP, 'u_cam'), cam.x, cam.y, scale());
        gl.uniform2f(uni(pointP, 'u_vp'), count.w, count.h);
        gl.bindVertexArray(vao);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, n);
        gl.disable(gl.BLEND);
        gl.useProgram(maxP);
        gl.bindVertexArray(empty);
        for(let i = 1; i < levels.length; i++){
            gl.bindFramebuffer(gl.FRAMEBUFFER, levels[i].fbo);
            gl.viewport(0, 0, levels[i].w, levels[i].h);
            gl.bindTexture(gl.TEXTURE_2D, levels[i - 1].tex);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(colorP);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, count.tex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, levels[levels.length - 1].tex);
        gl.uniform1i(uni(colorP, 'u_count'), 0);
        gl.uniform1i(uni(colorP, 'u_max'), 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
    }
    let pending = false;
    const render = ()=>{
        if (!pending) {
            pending = true;
            requestAnimationFrame(()=>{
                pending = false;
                draw();
            });
        }
    };
    const dev = (e)=>{
        const r = canvas.getBoundingClientRect();
        return [
            (e.clientX - r.left) * devicePixelRatio,
            (e.clientY - r.top) * devicePixelRatio
        ];
    };
    const toGrid = ([sx, sy])=>[
            cam.x + (sx - canvas.width / 2) / scale(),
            cam.y + (sy - canvas.height / 2) / scale()
        ];
    let drag = null;
    canvas.addEventListener('pointerdown', (e)=>{
        drag = dev(e);
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', ()=>{
        drag = null;
    });
    canvas.addEventListener('pointermove', (e)=>{
        if (!drag) return;
        const p = dev(e);
        cam.x -= (p[0] - drag[0]) / scale();
        cam.y -= (p[1] - drag[1]) / scale();
        drag = p;
        render();
    });
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const p = dev(e), before = toGrid(p);
        cam.zoom = Math.min(1024, Math.max(0.5, cam.zoom * Math.exp(-e.deltaY * 0.002)));
        const after = toGrid(p);
        cam.x += before[0] - after[0];
        cam.y += before[1] - after[1];
        render();
    }, {
        passive: false
    });
    new ResizeObserver(()=>{
        canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
        canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
        resize();
        draw();
    }).observe(canvas);
    return {
        gl,
        cam,
        draw,
        points: n,
        bbox,
        countTarget: ()=>levels[0]
    };
}
