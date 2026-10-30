const WORLD_METERS = 40075016.686 * Math.cos(40 * Math.PI / 180);
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const WEST = mercX(-180), EAST = mercX(-64), NORTH = mercY(72), SOUTH = mercY(17);
const VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 2 ? 3.0 : -1.0, gl_VertexID == 1 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_rates;
uniform vec2 u_center, u_view, u_origin;
uniform ivec2 u_dims;
uniform float u_world_px, u_cell;
uniform int u_style;
out vec4 o;
float cell(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= u_dims.x || p.y >= u_dims.y) return 0.0;
  return texelFetch(u_rates, p, 0).r;
}
void main() {
  vec2 world = u_center + vec2(gl_FragCoord.x - u_view.x * 0.5, u_view.y * 0.5 - gl_FragCoord.y) / u_world_px;
  vec2 q = (world - u_origin) / u_cell - 0.5;
  ivec2 p = ivec2(floor(q));
  vec2 f = fract(q);
  float a = mix(cell(p), cell(p + ivec2(1, 0)), f.x);
  float b = mix(cell(p + ivec2(0, 1)), cell(p + ivec2(1, 1)), f.x);
  float v = mix(a, b, f.y);
  if (v < 0.1) discard;
  vec3 colors[6] = vec3[6](
    vec3(1.0, 1.0, 0.70), vec3(0.996, 0.80, 0.36),
    vec3(0.992, 0.55, 0.24), vec3(0.94, 0.23, 0.13),
    vec3(0.74, 0.0, 0.15), vec3(0.62, 0.0, 0.31));
  float thresholds[6] = float[6](0.1, 1.0, 10.0, 100.0, 500.0, 2000.0);
  if (u_style == 1) {
    float width = max(fwidth(v), 0.0001);
    for (int i = 0; i < 6; i++) {
      if (abs(v - thresholds[i]) / width < 0.95) { o = vec4(colors[i], 0.97); return; }
    }
    discard;
  }
  int band = 0;
  for (int i = 1; i < 6; i++) if (v >= thresholds[i]) band = i;
  o = vec4(colors[band], 0.77);
}`;
function shader(gl, kind, source) {
    const s = gl.createShader(kind);
    if (!s) throw new Error('createShader failed');
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
    return s;
}
export async function mount(canvas, land, dataUrl, landUrl) {
    const [dataResponse, landResponse] = await Promise.all([
        fetch(dataUrl),
        fetch(landUrl)
    ]);
    if (!dataResponse.ok || !landResponse.ok) throw new Error(`data HTTP ${dataResponse.status} / ${landResponse.status}`);
    const [buffer, polygons] = await Promise.all([
        dataResponse.arrayBuffer(),
        landResponse.json()
    ]);
    const head = new DataView(buffer);
    if (head.getUint32(0, true) !== 0x31305443) throw new Error('invalid county data');
    const count = head.getUint32(4, true), weeks = head.getUint32(8, true), rateLimit = head.getFloat32(12, true);
    const stride = 8 + Math.ceil(weeks / 2) * 3;
    if (buffer.byteLength !== 16 + count * stride) throw new Error('truncated county data');
    const counties = [];
    for(let i = 0; i < count; i++){
        const at = 16 + i * stride;
        const rates = new Uint16Array(weeks);
        for(let week = 0; week < weeks; week += 2){
            const src = at + 8 + Math.floor(week / 2) * 3;
            rates[week] = head.getUint8(src) | (head.getUint8(src + 1) & 15) << 8;
            if (week + 1 < weeks) rates[week + 1] = head.getUint8(src + 1) >> 4 | head.getUint8(src + 2) << 4;
        }
        counties.push({
            x: head.getFloat32(at, true),
            y: head.getFloat32(at + 4, true),
            rates
        });
    }
    const landMaybe = land.getContext('2d');
    const glMaybe = canvas.getContext('webgl2', {
        antialias: false,
        alpha: true,
        premultipliedAlpha: false
    });
    if (!landMaybe || !glMaybe) throw new Error('Canvas2D or WebGL2 unavailable');
    const landCtx = landMaybe;
    const gl = glMaybe;
    const landPaths = polygons.map((rings)=>{
        const path = new Path2D();
        for (const ring of rings){
            if (!ring.length) continue;
            path.moveTo(ring[0][0], ring[0][1]);
            for(let j = 1; j < ring.length; j++)path.lineTo(ring[j][0], ring[j][1]);
            path.closePath();
        }
        return path;
    });
    const program = gl.createProgram();
    if (!program) throw new Error('createProgram failed');
    const v = shader(gl, gl.VERTEX_SHADER, VS), f = shader(gl, gl.FRAGMENT_SHADER, FS);
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
    gl.deleteShader(v);
    gl.deleteShader(f);
    const tex = gl.createTexture(), vao = gl.createVertexArray();
    if (!tex || !vao) throw new Error('GPU texture allocation failed');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindVertexArray(vao);
    const uniform = (name)=>gl.getUniformLocation(program, name);
    const cam = {
        x: mercX(-100),
        y: mercY(40),
        zoom: 3
    };
    let week = 30, cellSize = 60000, style = 'bands';
    let cellWorld = cellSize / WORLD_METERS;
    let gridWidth = 0, gridHeight = 0, grid = new Float32Array(0);
    let nonzero = 0, assigned = 0, updateMs = 0;
    const worldPx = ()=>512 * 2 ** cam.zoom;
    const rateAt = (c, w)=>Math.expm1(c.rates[w] / 4095 * Math.log1p(rateLimit));
    function rebuild() {
        const start = performance.now();
        cellWorld = cellSize / WORLD_METERS;
        gridWidth = Math.ceil((EAST - WEST) / cellWorld);
        gridHeight = Math.ceil((SOUTH - NORTH) / cellWorld);
        grid = new Float32Array(gridWidth * gridHeight);
        assigned = 0;
        for (const county of counties){
            const x = Math.floor((county.x - WEST) / cellWorld), y = Math.floor((county.y - NORTH) / cellWorld);
            if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) continue;
            const index = y * gridWidth + x;
            grid[index] = Math.max(grid[index], rateAt(county, week));
            assigned++;
        }
        nonzero = 0;
        for (const value of grid)if (value > 0) nonzero++;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, gridWidth, gridHeight, 0, gl.RED, gl.FLOAT, grid);
        updateMs = performance.now() - start;
    }
    function drawLand() {
        landCtx.setTransform(1, 0, 0, 1, 0, 0);
        landCtx.clearRect(0, 0, land.width, land.height);
        const scale = worldPx();
        landCtx.fillStyle = '#173849';
        landCtx.strokeStyle = '#6a8a99';
        landCtx.lineWidth = devicePixelRatio / scale;
        const half = land.width / 2 / scale;
        for(let k = Math.floor(cam.x - half); k <= Math.floor(cam.x + half); k++){
            landCtx.setTransform(scale, 0, 0, scale, land.width / 2 - (cam.x - k) * scale, land.height / 2 - cam.y * scale);
            for (const path of landPaths){
                landCtx.fill(path, 'evenodd');
                landCtx.stroke(path);
            }
        }
        landCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    function draw() {
        drawLand();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform2f(uniform('u_center'), cam.x, cam.y);
        gl.uniform2f(uniform('u_view'), canvas.width, canvas.height);
        gl.uniform2f(uniform('u_origin'), WEST, NORTH);
        gl.uniform2i(uniform('u_dims'), gridWidth, gridHeight);
        gl.uniform1f(uniform('u_world_px'), worldPx());
        gl.uniform1f(uniform('u_cell'), cellWorld);
        gl.uniform1i(uniform('u_style'), style === 'bands' ? 0 : 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(uniform('u_rates'), 0);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function resize() {
        canvas.width = land.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
        canvas.height = land.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
        draw();
    }
    const eventPixel = (e)=>{
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * devicePixelRatio,
            y: (e.clientY - r.top) * devicePixelRatio
        };
    };
    const fromScreen = (x, y)=>({
            x: cam.x + (x - canvas.width / 2) / worldPx(),
            y: cam.y + (y - canvas.height / 2) / worldPx()
        });
    const valueAt = (x, y)=>{
        const gx = Math.floor((x - WEST) / cellWorld), gy = Math.floor((y - NORTH) / cellWorld);
        return gx >= 0 && gy >= 0 && gx < gridWidth && gy < gridHeight ? grid[gy * gridWidth + gx] : 0;
    };
    let pending = false;
    const requestDraw = ()=>{
        if (pending) return;
        pending = true;
        requestAnimationFrame(()=>{
            pending = false;
            draw();
        });
    };
    let drag = null;
    canvas.addEventListener('pointerdown', (e)=>{
        drag = eventPixel(e);
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', ()=>{
        drag = null;
    });
    canvas.addEventListener('pointercancel', ()=>{
        drag = null;
    });
    canvas.addEventListener('pointermove', (e)=>{
        const p = eventPixel(e);
        if (drag) {
            cam.x -= (p.x - drag.x) / worldPx();
            cam.y -= (p.y - drag.y) / worldPx();
            drag = p;
            requestDraw();
        } else {
            const w = fromScreen(p.x, p.y), value = valueAt(w.x, w.y);
            const tip = document.getElementById('tooltip');
            if (tip) {
                tip.style.display = value >= 0.1 ? 'block' : 'none';
                tip.textContent = `${value.toFixed(value < 10 ? 1 : 0)} 件 / 10万人 · 第${week}週`;
                tip.style.left = `${e.clientX + 12}px`;
                tip.style.top = `${e.clientY + 12}px`;
            }
        }
    });
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const p = eventPixel(e), before = fromScreen(p.x, p.y);
        cam.zoom = Math.max(1, Math.min(10, cam.zoom - e.deltaY * 0.002));
        const after = fromScreen(p.x, p.y);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        requestDraw();
    }, {
        passive: false
    });
    new ResizeObserver(resize).observe(canvas);
    rebuild();
    resize();
    return {
        gl,
        cam,
        draw,
        count,
        weeks,
        get week () {
            return week;
        },
        get cellSize () {
            return cellSize;
        },
        get nonzero () {
            return nonzero;
        },
        get assigned () {
            return assigned;
        },
        get updateMs () {
            return updateMs;
        },
        setWeek: (value)=>{
            week = Math.max(0, Math.min(weeks - 1, Math.round(value)));
            rebuild();
            draw();
        },
        setCellSize: (value)=>{
            cellSize = Math.max(20000, Math.min(120000, value));
            rebuild();
            draw();
        },
        setStyle: (value)=>{
            style = value;
            draw();
        }
    };
}
