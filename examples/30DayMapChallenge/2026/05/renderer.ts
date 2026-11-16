import { cameraViewProjection, orbitByDrag, zoomCamera, type OrbitCamera } from './camera.ts';
import { makeGridIndices } from './terrain.ts';

const VERTICAL_SCALE = 0.75;
const TERRAIN_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in float a_height;
uniform mat4 u_vp; uniform highp usampler2D u_height; uniform ivec2 u_size; uniform float u_vertical;
out vec3 v_normal; out float v_height;
void main(){
  int id=gl_VertexID; int x=id%u_size.x; int y=id/u_size.x; ivec2 c=ivec2(x,y);
  int x0=max(x-1,0),x1=min(x+1,u_size.x-1),y0=max(y-1,0),y1=min(y+1,u_size.y-1);
  float hL=float(texelFetch(u_height,ivec2(x0,y),0).r)/65535.0, hR=float(texelFetch(u_height,ivec2(x1,y),0).r)/65535.0;
  float hN=float(texelFetch(u_height,ivec2(x,y0),0).r)/65535.0, hS=float(texelFetch(u_height,ivec2(x,y1),0).r)/65535.0;
  float step=2.0/float(u_size.x-1);
  float dzdx=(hR-hL)*u_vertical/(float(max(x1-x0,1))*step);
  float dzdy=(hN-hS)*u_vertical/(float(max(y1-y0,1))*step);
  v_normal=normalize(vec3(-dzdx,-dzdy,1.0)); v_height=a_height;
  vec2 p=vec2(float(x)/float(u_size.x-1)-0.5,0.5-float(y)/float(u_size.y-1))*2.0;
  gl_Position=u_vp*vec4(p,a_height*u_vertical,1.0);
}`;
const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 v_normal; in float v_height; out vec4 o;
vec3 palette(float h){
  vec3 forest=vec3(0.13,0.30,0.22), alpine=vec3(0.40,0.48,0.34), stone=vec3(0.62,0.58,0.49), snow=vec3(0.88,0.91,0.88);
  return h<0.42?mix(forest,alpine,smoothstep(0.0,0.42,h)):h<0.80?mix(alpine,stone,smoothstep(0.42,0.80,h)):mix(stone,snow,smoothstep(0.80,1.0,h));
}
void main(){
  vec3 n=normalize(v_normal), lightDir=normalize(vec3(-0.48,-0.36,0.80));
  float diffuse=max(dot(n,lightDir),0.0), shade=0.30+0.92*diffuse;
  float phase=fract(v_height*19.0), line=1.0-smoothstep(0.0,0.038,min(phase,1.0-phase));
  vec3 color=palette(v_height); color=mix(color,color*0.60,line*0.23);
  float ridge=pow(max(dot(n,normalize(vec3(-0.70,-0.20,0.72))),0.0),5.0);
  color=color*shade+vec3(0.12,0.18,0.19)*ridge*0.22;
  o=vec4(color,1.0);
}`;

interface Program { value: WebGLProgram; uniforms: Map<string, WebGLUniformLocation> }
interface Stats {
  sourceDate: string; width: number; height: number; cells: number;
  minimumMean: number; maximumMean: number; minimumCell: number; maximumCell: number;
  validSourcePixels: number; sourcePixelsPerCell: number; projectedCellSizeM: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  summitCell: { x: number; y: number; height: number }; binaryBytes: number;
}

function createProgram(gl: WebGL2RenderingContext): Program {
  const value = gl.createProgram();
  if (!value) throw new Error('WebGL2 could not create a program');
  for (const [kind, source] of [[gl.VERTEX_SHADER, TERRAIN_VS], [gl.FRAGMENT_SHADER, TERRAIN_FS]] as const) {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('WebGL2 could not create a shader');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'terrain shader compilation failed');
    gl.attachShader(value, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(value);
  if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value) ?? 'terrain shader link failed');
  const uniforms = new Map<string, WebGLUniformLocation>();
  for (let i = 0; i < gl.getProgramParameter(value, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(value, i)!.name, location = gl.getUniformLocation(value, name);
    if (location) uniforms.set(name, location);
  }
  return { value, uniforms };
}
function uniform(program: Program, name: string): WebGLUniformLocation {
  const location = program.uniforms.get(name);
  if (!location) throw new Error(`Missing terrain shader uniform ${name}`);
  return location;
}

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const startedAt = performance.now();
  const [terrainResponse, statsResponse] = await Promise.all([fetch(`${base}/terrain.bin`), fetch(`${base}/stats.json`)]);
  if (!terrainResponse.ok) throw new Error(`terrain.bin: HTTP ${terrainResponse.status}`);
  if (!statsResponse.ok) throw new Error(`stats.json: HTTP ${statsResponse.status}`);
  const [terrainData, stats] = await Promise.all([terrainResponse.arrayBuffer(), statsResponse.json() as Promise<Stats>]);
  const header = new DataView(terrainData);
  if (String.fromCharCode(...new Uint8Array(terrainData, 0, 4)) !== 'FJT1') throw new Error('Unsupported Fuji terrain signature');
  const width = header.getUint16(4, true), height = header.getUint16(6, true), cellCount = header.getUint32(16, true);
  const minimum = header.getFloat32(8, true), maximum = header.getFloat32(12, true);
  if (cellCount !== width * height || terrainData.byteLength !== 20 + cellCount * 2 || width !== stats.width || height !== stats.height || cellCount !== stats.cells || maximum <= minimum) {
    throw new Error('Baked Fuji terrain and statistics disagree');
  }
  const glContext = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!glContext) throw new Error('WebGL2 is not available');
  const gl = glContext;
  const glErrors: string[] = [];
  const checkGL = (stage: string) => { const error = gl.getError(); if (error !== gl.NO_ERROR) glErrors.push(`${stage}:${error}`); };
  const program = createProgram(gl), vao = gl.createVertexArray()!;
  checkGL('program');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, terrainData.slice(20), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.UNSIGNED_SHORT, true, 2, 0);
  const indices = makeGridIndices(width, height);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  checkGL('mesh-buffers');
  const heightTexture = gl.createTexture()!; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, heightTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(terrainData, 20));
  checkGL('height-texture');
  gl.bindVertexArray(null); gl.bindTexture(gl.TEXTURE_2D, null);
  const state: OrbitCamera = { yaw: 40, pitch: 38, distance: 3.1 };
  const initialCamera: OrbitCamera = { ...state };
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.frontFace(gl.CCW); gl.cullFace(gl.BACK);
  function draw(debug = false) {
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.035, 0.061, 0.074, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (debug) checkGL('clear');
    gl.useProgram(program.value);
    gl.uniformMatrix4fv(uniform(program, 'u_vp'), false, cameraViewProjection(state, canvas.width / canvas.height));
    gl.uniform1i(uniform(program, 'u_height'), 0); gl.uniform2i(uniform(program, 'u_size'), width, height);
    gl.uniform1f(uniform(program, 'u_vertical'), VERTICAL_SCALE);
    if (debug) checkGL('uniforms');
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, heightTexture); gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
    if (debug) checkGL('mesh-draw');
    gl.bindVertexArray(null); gl.bindTexture(gl.TEXTURE_2D, null);
  }
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (event) => { dragging = true; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', () => { dragging = false; }); canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const next = orbitByDrag(state, event.clientX - lastX, event.clientY - lastY); state.yaw = next.yaw; state.pitch = next.pitch;
    lastX = event.clientX; lastY = event.clientY; draw();
  });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); Object.assign(state, zoomCamera(state, event.deltaY)); draw(); }, { passive: false });
  let initialDraw = true;
  const resize = () => {
    canvas.width = Math.round(canvas.clientWidth * devicePixelRatio); canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
    draw(initialDraw); initialDraw = false;
  };
  resize(); new ResizeObserver(resize).observe(canvas);
  const readPixels = () => {
    gl.finish(); const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let terrainPixels = 0, colorCount = 0; const colors = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
      if (Math.abs(r - 9) + Math.abs(g - 16) + Math.abs(b - 19) > 18) terrainPixels++;
      colors.add((r >> 3) << 10 | (g >> 3) << 5 | (b >> 3));
    }
    colorCount = colors.size;
    return { terrainPixels, colorCount };
  };
  const reset = () => { Object.assign(state, initialCamera); draw(); };
  return { gl, glErrors, stats, state, draw, reset, readPixels, width, height, triangleCount: indices.length / 3, startedAt, verticalScale: VERTICAL_SCALE };
}

export type FujiTerrain = Awaited<ReturnType<typeof mount>>;
