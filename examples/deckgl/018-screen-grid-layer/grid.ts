// One-purpose WebGL2 screen grid for the deck.gl ScreenGridLayer demo data.
// The point buffer is uploaded once. Each view bins the weighted points in an
// R32F target, reduces its maximum, then colors screen-space cells.
const POINT_VS = `#version 300 es
layout(location=0) in vec2 a_xy;
layout(location=1) in float a_weight;
uniform vec2 u_center, u_span, u_view, u_grid;
uniform float u_world_px, u_cell;
out float v_weight;
void main() {
  vec2 screen = vec2(u_view.x * 0.5 + (a_xy.x - u_center.x) * u_span.x * u_world_px,
                     u_view.y * 0.5 + (a_xy.y - u_center.y) * u_span.y * u_world_px);
  vec2 cell = floor(screen / u_cell);
  vec2 clip = vec2((cell.x + 0.5) / u_grid.x * 2.0 - 1.0,
                   1.0 - (cell.y + 0.5) / u_grid.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = 1.0;
  v_weight = a_weight;
}`;
const POINT_FS = `#version 300 es
precision highp float;
in float v_weight;
out vec4 o;
void main() { o = vec4(v_weight, 0.0, 0.0, 1.0); }`;
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
  ivec2 size = textureSize(u_source, 0) - 1;
  ivec2 base = ivec2(gl_FragCoord.xy) * 4;
  float m = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++)
    m = max(m, texelFetch(u_source, min(base + ivec2(x, y), size), 0).r);
  o = vec4(m);
}`;
const COLOR_FS = `#version 300 es
precision highp float;
uniform highp sampler2D u_counts, u_max;
uniform float u_cell;
out vec4 o;
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy / u_cell);
  float count = texelFetch(u_counts, cell, 0).r;
  if (count < 0.5) { o = vec4(0.045, 0.075, 0.11, 1.0); return; }
  float maxCount = max(1.0, texelFetch(u_max, ivec2(0), 0).r);
  float t = log(1.0 + count) / log(1.0 + maxCount);
  vec3 low = vec3(0.24, 0.45, 0.60);
  vec3 mid = vec3(0.95, 0.49, 0.23);
  vec3 high = vec3(1.0, 0.94, 0.54);
  vec3 color = t < 0.55 ? mix(low, mid, t / 0.55) : mix(mid, high, (t - 0.55) / 0.45);
  if (mod(gl_FragCoord.x, u_cell) < 1.0 || mod(gl_FragCoord.y, u_cell) < 1.0)
    color *= 0.72;
  o = vec4(color, 1.0);
}`;

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
export type ScreenGrid = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`data HTTP ${response.status}`);
  const bin = await response.arrayBuffer();
  const head = new DataView(bin);
  if (head.getUint32(0, true) !== 0x31304753) throw new Error('invalid screen grid data');
  const points = head.getUint32(4, true);
  const bounds = [head.getFloat32(8, true), head.getFloat32(12, true), head.getFloat32(16, true), head.getFloat32(20, true)] as const;
  const totalWeight = head.getUint32(24, true);
  if (bin.byteLength !== 32 + points * 6) throw new Error('truncated screen grid data');

  const ctx = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!ctx) throw new Error('WebGL2 unavailable');
  const gl = ctx;
  for (const ext of ['EXT_color_buffer_float', 'EXT_float_blend'])
    if (!gl.getExtension(ext)) throw new Error(`${ext} unavailable`);

  const program = (vs: string, fs: string): WebGLProgram => {
    const p = gl.createProgram();
    if (!p) throw new Error('createProgram failed');
    for (const [kind, text] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error('createShader failed');
      gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed');
      gl.attachShader(p, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link failed');
    return p;
  };
  const pointP = program(POINT_VS, POINT_FS);
  const maxP = program(FULL_VS, MAX_FS);
  const colorP = program(FULL_VS, COLOR_FS);
  const loc = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);

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

  let cellCss = 20;
  let cellPx = 20;
  let levels: Target[] = [];
  const span = { x: bounds[2] - bounds[0], y: bounds[3] - bounds[1] };
  const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
  const local = (lon: number, lat: number) => ({
    x: ((lon + 180) / 360 - bounds[0]) / span.x,
    y: (mercY(lat) - bounds[1]) / span.y,
  });
  const cam = { ...local(-73.75, 40.73), zoom: 9.6 };
  const worldPx = () => 512 * 2 ** cam.zoom;
  const makeTarget = (w: number, h: number): Target => {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('GPU target allocation failed');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('R32F framebuffer incomplete');
    return { tex, fbo, w, h };
  };
  function resize() {
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    cellPx = Math.max(1, Math.round(cellCss * devicePixelRatio));
    for (const l of levels) { gl.deleteTexture(l.tex); gl.deleteFramebuffer(l.fbo); }
    let w = Math.ceil(canvas.width / cellPx), h = Math.ceil(canvas.height / cellPx);
    levels = [makeTarget(w, h)];
    while (w > 1 || h > 1) {
      w = Math.ceil(w / 4); h = Math.ceil(h / 4);
      levels.push(makeTarget(w, h));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function draw() {
    if (!levels.length) resize();
    const counts = levels[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, counts.fbo);
    gl.viewport(0, 0, counts.w, counts.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pointP);
    gl.uniform2f(loc(pointP, 'u_center'), cam.x, cam.y);
    gl.uniform2f(loc(pointP, 'u_span'), span.x, span.y);
    gl.uniform2f(loc(pointP, 'u_view'), canvas.width, canvas.height);
    gl.uniform2f(loc(pointP, 'u_grid'), counts.w, counts.h);
    gl.uniform1f(loc(pointP, 'u_world_px'), worldPx());
    gl.uniform1f(loc(pointP, 'u_cell'), cellPx);
    gl.bindVertexArray(pointVao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, points);
    gl.disable(gl.BLEND);

    gl.useProgram(maxP);
    gl.uniform1i(loc(maxP, 'u_source'), 0);
    gl.bindVertexArray(emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    for (let i = 1; i < levels.length; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, levels[i].fbo);
      gl.viewport(0, 0, levels[i].w, levels[i].h);
      gl.bindTexture(gl.TEXTURE_2D, levels[i - 1].tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(colorP);
    gl.uniform1f(loc(colorP, 'u_cell'), cellPx);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, counts.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, levels[levels.length - 1].tex);
    gl.uniform1i(loc(colorP, 'u_counts'), 0);
    gl.uniform1i(loc(colorP, 'u_max'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  let pending = false;
  const render = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  };
  const screen = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * devicePixelRatio, y: (e.clientY - r.top) * devicePixelRatio };
  };
  const atScreen = (x: number, y: number) => ({
    x: cam.x + (x - canvas.width / 2) / (span.x * worldPx()),
    y: cam.y + (y - canvas.height / 2) / (span.y * worldPx()),
  });
  let dragging: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { dragging = screen(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { dragging = null; });
  canvas.addEventListener('pointercancel', () => { dragging = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = screen(e);
    cam.x -= (p.x - dragging.x) / (span.x * worldPx());
    cam.y -= (p.y - dragging.y) / (span.y * worldPx());
    dragging = p;
    render();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = screen(e), before = atScreen(p.x, p.y);
    cam.zoom = Math.max(5, Math.min(16, cam.zoom - e.deltaY * 0.002));
    const after = atScreen(p.x, p.y);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    render();
  }, { passive: false });
  new ResizeObserver(() => { resize(); render(); }).observe(canvas);
  resize();
  draw();
  return {
    gl, cam, draw, points, totalWeight, bounds,
    countTarget: () => levels[0],
    setCellSize: (cssPx: number) => { cellCss = Math.max(4, Math.min(80, cssPx)); resize(); draw(); },
  };
}
