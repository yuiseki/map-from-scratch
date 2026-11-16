import { globePosition, populationIntensity, populationRadius, validateHexGrid, type HexCell, type HexGrid } from './globe.ts';

const BACKGROUND_VS = `#version 300 es
precision highp float;
out vec2 vScreen;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vScreen=p*2.0-1.0;gl_Position=vec4(vScreen,1.0,1.0);}`;
const BACKGROUND_FS = `#version 300 es
precision highp float;
in vec2 vScreen;out vec4 color;
uniform vec2 uCenter;uniform vec2 uScale;uniform mat3 uInverseRotation;
void main(){vec2 q=(vScreen-uCenter)/uScale;float r2=dot(q,q);if(r2>1.0){color=vec4(0.012,0.023,0.031,1.0);gl_FragDepth=1.0;return;}
float z=sqrt(max(0.0,1.0-r2));vec3 world=normalize(uInverseRotation*vec3(q.x,q.y,z));
float lat=asin(clamp(world.y,-1.0,1.0));float lon=atan(world.z,world.x);
float graticule=max(1.0-smoothstep(0.0,0.012,abs(sin(lat*6.0))),1.0-smoothstep(0.0,0.012,abs(sin(lon*12.0))*cos(lat)));
float rim=smoothstep(0.72,1.0,r2);vec3 ocean=mix(vec3(0.025,0.079,0.105),vec3(0.038,0.105,0.132),z);
ocean=mix(ocean,vec3(0.12,0.27,0.30),graticule*0.22);ocean+=vec3(0.08,0.19,0.22)*rim;
color=vec4(ocean,1.0);gl_FragDepth=0.5-z*0.4;}`;
const CELLS_VS = `#version 300 es
precision highp float;layout(location=0) in vec3 aPosition;layout(location=1) in float aIntensity;
uniform mat3 uRotation;uniform vec2 uScale;uniform vec2 uCenter;out float vIntensity;
void main(){vec3 p=uRotation*aPosition;gl_Position=vec4(uCenter+vec2(p.x*uScale.x,p.y*uScale.y),-p.z*0.8,1.0);vIntensity=aIntensity;}`;
const CELLS_FS = `#version 300 es
precision highp float;in float vIntensity;out vec4 color;uniform float uShade;
vec3 populationColor(float t){return mix(vec3(0.196,0.463,0.600),vec3(1.0,0.855,0.533),clamp(t,0.0,1.0));}
void main(){color=vec4(populationColor(vIntensity)*uShade,1.0);}`;

interface Program { value: WebGLProgram; uniforms: Map<string, WebGLUniformLocation> }
export interface GlobeCamera { yaw: number; pitch: number; zoom: number }
interface CellCenter { cell: HexCell; position: readonly [number, number, number] }

function compile(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): Program {
  const program = gl.createProgram(); if (!program) throw new Error('WebGL2 could not create a program');
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
    const shader = gl.createShader(type); if (!shader) throw new Error('WebGL2 could not create a shader');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed');
    gl.attachShader(program, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
  const uniforms = new Map<string, WebGLUniformLocation>();
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(program, i)!.name, location = gl.getUniformLocation(program, name);
    if (location) uniforms.set(name, location);
  }
  return { value: program, uniforms };
}
function uniform(program: Program, name: string): WebGLUniformLocation {
  const value = program.uniforms.get(name); if (!value) throw new Error(`Missing shader uniform ${name}`); return value;
}
function rotate([x, y, z]: readonly [number, number, number], camera: GlobeCamera): [number, number, number] {
  const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw), sp = Math.sin(camera.pitch), cp = Math.cos(camera.pitch);
  const x1 = -sy * x + cy * z, z1 = cy * x + sy * z;
  return [x1, cp * y - sp * z1, sp * y + cp * z1];
}
function inverseRotation(camera: GlobeCamera): Float32Array {
  const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw), sp = Math.sin(camera.pitch), cp = Math.cos(camera.pitch);
  // Camera basis keeps geographic east to the right and north upward.
  return new Float32Array([-sy, 0, cy, -sp * cy, cp, -sp * sy, cp * cy, sp, cp * sy]);
}

function meshFor(grid: HexGrid): { vertices: Float32Array; topIndices: Uint32Array; sideIndices: Uint32Array; centers: CellCenter[]; triangles: number; lines: number } {
  const values: number[] = [], topIndices: number[] = [], sideIndices: number[] = [], centers: CellCenter[] = [];
  let vertexCount = 0, triangles = 0, lines = 0;
  const push = (position: readonly [number, number, number], intensity: number) => {
    values.push(position[0], position[1], position[2], intensity); return vertexCount++;
  };
  for (const cell of grid.cells) {
    const intensity = populationIntensity(cell.population), centerVectors: number[][] = [];
    for (const ring of cell.polygons) for (const [lon, lat] of ring) centerVectors.push([...globePosition(lon, lat)]);
    let cx = 0, cy = 0, cz = 0;
    for (const point of centerVectors) { cx += point[0]!; cy += point[1]!; cz += point[2]!; }
    const norm = Math.hypot(cx, cy, cz) || 1;
    centers.push({ cell, position: [cx / norm, cy / norm, cz / norm] });
    const topRadius = populationRadius(cell.population), baseRadius = 1.0005;
    for (const ring of cell.polygons) {
      const points = ring.length > 3 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
      if (points.length < 3) continue;
      let rx = 0, ry = 0, rz = 0;
      const unit = points.map(([lon, lat]) => globePosition(lon, lat));
      for (const p of unit) { rx += p[0]; ry += p[1]; rz += p[2]; }
      const rnorm = Math.hypot(rx, ry, rz) || 1, center = push([rx / rnorm * topRadius, ry / rnorm * topRadius, rz / rnorm * topRadius], intensity);
      const top = unit.map((p) => push([p[0] * topRadius, p[1] * topRadius, p[2] * topRadius], intensity));
      const base = unit.map((p) => push([p[0] * baseRadius, p[1] * baseRadius, p[2] * baseRadius], intensity));
      for (let i = 0; i < top.length; i++) { topIndices.push(center, top[i]!, top[(i + 1) % top.length]!); triangles++; }
      for (let i = 0; i < top.length; i++) {
        const j = (i + 1) % top.length;
        sideIndices.push(top[i]!, base[i]!, top[j]!, top[j]!, base[i]!, base[j]!); triangles += 2; lines++;
      }
    }
  }
  return { vertices: new Float32Array(values), topIndices: new Uint32Array(topIndices), sideIndices: new Uint32Array(sideIndices), centers, triangles, lines };
}

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const startedAt = performance.now();
  const response = await fetch(`${base}/kontur.json`);
  if (!response.ok) throw new Error(`kontur.json: HTTP ${response.status}`);
  const data = await response.json() as HexGrid;
  validateHexGrid(data);
  if (data.cells.length !== 71_283 || data.populationTotal !== 8_031_924_024) throw new Error('Kontur grid does not match the pinned source snapshot');
  const mesh = meshFor(data);
  const context = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, powerPreference: 'high-performance' });
  if (!context) throw new Error('WebGL2 is unavailable');
  const gl = context as WebGL2RenderingContext;
  const background = compile(gl, BACKGROUND_VS, BACKGROUND_FS), cells = compile(gl, CELLS_VS, CELLS_FS);
  const vao = gl.createVertexArray(); if (!vao) throw new Error('Could not create cell vertex array');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
  const stride = 16;
  for (const [loc, size, offset] of [[0, 3, 0], [1, 1, 12]] as const) {
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
  }
  const topIndexBuffer = gl.createBuffer(), sideIndexBuffer = gl.createBuffer();
  if (!topIndexBuffer || !sideIndexBuffer) throw new Error('Could not create index buffers');
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, topIndexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.topIndices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sideIndexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.sideIndices, gl.STATIC_DRAW);
  const backgroundVao = gl.createVertexArray(); if (!backgroundVao) throw new Error('Could not create background vertex array');
  const camera: GlobeCamera = { yaw: (15 * Math.PI) / 180, pitch: (15 * Math.PI) / 180, zoom: 1 };
  let width = 0, height = 0, dpr = 1, selected: HexCell | null = null, frameCount = 0, drawCpuMs = 0;
  const rotationMatrix = () => {
    const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
    return new Float32Array([-sy, -sp * cy, cp * cy, 0, cp, sp, cy, -sp * sy, cp * sy]);
  };
  const centerX = () => width * 0.555, centerY = () => height * 0.51;
  const scalePx = () => Math.min(width, height) * 0.415 * camera.zoom;
  function screenPoint(position: readonly [number, number, number], radius = 1): { x: number; y: number; z: number } {
    const p = rotate([position[0] * radius, position[1] * radius, position[2] * radius], camera);
    const scale = scalePx(); return { x: centerX() + p[0] * scale, y: centerY() - p[1] * scale, z: p[2] };
  }
  function draw() {
    if (!width || !height) return;
    const start = performance.now();
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.012, 0.023, 0.031, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    const r = scalePx(), sx = 2 * r / width, sy = 2 * r / height;
    const cx = 2 * centerX() / width - 1, cy = 1 - 2 * centerY() / height;
    gl.useProgram(background.value); gl.bindVertexArray(backgroundVao);
    gl.uniform2f(uniform(background, 'uCenter'), cx, cy); gl.uniform2f(uniform(background, 'uScale'), sx, sy);
    gl.uniformMatrix3fv(uniform(background, 'uInverseRotation'), false, inverseRotation(camera)); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(cells.value); gl.bindVertexArray(vao); gl.uniformMatrix3fv(uniform(cells, 'uRotation'), false, rotationMatrix());
    gl.uniform2f(uniform(cells, 'uScale'), sx, sy); gl.uniform2f(uniform(cells, 'uCenter'), cx, cy);
    gl.uniform1f(uniform(cells, 'uShade'), 1); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, topIndexBuffer);
    gl.drawElements(gl.TRIANGLES, mesh.topIndices.length, gl.UNSIGNED_INT, 0);
    gl.uniform1f(uniform(cells, 'uShade'), 0.46); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sideIndexBuffer);
    gl.drawElements(gl.TRIANGLES, mesh.sideIndices.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null); frameCount++; drawCpuMs += performance.now() - start;
  }
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1); width = canvas.clientWidth; height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); draw();
  }
  function select(cell: HexCell | null) {
    selected = cell;
    canvas.dispatchEvent(new CustomEvent('hex-select', { detail: { cell } }));
  }
  function pick(x: number, y: number): HexCell | null {
    let nearest: CellCenter | null = null, best = Infinity;
    for (const candidate of mesh.centers) {
      const screen = screenPoint(candidate.position, populationRadius(candidate.cell.population));
      if (screen.z <= 0.25) continue;
      const dx = screen.x - x, dy = screen.y - y, distance2 = dx * dx + dy * dy;
      if (distance2 < best) { best = distance2; nearest = candidate; }
    }
    // A screen-space hit test follows the actually rendered, radially raised
    // cell centers. The sphere-ray intersection would miss elevated cells near
    // the limb because their projected centers lie outside the base sphere.
    return nearest && best < 64 ? nearest.cell : null;
  }
  let drag: { id: number; x: number; y: number; moved: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => { drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 }; if (event.isTrusted) canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y; drag.x = event.clientX; drag.y = event.clientY; drag.moved += Math.hypot(dx, dy);
    rotateBy(dx, dy);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.moved < 4) { const rect = canvas.getBoundingClientRect(); select(pick(event.clientX - rect.left, event.clientY - rect.top)); }
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); zoomBy(event.deltaY); }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') camera.yaw -= 0.12;
    else if (event.key === 'ArrowRight') camera.yaw += 0.12;
    else if (event.key === 'ArrowUp') camera.pitch = Math.min(1.48, camera.pitch + 0.12);
    else if (event.key === 'ArrowDown') camera.pitch = Math.max(-1.48, camera.pitch - 0.12);
    else if (event.key === '+' || event.key === '=') camera.zoom = Math.min(1.5, camera.zoom * 1.12);
    else if (event.key === '-') camera.zoom = Math.max(0.72, camera.zoom / 1.12);
    else if (event.key === 'Escape') select(null);
    else return;
    event.preventDefault(); draw();
  });
  new ResizeObserver(resize).observe(canvas); resize();
  const startedAtEnd = performance.now();
  function projectCell(id: string) {
    const candidate = mesh.centers.find(({ cell }) => cell.h3 === id); if (!candidate) return null;
    return screenPoint(candidate.position, populationRadius(candidate.cell.population));
  }
  function screenForGeo(lon: number, lat: number) { return screenPoint(globePosition(lon, lat)); }
  function readPixel(x: number, y: number): number[] {
    const rgba = new Uint8Array(4); gl.readPixels(Math.round(x * dpr), canvas.height - 1 - Math.round(y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba); return [...rgba];
  }
  function pixels() {
    gl.finish(); const output = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, output);
    let foreground = 0, cellColorCount = 0, silhouette = 0; const palette = new Set<number>();
    for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) {
      const i = (y * canvas.width + x) * 4, r = output[i]!, g = output[i + 1]!, b = output[i + 2]!;
      if (r > 35 || g > 80 || b > 100) foreground++;
      if (r > 50 && g > 100 && b > 120) { cellColorCount++; palette.add((r >> 3) << 10 | (g >> 3) << 5 | (b >> 3)); }
      const px = x / dpr, py = y / dpr, dx = (px - centerX()) / scalePx(), dy = (py - centerY()) / scalePx();
      if (dx * dx + dy * dy < 0.98 && dx * dx + dy * dy > 0.84 && b > 30) silhouette++;
    }
    return { foregroundPixels: foreground, cellPixels: cellColorCount, cellColors: palette.size, limbPixels: silhouette };
  }
  const initialCamera = { ...camera };
  function reset() { Object.assign(camera, initialCamera); draw(); }
  function rotateBy(dx: number, dy: number) {
    camera.yaw += dx * 0.006; camera.pitch = Math.max(-1.48, Math.min(1.48, camera.pitch + dy * 0.006)); draw();
  }
  function zoomBy(delta: number) { camera.zoom = Math.max(0.72, Math.min(1.5, camera.zoom * Math.exp(-delta * 0.001))); draw(); }
  function populationExtremes() {
    const visible = mesh.centers.map((candidate) => ({ candidate, screen: screenPoint(candidate.position, populationRadius(candidate.cell.population)) }))
      .filter(({ screen }) => screen.z > 0.25 && screen.x >= 0 && screen.x < width && screen.y >= 0 && screen.y < height);
    visible.sort((a, b) => a.candidate.cell.population - b.candidate.cell.population);
    return { low: visible[0] ?? null, high: visible.at(-1) ?? null };
  }
  return {
    gl, data, camera, draw, reset, rotateBy, zoomBy, select, pick, projectCell, screenForGeo, readPixel, pixels, populationExtremes,
    get selected() { return selected; },
    get firstFrameMs() { return startedAtEnd - startedAt; },
    get frameCount() { return frameCount; },
    get averageDrawCpuMs() { return drawCpuMs / Math.max(1, frameCount); },
    get triangleCount() { return mesh.triangles; },
    get lineCount() { return mesh.lines; },
    get center() { return { x: centerX(), y: centerY(), radius: scalePx() }; },
    get size() { return { width, height, dpr }; },
    get gpuMemoryBytes() { return mesh.vertices.byteLength + mesh.topIndices.byteLength + mesh.sideIndices.byteLength; },
  };
}

export type HexGlobeRenderer = Awaited<ReturnType<typeof mount>>;
