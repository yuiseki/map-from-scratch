import { decodeUrbanCells, URBAN_EXTENT } from './urban.ts';

export interface UrbanStats {
  sourceRelease: string; resolutionArcseconds: number; crs: string;
  cells: number; populationCells: number; builtOnlyCells: number; matchedCellCount: number;
  populationEstimate: number; builtSurfaceM2: number;
  extent: { west: number; east: number; south: number; north: number };
  recordBytes: number; outputBytes: number; populationProduct: string; builtProduct: string;
  spatialJoin: string;
}
export interface UrbanMap {
  canvas: HTMLCanvasElement; stats: UrbanStats; records: Float32Array; firstFrameMs: number;
  state: { zoom: number; panX: number; panY: number };
  draw(): void;
}

const VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aMeasure;
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform vec2 uPan;
uniform float uScale;
uniform float uZoom;
uniform float uCosLatitude;
out float vLatitude;
out float vPopulation;
out float vBuilt;
void main() {
  vec2 pixel = vec2(uViewport.x * 0.5 + (aPosition.x - uCenter.x) * uCosLatitude * uScale * uZoom + uPan.x,
                    uViewport.y * 0.5 - (aPosition.y - uCenter.y) * uScale * uZoom + uPan.y);
  gl_Position = vec4(pixel.x / uViewport.x * 2.0 - 1.0, 1.0 - pixel.y / uViewport.y * 2.0, 0.0, 1.0);
  gl_PointSize = clamp(uScale * uZoom * 0.0083333333 * 0.9, 1.0, 10.0);
  vLatitude = aPosition.y;
  vPopulation = aMeasure.x;
  vBuilt = aMeasure.y;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in float vLatitude;
in float vPopulation;
in float vBuilt;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  if (dot(p, p) > 1.0) discard;
  const float R = 6371008.8;
  const float d = radians(30.0 / 3600.0);
  float lat = radians(vLatitude);
  float areaKm2 = R * R * d * (sin(lat + d * 0.5) - sin(lat - d * 0.5)) / 1000000.0;
  float density = vPopulation / max(areaKm2, 0.000001);
  float densityTone = clamp(log2(1.0 + density) / log2(25001.0), 0.0, 1.0);
  float builtShare = clamp(vBuilt / (areaKm2 * 1000000.0), 0.0, 1.0);
  vec3 rural = vec3(0.17, 0.68, 0.66);
  vec3 urban = vec3(1.0, 0.39, 0.19);
  vec3 hue = mix(rural, urban, smoothstep(0.015, 0.55, builtShare));
  vec3 color = mix(vec3(0.045, 0.085, 0.11), hue, 0.22 + densityTone * 0.78);
  float alpha = 0.52 + max(densityTone, builtShare * 0.35) * 0.48;
  outColor = vec4(color, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL2 could not allocate a shader');
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'WebGL2 shader compilation failed');
  return shader;
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<UrbanMap> {
  const started = performance.now();
  const [binaryResponse, statsResponse] = await Promise.all([fetch(`${dataUrl}/urban.bin`), fetch(`${dataUrl}/stats.json`)]);
  if (!binaryResponse.ok || !statsResponse.ok) throw new Error(`GHSL data request failed: ${binaryResponse.status} / ${statsResponse.status}`);
  const [binary, stats] = await Promise.all([binaryResponse.arrayBuffer(), statsResponse.json() as Promise<UrbanStats>]);
  const records = decodeUrbanCells(binary, URBAN_EXTENT);
  if (records.length / 4 !== stats.cells || stats.recordBytes !== 8 || stats.resolutionArcseconds !== 30) throw new Error('GHSL record count or layout does not match metadata');
  const glContext = canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' });
  if (!glContext) throw new Error('WebGL2 is unavailable');
  const gl = glContext;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX), fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL2 could not allocate a program');
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL2 program linking failed');
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('WebGL2 could not allocate a vertex buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, records, gl.STATIC_DRAW);
  gl.useProgram(program);
  const position = gl.getAttribLocation(program, 'aPosition'), measure = gl.getAttribLocation(program, 'aMeasure');
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(measure); gl.vertexAttribPointer(measure, 2, gl.FLOAT, false, 16, 8);
  const uniforms = {
    viewport: gl.getUniformLocation(program, 'uViewport'), center: gl.getUniformLocation(program, 'uCenter'),
    pan: gl.getUniformLocation(program, 'uPan'), scale: gl.getUniformLocation(program, 'uScale'),
    zoom: gl.getUniformLocation(program, 'uZoom'), cosLatitude: gl.getUniformLocation(program, 'uCosLatitude'),
  };
  const meanLatitude = (stats.extent.south + stats.extent.north) * 0.5;
  const cosine = Math.cos(meanLatitude * Math.PI / 180);
  const center: [number, number] = [(stats.extent.west + stats.extent.east) * 0.5, meanLatitude];
  const state = { zoom: 1, panX: 0, panY: 0 };
  const map: UrbanMap = { canvas, stats, records, firstFrameMs: 0, state, draw };
  const dpr = Math.min(devicePixelRatio || 1, 2);

  function resize() {
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    const worldWidth = (stats.extent.east - stats.extent.west) * cosine;
    const worldHeight = stats.extent.north - stats.extent.south;
    return Math.min(width / worldWidth, height / worldHeight) * 0.91;
  }
  function draw() {
    const fitScale = resize();
    gl.clearColor(0.035, 0.065, 0.08, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.uniform2f(uniforms.viewport, canvas.width, canvas.height);
    gl.uniform2f(uniforms.center, center[0], center[1]);
    gl.uniform2f(uniforms.pan, state.panX, state.panY);
    gl.uniform1f(uniforms.scale, fitScale);
    gl.uniform1f(uniforms.zoom, state.zoom);
    gl.uniform1f(uniforms.cosLatitude, cosine);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, records.length / 4);
  }

  let dragging = false, previousX = 0, previousY = 0;
  canvas.addEventListener('pointerdown', (event) => { dragging = true; previousX = event.clientX; previousY = event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    state.panX += (event.clientX - previousX) * dpr; state.panY += (event.clientY - previousY) * dpr;
    previousX = event.clientX; previousY = event.clientY; draw();
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rectangle = canvas.getBoundingClientRect();
    const cursorX = (event.clientX - rectangle.left) * dpr, cursorY = (event.clientY - rectangle.top) * dpr;
    const oldZoom = state.zoom, newZoom = Math.max(0.65, Math.min(24, oldZoom * Math.exp(-event.deltaY * 0.001)));
    state.panX = cursorX - canvas.width * 0.5 - (cursorX - canvas.width * 0.5 - state.panX) * newZoom / oldZoom;
    state.panY = cursorY - canvas.height * 0.5 - (cursorY - canvas.height * 0.5 - state.panY) * newZoom / oldZoom;
    state.zoom = newZoom; draw();
  }, { passive: false });
  new ResizeObserver(draw).observe(canvas);
  draw();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  map.firstFrameMs = performance.now() - started;
  return map;
}
