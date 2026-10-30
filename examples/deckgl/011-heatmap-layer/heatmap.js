const SPLAT_VS = `#version 300 es
layout(location=0) in vec2 a_xy;
layout(location=1) in float a_weight;
uniform vec2 u_center, u_span, u_view;
uniform float u_world_px, u_radius, u_scale;
out float v_weight;
void main() {
  vec2 screen = vec2(u_view.x * 0.5 + (a_xy.x - u_center.x) * u_span.x * u_world_px,
                     u_view.y * 0.5 + (a_xy.y - u_center.y) * u_span.y * u_world_px);
  gl_Position = vec4(screen.x / u_view.x * 2.0 - 1.0,
                     1.0 - screen.y / u_view.y * 2.0, 0.0, 1.0);
  gl_PointSize = u_radius * 2.0 / u_scale;
  v_weight = a_weight;
}`;
const SPLAT_FS = `#version 300 es
precision highp float;
in float v_weight;
out vec4 o;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  o = vec4(v_weight * exp(-4.0 * r2), 0.0, 0.0, 1.0);
}`;
const FULL_VS = `#version 300 es
void main() {
  gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0,
                     gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0);
}`;
const MAX_FS = `#version 300 es
precision highp float;
uniform highp sampler2D u_source;
out vec4 o;
void main() {
  ivec2 end = textureSize(u_source, 0) - 1;
  ivec2 base = ivec2(gl_FragCoord.xy) * 4;
  float m = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++)
    m = max(m, texelFetch(u_source, min(base + ivec2(x, y), end), 0).r);
  o = vec4(m);
}`;
const COLOR_FS = `#version 300 es
precision highp float;
uniform highp sampler2D u_density, u_max;
uniform float u_scale, u_intensity, u_threshold;
out vec4 o;
float sampleDensity(vec2 pos) {
  ivec2 size = textureSize(u_density, 0) - 1;
  vec2 q = pos - 0.5;
  ivec2 a = clamp(ivec2(floor(q)), ivec2(0), size);
  ivec2 b = clamp(a + ivec2(1), ivec2(0), size);
  vec2 t = fract(q);
  float x0 = mix(texelFetch(u_density, a, 0).r, texelFetch(u_density, ivec2(b.x, a.y), 0).r, t.x);
  float x1 = mix(texelFetch(u_density, ivec2(a.x, b.y), 0).r, texelFetch(u_density, b, 0).r, t.x);
  return mix(x0, x1, t.y);
}
void main() {
  float maxDensity = max(1.0, texelFetch(u_max, ivec2(0), 0).r);
  float density = sampleDensity(gl_FragCoord.xy / u_scale);
  float v = clamp(density / maxDensity * u_intensity, 0.0, 1.0);
  vec3 bg = vec3(0.045, 0.075, 0.11);
  if (v <= u_threshold) { o = vec4(bg, 1.0); return; }
  float t = (v - u_threshold) / max(0.001, 1.0 - u_threshold);
  vec3 color = t < 0.25 ? mix(vec3(0.13, 0.20, 0.40), vec3(0.18, 0.48, 0.72), t * 4.0) :
               t < 0.50 ? mix(vec3(0.18, 0.48, 0.72), vec3(0.30, 0.78, 0.70), (t - 0.25) * 4.0) :
               t < 0.75 ? mix(vec3(0.30, 0.78, 0.70), vec3(1.00, 0.84, 0.34), (t - 0.50) * 4.0) :
                          mix(vec3(1.00, 0.84, 0.34), vec3(0.98, 0.29, 0.24), (t - 0.75) * 4.0);
  o = vec4(mix(bg, color, smoothstep(0.0, 0.08, t)), 1.0);
}`;
export async function mount(canvas, url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`data HTTP ${response.status}`);
    const bin = await response.arrayBuffer();
    const head = new DataView(bin);
    if (head.getUint32(0, true) !== 0x31304d48) throw new Error('invalid heatmap data');
    const points = head.getUint32(4, true);
    const bounds = [
        head.getFloat32(8, true),
        head.getFloat32(12, true),
        head.getFloat32(16, true),
        head.getFloat32(20, true)
    ];
    const totalWeight = head.getUint32(24, true);
    if (bin.byteLength !== 32 + points * 6) throw new Error('truncated heatmap data');
    const ctx = canvas.getContext('webgl2', {
        antialias: false,
        alpha: false
    });
    if (!ctx) throw new Error('WebGL2 unavailable');
    const gl = ctx;
    for (const ext of [
        'EXT_color_buffer_float',
        'EXT_float_blend'
    ])if (!gl.getExtension(ext)) throw new Error(`${ext} unavailable`);
    const program = (vs, fs)=>{
        const p = gl.createProgram();
        if (!p) throw new Error('createProgram failed');
        for (const [kind, text] of [
            [
                gl.VERTEX_SHADER,
                vs
            ],
            [
                gl.FRAGMENT_SHADER,
                fs
            ]
        ]){
            const shader = gl.createShader(kind);
            if (!shader) throw new Error('createShader failed');
            gl.shaderSource(shader, text);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed');
            gl.attachShader(p, shader);
            gl.deleteShader(shader);
        }
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link failed');
        return p;
    };
    const splatP = program(SPLAT_VS, SPLAT_FS);
    const maxP = program(FULL_VS, MAX_FS);
    const colorP = program(FULL_VS, COLOR_FS);
    const loc = (p, name)=>gl.getUniformLocation(p, name);
    const pointVao = gl.createVertexArray();
    if (!pointVao) throw new Error('createVertexArray failed');
    gl.bindVertexArray(pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(bin, 32), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 6, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, false, 6, 4);
    const emptyVao = gl.createVertexArray();
    if (!emptyVao) throw new Error('createVertexArray failed');
    const span = {
        x: bounds[2] - bounds[0],
        y: bounds[3] - bounds[1]
    };
    const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
    const local = (lon, lat)=>({
            x: ((lon + 180) / 360 - bounds[0]) / span.x,
            y: (mercY(lat) - bounds[1]) / span.y
        });
    const cam = {
        ...local(-73.75, 40.73),
        zoom: 9
    };
    const worldPx = ()=>512 * 2 ** cam.zoom;
    let radius = 30, intensity = 1, threshold = 0.03;
    const scale = 3;
    let levels = [];
    const makeTarget = (w, h)=>{
        const tex = gl.createTexture(), fbo = gl.createFramebuffer();
        if (!tex || !fbo) throw new Error('GPU target allocation failed');
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('R32F framebuffer incomplete');
        return {
            tex,
            fbo,
            w,
            h
        };
    };
    function resize() {
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
        for (const l of levels){
            gl.deleteTexture(l.tex);
            gl.deleteFramebuffer(l.fbo);
        }
        let w = Math.ceil(canvas.width / scale), h = Math.ceil(canvas.height / scale);
        levels = [
            makeTarget(w, h)
        ];
        while(w > 1 || h > 1){
            w = Math.ceil(w / 4);
            h = Math.ceil(h / 4);
            levels.push(makeTarget(w, h));
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    function draw() {
        if (!levels.length) resize();
        const density = levels[0];
        gl.bindFramebuffer(gl.FRAMEBUFFER, density.fbo);
        gl.viewport(0, 0, density.w, density.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(splatP);
        gl.uniform2f(loc(splatP, 'u_center'), cam.x, cam.y);
        gl.uniform2f(loc(splatP, 'u_span'), span.x, span.y);
        gl.uniform2f(loc(splatP, 'u_view'), canvas.width, canvas.height);
        gl.uniform1f(loc(splatP, 'u_world_px'), worldPx());
        gl.uniform1f(loc(splatP, 'u_radius'), radius * devicePixelRatio);
        gl.uniform1f(loc(splatP, 'u_scale'), scale);
        gl.bindVertexArray(pointVao);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, points);
        gl.disable(gl.BLEND);
        gl.useProgram(maxP);
        gl.uniform1i(loc(maxP, 'u_source'), 0);
        gl.bindVertexArray(emptyVao);
        gl.activeTexture(gl.TEXTURE0);
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
        gl.bindTexture(gl.TEXTURE_2D, density.tex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, levels[levels.length - 1].tex);
        gl.uniform1i(loc(colorP, 'u_density'), 0);
        gl.uniform1i(loc(colorP, 'u_max'), 1);
        gl.uniform1f(loc(colorP, 'u_scale'), scale);
        gl.uniform1f(loc(colorP, 'u_intensity'), intensity);
        gl.uniform1f(loc(colorP, 'u_threshold'), threshold);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
    }
    let pending = false;
    const render = ()=>{
        if (pending) return;
        pending = true;
        requestAnimationFrame(()=>{
            pending = false;
            draw();
        });
    };
    const screen = (e)=>{
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * devicePixelRatio,
            y: (e.clientY - r.top) * devicePixelRatio
        };
    };
    const atScreen = (x, y)=>({
            x: cam.x + (x - canvas.width / 2) / (span.x * worldPx()),
            y: cam.y + (y - canvas.height / 2) / (span.y * worldPx())
        });
    let dragging = null;
    canvas.addEventListener('pointerdown', (e)=>{
        dragging = screen(e);
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', ()=>{
        dragging = null;
    });
    canvas.addEventListener('pointercancel', ()=>{
        dragging = null;
    });
    canvas.addEventListener('pointermove', (e)=>{
        if (!dragging) return;
        const p = screen(e);
        cam.x -= (p.x - dragging.x) / (span.x * worldPx());
        cam.y -= (p.y - dragging.y) / (span.y * worldPx());
        dragging = p;
        render();
    });
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const p = screen(e), before = atScreen(p.x, p.y);
        cam.zoom = Math.max(5, Math.min(16, cam.zoom - e.deltaY * 0.002));
        const after = atScreen(p.x, p.y);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        render();
    }, {
        passive: false
    });
    new ResizeObserver(()=>{
        resize();
        render();
    }).observe(canvas);
    resize();
    draw();
    return {
        gl,
        cam,
        draw,
        points,
        totalWeight,
        bounds,
        densityTarget: ()=>levels[0],
        setRadius: (value)=>{
            radius = Math.max(5, Math.min(80, value));
            draw();
        },
        setIntensity: (value)=>{
            intensity = Math.max(0.1, Math.min(4, value));
            draw();
        },
        setThreshold: (value)=>{
            threshold = Math.max(0, Math.min(0.5, value));
            draw();
        }
    };
}
