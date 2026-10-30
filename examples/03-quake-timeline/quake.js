const AY = (1.3174 / 2.7066).toFixed(6);
const CAM = `uniform vec3 u_cam; uniform vec2 u_vp;
vec4 place(vec2 w) {
  vec2 p = (w - u_cam.xy) * u_cam.z * vec2(1.0, ${AY});
  return vec4(p.x / u_vp.x * 2.0, -p.y / u_vp.y * 2.0, 0.0, 1.0);
}`;
const LAND_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
${CAM}
void main() { gl_Position = place(a_pos); }`;
const LAND_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.82, 0.83, 0.80, 1.0); }`;
const QUAKE_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_t;
layout(location=2) in vec2 a_md;   // magnitude*10-40, depth/3 km (unnormalised bytes)
${CAM}
uniform float u_time;              // minutes since 2025-01-01
uniform float u_fade;              // minutes an event stays visible
uniform float u_px;                // device pixel ratio
out vec4 v_col;
out float v_ring;                  // ripple radius as a fraction of the point
void main() {
  float age = u_time - a_t;
  if (age < 0.0 || age > u_fade) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float mag = a_md.x / 10.0 + 4.0, depth = a_md.y * 3.0;
  float dot = 3.0 * pow(1.8, mag - 4.5) * u_px;
  float ripple = age < 720.0 ? age / 720.0 : 0.0;          // 12 hours
  float size = max(dot, dot * 4.0 * ripple);
  gl_Position = place(a_pos);
  gl_PointSize = size;
  v_ring = ripple > 0.0 ? 1.0 : 0.0;
  vec3 c = depth < 70.0 ? vec3(0.85, 0.18, 0.12) : depth < 300.0 ? vec3(0.95, 0.65, 0.1) : vec3(0.2, 0.4, 0.85);
  v_col = vec4(c, 1.0 - 0.85 * age / u_fade);
  v_ring *= dot / size;
}`;
const QUAKE_FS = `#version 300 es
precision mediump float;
in vec4 v_col;
in float v_ring;
out vec4 o;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = v_ring > 0.0 ? v_ring : 1.0;
  float a = r < core ? 1.0 : (v_ring > 0.0 && r > 0.9 && r < 1.0 ? 0.6 : 0.0);
  if (a == 0.0) discard;
  o = vec4(v_col.rgb, v_col.a * a);
}`;
export async function mount(canvas, base) {
    const [land, quakes] = await Promise.all([
        'land.bin',
        'quakes.bin'
    ].map((f)=>fetch(`${base}/${f}`).then((r)=>r.arrayBuffer())));
    const ctx = canvas.getContext('webgl2', {
        antialias: true,
        alpha: false
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
            gl.shaderSource(s, src);
            gl.compileShader(s);
            gl.attachShader(p, s);
        }
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? '');
        const u = {};
        for(let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++){
            const name = gl.getActiveUniform(p, i).name;
            u[name] = gl.getUniformLocation(p, name);
        }
        return {
            p,
            u
        };
    };
    const landP = program(LAND_VS, LAND_FS), quakeP = program(QUAKE_VS, QUAKE_FS);
    const [nv, ni] = new Uint32Array(land, 0, 2);
    const landVao = gl.createVertexArray();
    gl.bindVertexArray(landVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array(land, 8, nv * 2), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(land, 8 + nv * 4, ni), gl.STATIC_DRAW);
    const nq = quakes.byteLength / 12;
    const quakeVao = gl.createVertexArray();
    gl.bindVertexArray(quakeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, quakes, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 12, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.UNSIGNED_BYTE, false, 12, 8);
    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const state = {
        x: 0.5,
        y: 0.5,
        zoom: 1,
        time: 0,
        fade: 3 * 1440
    };
    const W = ()=>canvas.width, H = ()=>canvas.height;
    function draw() {
        gl.viewport(0, 0, W(), H());
        gl.clearColor(0.13, 0.17, 0.23, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (const [{ p, u }, vao] of [
            [
                landP,
                landVao
            ],
            [
                quakeP,
                quakeVao
            ]
        ]){
            gl.useProgram(p);
            gl.bindVertexArray(vao);
            gl.uniform3f(u.u_cam, state.x, state.y, state.zoom * W());
            gl.uniform2f(u.u_vp, W(), H());
        }
        gl.useProgram(landP.p);
        gl.bindVertexArray(landVao);
        gl.drawElements(gl.TRIANGLES, ni, gl.UNSIGNED_INT, 0);
        gl.useProgram(quakeP.p);
        gl.uniform1f(quakeP.u.u_time, state.time);
        gl.uniform1f(quakeP.u.u_fade, state.fade);
        gl.uniform1f(quakeP.u.u_px, devicePixelRatio);
        gl.bindVertexArray(quakeVao);
        gl.enable(gl.BLEND);
        gl.drawArrays(gl.POINTS, 0, nq);
        gl.disable(gl.BLEND);
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
    const toWorld = ([sx, sy])=>[
            state.x + (sx - W() / 2) / (state.zoom * W()),
            state.y + (sy - H() / 2) / (state.zoom * W() * Number(AY))
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
        state.x -= (p[0] - drag[0]) / (state.zoom * W());
        state.y -= (p[1] - drag[1]) / (state.zoom * W() * Number(AY));
        drag = p;
        render();
    });
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const p = dev(e), before = toWorld(p);
        state.zoom = Math.min(8, Math.max(1, state.zoom * Math.exp(-e.deltaY * 0.002)));
        const after = toWorld(p);
        state.x += before[0] - after[0];
        state.y += before[1] - after[1];
        render();
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
        state,
        draw,
        render,
        events: nq,
        toWorld
    };
}
