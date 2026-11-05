import { projectEarth } from './tracks.ts';

const X = 2.7066, Y = 1.3174;
const LAND_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
uniform vec2 u_center; uniform vec2 u_viewport; uniform float u_scale;
void main() {
  vec2 world = vec2(a_pos.x * ${2 * X} - ${X}, (0.5 - a_pos.y) * ${2 * Y});
  vec2 pixel = (world - u_center) * u_scale;
  gl_Position = vec4(pixel.x * 2.0 / u_viewport.x, pixel.y * 2.0 / u_viewport.y, 0.0, 1.0);
}`;
const LAND_FS = `#version 300 es
precision mediump float; out vec4 o;
void main() { o = vec4(0.14, 0.24, 0.27, 1.0); }`;
const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_segment;
layout(location=1) in float a_basin;
uniform vec2 u_center; uniform vec2 u_viewport; uniform float u_scale; uniform float u_width;
flat out int v_basin;
const float PI = 3.141592653589793;
const float A1=1.340264, A2=-0.081106, A3=0.000893, A4=0.003796, M=0.8660254037844386;
vec2 equalEarth(float lon, float lat) {
  float t=asin(M*sin(lat*PI/180.0)); float t2=t*t, t6=t2*t2*t2;
  float x=(2.0*sqrt(3.0)*lon*PI/180.0*cos(t))/(3.0*(9.0*A4*t6*t2+7.0*A3*t6+3.0*A2*t2+A1));
  float y=t*(A4*t6*t2+A3*t6+A2*t2+A1); return vec2(x,y);
}
void main() {
  vec2 a=equalEarth(a_segment.x*360.0-180.0, 90.0-a_segment.y*180.0);
  vec2 b=equalEarth(a_segment.z*360.0-180.0, 90.0-a_segment.w*180.0);
  vec2 pa=(a-u_center)*u_scale, pb=(b-u_center)*u_scale;
  vec2 d=normalize(pb-pa); vec2 n=vec2(-d.y,d.x);
  int i=gl_VertexID%6; float t=(i==2||i==3||i==5)?1.0:0.0;
  float side=(i==1||i==4||i==5)?1.0:0.0;
  vec2 pixel=mix(pa,pb,t)+n*((side-0.5)*u_width);
  gl_Position=vec4(pixel.x*2.0/u_viewport.x,pixel.y*2.0/u_viewport.y,0.0,1.0);
  v_basin=int(a_basin+0.5);
}`;
const LINE_FS = `#version 300 es
precision mediump float; flat in int v_basin; out vec4 o;
void main() {
  vec3 c;
  if(v_basin==0)c=vec3(0.96,0.55,0.36);
  else if(v_basin==1)c=vec3(0.94,0.77,0.40);
  else if(v_basin==2)c=vec3(0.63,0.79,0.48);
  else if(v_basin==3)c=vec3(0.35,0.78,0.73);
  else if(v_basin==4)c=vec3(0.38,0.69,0.91);
  else if(v_basin==5)c=vec3(0.61,0.58,0.91);
  else c=vec3(0.90,0.50,0.73);
  o=vec4(c,0.78);
}`;

interface Program { value: WebGLProgram; uniforms: Record<string, WebGLUniformLocation> }
function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL2 could not create a program');
  for (const [kind, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('WebGL2 could not create a shader');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
    gl.attachShader(program, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
  const uniforms: Record<string, WebGLUniformLocation> = {};
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(program, i)!.name, location = gl.getUniformLocation(program, name);
    if (location) uniforms[name] = location;
  }
  return { value: program, uniforms };
}

export type StormMap = Awaited<ReturnType<typeof mount>>;
export async function mount(canvas: HTMLCanvasElement, base: string) {
  const startedAt = performance.now();
  const [land, tracks, statsResponse] = await Promise.all(['land.bin', 'tracks.bin', 'stats.json'].map(async (name) => {
    const response = await fetch(`${base}/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return name === 'stats.json' ? response.json() : response.arrayBuffer();
  }));
  const stats = statsResponse as { observations: number; storms: number; segments: number; basinSegments: Record<string, number> };
  const landData = land as ArrayBuffer, trackData = tracks as ArrayBuffer;
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available');
  const landProgram = createProgram(gl, LAND_VS, LAND_FS), lineProgram = createProgram(gl, LINE_VS, LINE_FS);
  const landHeader = new DataView(landData), vertexCount = landHeader.getUint32(0, true), indexCount = landHeader.getUint32(4, true);
  const landVao = gl.createVertexArray()!; gl.bindVertexArray(landVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, landData.slice(8, 8 + vertexCount * 4), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, landData.slice(8 + vertexCount * 4), gl.STATIC_DRAW);
  const header = new DataView(trackData), segmentCount = header.getUint32(0, true);
  if (trackData.byteLength !== 4 + segmentCount * 12 || segmentCount !== stats.segments) throw new Error('Track buffer and statistics disagree');
  const lineVao = gl.createVertexArray()!; gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, trackData.slice(4), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.UNSIGNED_SHORT, true, 12, 0); gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, false, 12, 8); gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const state = { centerX: 0, centerY: 0, zoom: 1 };
  const scale = () => Math.min(canvas.width / (2 * X), canvas.height / (2 * Y)) * state.zoom;
  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.035, 0.065, 0.08, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const s = scale();
    gl.useProgram(landProgram.value);
    gl.uniform2f(landProgram.uniforms.u_center, state.centerX, state.centerY); gl.uniform2f(landProgram.uniforms.u_viewport, canvas.width, canvas.height); gl.uniform1f(landProgram.uniforms.u_scale, s);
    gl.bindVertexArray(landVao); gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
    gl.useProgram(lineProgram.value);
    gl.uniform2f(lineProgram.uniforms.u_center, state.centerX, state.centerY); gl.uniform2f(lineProgram.uniforms.u_viewport, canvas.width, canvas.height); gl.uniform1f(lineProgram.uniforms.u_scale, s); gl.uniform1f(lineProgram.uniforms.u_width, 1.4 * devicePixelRatio);
    gl.bindVertexArray(lineVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, segmentCount);
  }
  let scheduled = false;
  const render = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; draw(); }); };
  const screenPoint = (lon: number, lat: number): [number, number] => {
    const [x, y] = projectEarth(lon, lat), s = scale();
    return [canvas.width / 2 + (x - state.centerX) * s, canvas.height / 2 - (y - state.centerY) * s];
  };
  const screenToWorld = (x: number, y: number): [number, number] => {
    const s = scale(); return [state.centerX + (x - canvas.width / 2) / s, state.centerY - (y - canvas.height / 2) / s];
  };
  const devicePoint = (event: PointerEvent | WheelEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * devicePixelRatio, (event.clientY - rect.top) * devicePixelRatio];
  };
  let drag: [number, number] | null = null;
  canvas.addEventListener('pointerdown', (event) => { drag = devicePoint(event); canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; }); canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointermove', (event) => { if (!drag) return; const p = devicePoint(event), s = scale(); state.centerX -= (p[0] - drag[0]) / s; state.centerY += (p[1] - drag[1]) / s; drag = p; render(); });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); const p = devicePoint(event), before = screenToWorld(p[0], p[1]);
    state.zoom = Math.min(12, Math.max(0.65, state.zoom * Math.exp(-event.deltaY * 0.0015)));
    const after = screenToWorld(p[0], p[1]); state.centerX += before[0] - after[0]; state.centerY += before[1] - after[1]; render();
  }, { passive: false });
  const resize = () => { canvas.width = Math.round(canvas.clientWidth * devicePixelRatio); canvas.height = Math.round(canvas.clientHeight * devicePixelRatio); draw(); };
  resize(); new ResizeObserver(resize).observe(canvas);
  return { gl, state, draw, render, screenPoint, segmentCount, vertexCount, indexCount, stats, startedAt };
}
