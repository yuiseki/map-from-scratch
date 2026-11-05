import { projectEqualEarth } from './polygons.ts';

const X = 2.7066, Y = 1.3174;
const POLYGON_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_class;
uniform vec2 u_center; uniform vec2 u_viewport; uniform float u_scale;
out float v_class;
void main() {
  vec2 world=vec2(a_pos.x*${2 * X}-${X},(0.5-a_pos.y)*${2 * Y});
  vec2 pixel=(world-u_center)*u_scale;
  gl_Position=vec4(pixel.x*2.0/u_viewport.x,pixel.y*2.0/u_viewport.y,0.0,1.0);
  v_class=a_class;
}`;
const POLYGON_FS = `#version 300 es
precision highp float;
in float v_class; out vec4 o;
vec3 palette(float t) {
  vec3 a=vec3(0.16,0.27,0.62), b=vec3(0.12,0.68,0.72), c=vec3(0.95,0.78,0.35), d=vec3(0.91,0.37,0.25);
  return t<0.42 ? mix(a,b,t/0.42) : t<0.78 ? mix(b,c,(t-0.42)/0.36) : mix(c,d,(t-0.78)/0.22);
}
void main() {
  vec3 color=v_class<0.001 ? vec3(0.31,0.34,0.39) : palette(clamp((v_class-0.02)/0.98,0.0,1.0));
  o=vec4(color,1.0);
}`;
const BORDER_FS = `#version 300 es
precision mediump float; out vec4 o;
void main(){o=vec4(0.035,0.07,0.09,0.92);}`;

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

type Stats = {
  year: number; indicator: string; populationRows: number; countriesWithValues: number;
  countriesWithoutValues: number; unmatchedCodes: string[]; polygonFeatures: number;
  polygons: number; vertices: number; triangles: number; borderSegments: number;
  minimum: number; maximum: number; colorClasses: number;
};
export type PopulationMap = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const startedAt = performance.now();
  const [meshData, stats] = await Promise.all(['countries.bin', 'stats.json'].map(async (name) => {
    const response = await fetch(`${base}/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return name === 'stats.json' ? response.json() : response.arrayBuffer();
  })) as [ArrayBuffer, Stats];
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available');
  const view = new DataView(meshData);
  if (String.fromCharCode(...new Uint8Array(meshData, 0, 4)) !== 'GPC1') throw new Error('Unsupported country mesh signature');
  const vertexCount = view.getUint32(4, true), triangleIndexCount = view.getUint32(8, true), borderCount = view.getUint32(12, true);
  const expectedBytes = 16 + vertexCount * 6 + triangleIndexCount * 4 + borderCount * 8;
  if (meshData.byteLength !== expectedBytes || vertexCount !== stats.vertices || triangleIndexCount / 3 !== stats.triangles || borderCount !== stats.borderSegments) {
    throw new Error('Country mesh and statistics disagree');
  }
  const polygonProgram = createProgram(gl, POLYGON_VS, POLYGON_FS), borderProgram = createProgram(gl, POLYGON_VS, BORDER_FS);
  const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, meshData.slice(16, 16 + vertexCount * 6), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 6, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, true, 6, 4);
  const triangleOffset = 16 + vertexCount * 6;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, meshData.slice(triangleOffset, triangleOffset + triangleIndexCount * 4), gl.STATIC_DRAW);
  const triangleBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) as WebGLBuffer;
  const borderOffset = triangleOffset + triangleIndexCount * 4;
  const borderBuffer = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, borderBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, meshData.slice(borderOffset), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const state = { centerX: 0, centerY: 0, zoom: 1 };
  const scale = () => Math.min(canvas.width / (2 * X), canvas.height / (2 * Y)) * state.zoom;
  function uniforms(program: Program) {
    gl.uniform2f(program.uniforms.u_center, state.centerX, state.centerY);
    gl.uniform2f(program.uniforms.u_viewport, canvas.width, canvas.height);
    gl.uniform1f(program.uniforms.u_scale, scale());
  }
  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.025, 0.055, 0.07, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(vao); gl.useProgram(polygonProgram.value); uniforms(polygonProgram);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triangleBuffer); gl.drawElements(gl.TRIANGLES, triangleIndexCount, gl.UNSIGNED_INT, 0);
    gl.useProgram(borderProgram.value); uniforms(borderProgram);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, borderBuffer); gl.drawElements(gl.LINES, borderCount * 2, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
  let scheduled = false;
  const render = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; draw(); }); };
  const screenPoint = (lon: number, lat: number): [number, number] => {
    const [x, y] = projectEqualEarth(lon, lat), s = scale();
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
  return { gl, state, draw, render, screenPoint, stats, vertexCount, triangleIndexCount, borderCount, startedAt };
}
