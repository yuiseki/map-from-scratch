import type { Bounds, FacilityKind } from './clusters.ts';

const CELL = 24;
const BACKGROUND: [number, number, number] = [7, 17, 24];
const CLUSTER_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_kind;
uniform vec2 u_center; uniform vec2 u_viewport; uniform vec2 u_grid;
uniform float u_scale; uniform float u_aspect; uniform float u_cell; uniform int u_filter;
out float v_kind;
void main(){
  if(u_filter>=0 && int(a_kind+0.5)!=u_filter){gl_Position=vec4(3.0,3.0,0.0,1.0);v_kind=a_kind;return;}
  vec2 world=vec2(a_pos.x-0.5,(0.5-a_pos.y)*u_aspect);
  vec2 pixel=(world-u_center)*u_scale+u_viewport*0.5;
  vec2 cell=pixel/u_cell;
  gl_Position=vec4(cell/u_grid*2.0-1.0,0.0,1.0); gl_PointSize=1.0; v_kind=a_kind;
}`;
const ACCUMULATE_FS = `#version 300 es
precision highp float;
in float v_kind; out vec4 o;
void main(){
  int k=int(v_kind+0.5);
  o=k==0?vec4(1,0,0,0):k==1?vec4(0,1,0,0):k==2?vec4(0,0,1,0):vec4(0,0,0,1);
}`;
const BOUNDARY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
uniform vec2 u_center; uniform vec2 u_viewport; uniform float u_scale; uniform float u_aspect;
void main(){
  vec2 world=vec2(a_pos.x-0.5,(0.5-a_pos.y)*u_aspect);
  vec2 pixel=(world-u_center)*u_scale+u_viewport*0.5;
  gl_Position=vec4(pixel/u_viewport*2.0-1.0,0.0,1.0);
}`;
const BOUNDARY_FS = `#version 300 es
precision mediump float; out vec4 o;
void main(){o=vec4(0.20,0.48,0.57,0.76);}`;
const CLUSTER_SCREEN_VS = `#version 300 es
precision highp float;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;
const CLUSTER_SCREEN_FS = `#version 300 es
precision highp float;
uniform sampler2D u_counts; uniform float u_cell;
out vec4 o;
vec3 colorFor(int k){
  if(k==0)return vec3(1.00,0.45,0.25);
  if(k==1)return vec3(0.38,0.79,0.48);
  if(k==2)return vec3(0.28,0.71,1.00);
  return vec3(0.88,0.65,1.00);
}
void main(){
  vec2 cell=floor(gl_FragCoord.xy/u_cell);
  vec4 packed=texelFetch(u_counts,ivec2(cell),0);
  float total=dot(packed,vec4(1.0)); if(total<0.5)discard;
  int kind=0; float strongest=packed.r;
  if(packed.g>strongest){kind=1;strongest=packed.g;}
  if(packed.b>strongest){kind=2;strongest=packed.b;}
  if(packed.a>strongest){kind=3;strongest=packed.a;}
  vec2 jitter=(vec2(fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5),fract(sin(dot(cell,vec2(269.5,183.3)))*24634.6))-0.5)*u_cell*0.18;
  vec2 local=mod(gl_FragCoord.xy,u_cell)-vec2(u_cell*0.5)-jitter;
  float density=clamp(total*0.28,0.0,1.0);
  float radius=mix(2.2,u_cell*0.32,sqrt(density));
  float d=length(local); if(d>radius)discard;
  float edge=1.0-smoothstep(radius-1.8,radius,d);
  vec3 base=colorFor(kind);
  o=vec4(mix(base*0.30,base,edge),0.58+0.42*edge);
}`;

interface Stats {
  sourceDate: string; sourceFeatures: number; categoryCounts: number[]; categoryNames: string[];
  bounds: Bounds; boundaryRings: number; boundarySegments: number; pointsBytes: number; boundaryBytes: number;
}
interface Program { value: WebGLProgram; uniforms: Map<string, WebGLUniformLocation> }
function program(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const value = gl.createProgram();
  if (!value) throw new Error('WebGL2 could not create a program');
  for (const [kind, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('WebGL2 could not create a shader');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compilation failed');
    gl.attachShader(value, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(value);
  if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value) ?? 'program link failed');
  const uniforms = new Map<string, WebGLUniformLocation>();
  for (let i = 0; i < gl.getProgramParameter(value, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(value, i)!.name, location = gl.getUniformLocation(value, name);
    if (location) uniforms.set(name, location);
  }
  return { value, uniforms };
}
function uniform(program: Program, name: string): WebGLUniformLocation {
  const location = program.uniforms.get(name);
  if (!location) throw new Error(`Missing shader uniform ${name}`);
  return location;
}

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const startedAt = performance.now();
  const [pointsResponse, boundaryResponse, statsResponse] = await Promise.all([
    fetch(`${base}/facilities.bin`), fetch(`${base}/boundary.bin`), fetch(`${base}/stats.json`),
  ]);
  for (const [name, response] of [['facilities.bin', pointsResponse], ['boundary.bin', boundaryResponse], ['stats.json', statsResponse]] as const) {
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  }
  const [pointsData, boundaryData, stats] = await Promise.all([
    pointsResponse.arrayBuffer(), boundaryResponse.arrayBuffer(), statsResponse.json() as Promise<Stats>,
  ]);
  const pointsView = new DataView(pointsData), boundaryView = new DataView(boundaryData);
  if (String.fromCharCode(...new Uint8Array(pointsData, 0, 4)) !== 'TFC1' || String.fromCharCode(...new Uint8Array(boundaryData, 0, 4)) !== 'TBO1') throw new Error('Unsupported Tokyo cluster data signature');
  const pointCount = pointsView.getUint32(4, true), segmentCount = boundaryView.getUint32(4, true);
  if (pointsData.byteLength !== 8 + pointCount * 6 || boundaryData.byteLength !== 8 + segmentCount * 8 || pointCount !== stats.sourceFeatures || stats.categoryCounts.length !== 4) throw new Error('Baked point data and statistics disagree');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 is not available');
  const ratio = (stats.bounds.maxY - stats.bounds.minY) / (stats.bounds.maxX - stats.bounds.minX);
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('Invalid city boundary aspect ratio');

  const aggregateProgram = program(gl, CLUSTER_VS, ACCUMULATE_FS);
  const boundaryProgram = program(gl, BOUNDARY_VS, BOUNDARY_FS);
  const screenProgram = program(gl, CLUSTER_SCREEN_VS, CLUSTER_SCREEN_FS);
  const pointVao = gl.createVertexArray()!; gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, pointsData.slice(8), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 6, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, false, 6, 4);
  gl.bindVertexArray(null);
  const lineVao = gl.createVertexArray()!; gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, boundaryData.slice(8), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 4, 0);
  gl.bindVertexArray(null);

  const state = { centerX: 0, centerY: 0, zoom: 1, filter: -1 };
  let cell = CELL * devicePixelRatio, gridWidth = 0, gridHeight = 0;
  let target = gl.createFramebuffer()!, texture = gl.createTexture()!;
  function resizeTarget() {
    gridWidth = Math.max(1, Math.ceil(canvas.width / cell)); gridHeight = Math.max(1, Math.ceil(canvas.height / cell));
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gridWidth, gridHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU cluster grid framebuffer is incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  const scale = () => Math.min(canvas.width, canvas.height / ratio) * 0.88 * state.zoom;
  function setCameraUniforms(p: Program, extra?: 'grid') {
    gl.uniform2f(uniform(p, 'u_center'), state.centerX, state.centerY);
    gl.uniform2f(uniform(p, 'u_viewport'), canvas.width, canvas.height);
    gl.uniform1f(uniform(p, 'u_scale'), scale()); gl.uniform1f(uniform(p, 'u_aspect'), ratio);
    if (extra === 'grid') gl.uniform2f(uniform(p, 'u_grid'), gridWidth, gridHeight);
  }
  function aggregate() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.viewport(0, 0, gridWidth, gridHeight);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(aggregateProgram.value); setCameraUniforms(aggregateProgram, 'grid');
    gl.uniform1f(uniform(aggregateProgram, 'u_cell'), cell); gl.uniform1i(uniform(aggregateProgram, 'u_filter'), state.filter);
    gl.bindVertexArray(pointVao); gl.drawArrays(gl.POINTS, 0, pointCount); gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
  function draw() {
    aggregate();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(BACKGROUND[0] / 255, BACKGROUND[1] / 255, BACKGROUND[2] / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(boundaryProgram.value); setCameraUniforms(boundaryProgram);
    gl.lineWidth(Math.max(1, devicePixelRatio)); gl.bindVertexArray(lineVao); gl.drawArrays(gl.LINES, 0, segmentCount * 2); gl.bindVertexArray(null);
    gl.useProgram(screenProgram.value); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniform(screenProgram, 'u_counts'), 0); gl.uniform1f(uniform(screenProgram, 'u_cell'), cell);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  function inspectClusters() {
    const pixels = new Uint8Array(gridWidth * gridHeight * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.readPixels(0, 0, gridWidth, gridHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let occupied = 0;
    const categories = [0, 0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
      let sum = 0;
      for (let k = 0; k < 4; k++) { const count = pixels[i + k]!; sum += count; if (count) categories[k]++; }
      if (sum) occupied++;
    }
    const error = gl.getError();
    return { occupied, categories, errors: error === gl.NO_ERROR ? [] : [String(error)], dims: [gridWidth, gridHeight] };
  }
  function inspectImage() {
    gl.finish();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let bright = 0, borderLike = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
      if (r > 40 || g > 50 || b > 65) bright++;
      if (r > 20 && r < 100 && g > 65 && b > 80 && b < 180) borderLike++;
    }
    return { bright, borderLike };
  }
  const screenPoint = (x: number, y: number): [number, number] => {
    const s = scale(); return [canvas.width / 2 + (x - state.centerX) * s, canvas.height / 2 - (y - state.centerY) * s];
  };
  const devicePoint = (event: PointerEvent | WheelEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * devicePixelRatio, (event.clientY - rect.top) * devicePixelRatio];
  };
  const screenToWorld = (x: number, y: number): [number, number] => [state.centerX + (x - canvas.width / 2) / scale(), state.centerY - (y - canvas.height / 2) / scale()];
  let drag: [number, number] | null = null;
  canvas.addEventListener('pointerdown', (event) => { drag = devicePoint(event); canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; }); canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return; const p = devicePoint(event), s = scale();
    state.centerX -= (p[0] - drag[0]) / s; state.centerY += (p[1] - drag[1]) / s; drag = p; draw();
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); const p = devicePoint(event), before = screenToWorld(p[0], p[1]);
    state.zoom = Math.min(18, Math.max(0.75, state.zoom * Math.exp(-event.deltaY * 0.0012)));
    const after = screenToWorld(p[0], p[1]); state.centerX += before[0] - after[0]; state.centerY += before[1] - after[1]; draw();
  }, { passive: false });
  const resize = () => {
    canvas.width = Math.round(canvas.clientWidth * devicePixelRatio); canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
    cell = CELL * devicePixelRatio; resizeTarget(); draw();
  };
  resize(); new ResizeObserver(resize).observe(canvas);
  return { gl, stats, state, draw, inspectClusters, inspectImage, screenPoint, pointCount, segmentCount, gridSize: () => [gridWidth, gridHeight], startedAt };
}

export type ClusterMap = Awaited<ReturnType<typeof mount>>;
