import { projectEarth } from './points.ts';

const X = 2.7066, Y = 1.3174;
const LAND_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
uniform vec2 u_center;
uniform vec2 u_viewport;
uniform float u_scale;
void main() {
  vec2 world = vec2(a_pos.x * ${2 * X} - ${X}, (0.5 - a_pos.y) * ${2 * Y});
  vec2 pixel = (world - u_center) * u_scale;
  gl_Position = vec4(pixel.x * 2.0 / u_viewport.x, pixel.y * 2.0 / u_viewport.y, 0.0, 1.0);
}`;
const LAND_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.18, 0.30, 0.34, 1.0); }`;
const POINT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_radius;
layout(location=2) in float a_depth;
uniform vec2 u_center;
uniform vec2 u_viewport;
uniform float u_scale;
uniform float u_dpr;
out float v_depth;
void main() {
  vec2 world = vec2(a_pos.x * ${2 * X} - ${X}, (0.5 - a_pos.y) * ${2 * Y});
  vec2 pixel = (world - u_center) * u_scale;
  gl_Position = vec4(pixel.x * 2.0 / u_viewport.x, pixel.y * 2.0 / u_viewport.y, 0.0, 1.0);
  gl_PointSize = max(1.0, a_radius * 0.25 * u_dpr);
  v_depth = a_depth;
}`;
const POINT_FS = `#version 300 es
precision mediump float;
in float v_depth;
out vec4 o;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float coverage = 1.0 - smoothstep(0.46, 0.5, length(p));
  if (coverage <= 0.0) discard;
  vec3 c = v_depth < 0.5 ? vec3(1.0, 0.22, 0.13) : v_depth < 1.5 ? vec3(1.0, 0.78, 0.28) : vec3(0.40, 0.72, 1.0);
  o = vec4(c, coverage);
}`;

interface Program { value: WebGLProgram; uniforms: Record<string, WebGLUniformLocation> }
function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL2 could not create a program');
  for (const [kind, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('WebGL2 could not create a shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
  const uniforms: Record<string, WebGLUniformLocation> = {};
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(program, i)!.name;
    const location = gl.getUniformLocation(program, name);
    if (location) uniforms[name] = location;
  }
  return { value: program, uniforms };
}

export type EarthquakeMap = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const startedAt = performance.now();
  const [land, points] = await Promise.all(['land.bin', 'points.bin'].map(async (name) => {
    const response = await fetch(`${base}/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }));
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available');
  const landProgram = createProgram(gl, LAND_VS, LAND_FS);
  const pointProgram = createProgram(gl, POINT_VS, POINT_FS);
  const landHeader = new DataView(land);
  const vertexCount = landHeader.getUint32(0, true);
  const indexCount = landHeader.getUint32(4, true);
  const landVao = gl.createVertexArray()!;
  gl.bindVertexArray(landVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, land.slice(8, 8 + vertexCount * 4), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, land.slice(8 + vertexCount * 4), gl.STATIC_DRAW);
  const pointHeader = new DataView(points);
  const pointCount = pointHeader.getUint32(0, true);
  const pointVao = gl.createVertexArray()!;
  gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, points.slice(4), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 8, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, false, 8, 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 8, 5);
  gl.bindVertexArray(null);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const state = { centerX: 0, centerY: 0, zoom: 1 };
  const scale = () => Math.min(canvas.width / (2 * X), canvas.height / (2 * Y)) * state.zoom;
  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.055, 0.09, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const s = scale();
    gl.useProgram(landProgram.value);
    gl.uniform2f(landProgram.uniforms.u_center, state.centerX, state.centerY);
    gl.uniform2f(landProgram.uniforms.u_viewport, canvas.width, canvas.height);
    gl.uniform1f(landProgram.uniforms.u_scale, s);
    gl.bindVertexArray(landVao);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
    gl.useProgram(pointProgram.value);
    gl.uniform2f(pointProgram.uniforms.u_center, state.centerX, state.centerY);
    gl.uniform2f(pointProgram.uniforms.u_viewport, canvas.width, canvas.height);
    gl.uniform1f(pointProgram.uniforms.u_scale, s);
    gl.uniform1f(pointProgram.uniforms.u_dpr, devicePixelRatio);
    gl.bindVertexArray(pointVao);
    gl.drawArrays(gl.POINTS, 0, pointCount);
  }
  let scheduled = false;
  const render = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; draw(); });
  };
  const screenPoint = (lon: number, lat: number): [number, number] => {
    const [x, y] = projectEarth(lon, lat);
    const s = scale();
    return [canvas.width / 2 + (x - state.centerX) * s, canvas.height / 2 - (y - state.centerY) * s];
  };
  const screenToWorld = (x: number, y: number): [number, number] => {
    const s = scale();
    return [state.centerX + (x - canvas.width / 2) / s, state.centerY - (y - canvas.height / 2) / s];
  };
  const devicePoint = (event: PointerEvent | WheelEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * devicePixelRatio, (event.clientY - rect.top) * devicePixelRatio];
  };
  let drag: [number, number] | null = null;
  canvas.addEventListener('pointerdown', (event) => { drag = devicePoint(event); canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const p = devicePoint(event), s = scale();
    state.centerX -= (p[0] - drag[0]) / s;
    state.centerY += (p[1] - drag[1]) / s;
    drag = p;
    render();
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const p = devicePoint(event), before = screenToWorld(p[0], p[1]);
    state.zoom = Math.min(12, Math.max(0.65, state.zoom * Math.exp(-event.deltaY * 0.0015)));
    const after = screenToWorld(p[0], p[1]);
    state.centerX += before[0] - after[0];
    state.centerY += before[1] - after[1];
    render();
  }, { passive: false });
  const resize = () => {
    canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
    canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
    draw();
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  return { gl, state, draw, render, screenPoint, pointCount, vertexCount, indexCount, startedAt };
}
