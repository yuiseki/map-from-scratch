// WebGL2 renderer: sky (full-screen triangle), terrain (one indexed draw,
// heights read from an R16UI texture in the vertex shader), turbines (one
// instanced draw). Three draw calls per frame.
import { gridIndices, QUANTUM, type Terrain } from './terrain.ts';
import { buildTurbineMesh, REF_HUB, REF_RADIUS, ROTOR_OFFSET, windForward } from './turbine.ts';
import { orbitCamera, type OrbitView, type CameraMatrices } from './camera.ts';

export interface TurbineInstance { id: number; x: number; y: number; z: number; hub: number; diameter: number }
export interface RenderOptions { terrain?: boolean; turbines?: boolean }

// A low afternoon sun over the Sea of Japan: from the west-south-west
// (azimuth 250 degrees), 14 degrees up. Seen from the opening view (looking
// south-south-west) it lights the turbines from the right and rakes across
// the dunes and the west face of Mt Iwaki, so the relief reads in long soft
// light and shade.
const SUN_AZ = 250, SUN_EL = 14;
const SUN = (() => {
  const a = (SUN_AZ * Math.PI) / 180, e = (SUN_EL * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)].map((c) => c.toFixed(5)).join(', ');
})();
const SUN_Z = Math.sin((SUN_EL * Math.PI) / 180);
const SKY_ZENITH = '0.30, 0.50, 0.78', SKY_HORIZON = '0.86, 0.87, 0.86', SUN_GLOW = '1.00, 0.86, 0.64';
// Atmospheric perspective: the share of the haze colour after d metres,
// 1 - exp(-d / HAZE). The far turbines (20 km) fade by about half, Mt
// Iwaki (31 km) by two thirds; the same haze for terrain and turbines.
const HAZE = 26000;
const f = (n: number) => n.toFixed(4);

const SKY_VS = `#version 300 es
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;
const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 uInv;
in vec2 vNdc;
out vec4 o;
void main() {
  vec4 a = uInv * vec4(vNdc, -1.0, 1.0), b = uInv * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float t = pow(clamp(d.z, 0.0, 1.0), 0.55);
  vec3 c = mix(vec3(${SKY_HORIZON}), vec3(${SKY_ZENITH}), t);
  // warm glow towards the low sun
  float g = max(dot(d, vec3(${SUN})), 0.0);
  c = mix(c, vec3(${SUN_GLOW}), 0.45 * pow(g, 6.0) * (1.0 - 0.6 * t));
  o = vec4(c, 1.0);
}`;

const TERRAIN_VS = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D uH;
uniform mat4 uVP;
uniform vec3 uEye;
uniform ivec2 uSize;
uniform vec3 uGrid;   // x0, y0, cell
out vec3 vN;
out float vH;
out float vFog;
float h(ivec2 c) { return float(texelFetch(uH, clamp(c, ivec2(0), uSize - 1), 0).r) * ${f(QUANTUM)}; }
void main() {
  ivec2 c = ivec2(gl_VertexID % uSize.x, gl_VertexID / uSize.x);
  float z = h(c);
  vec3 p = vec3(uGrid.xy + vec2(c) * uGrid.z, z);
  vN = normalize(vec3((h(c - ivec2(1, 0)) - h(c + ivec2(1, 0))) / (2.0 * uGrid.z),
                      (h(c - ivec2(0, 1)) - h(c + ivec2(0, 1))) / (2.0 * uGrid.z), 1.0));
  vH = z;
  vFog = 1.0 - exp(-distance(p, uEye) / ${f(HAZE)});
  // fade the last 4 km of the grid into the horizon colour, so the edge of
  // the baked area does not read as a cliff against the sky
  vec2 e = min(vec2(c), vec2(uSize - 1 - c)) * uGrid.z;
  vFog = max(vFog, 1.0 - smoothstep(0.0, 4000.0, min(e.x, e.y)));
  gl_Position = uVP * vec4(p, 1.0);
}`;
const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vN;
in float vH;
in float vFog;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  vec3 c = mix(vec3(0.42, 0.55, 0.32), vec3(0.55, 0.58, 0.38), smoothstep(5.0, 200.0, vH));
  c = mix(c, vec3(0.52, 0.47, 0.38), smoothstep(300.0, 900.0, vH));
  c = mix(c, vec3(0.72, 0.70, 0.66), smoothstep(1100.0, 1500.0, vH));
  // light relative to flat ground (1 on the flat), so the low sun keeps the
  // plain bright and only the slopes swing: lit faces up to 1.6, faces
  // turned away down to the sky light alone. Warm sun, cool sky.
  float l = max(dot(n, vec3(${SUN})), 0.0) / ${f(SUN_Z)};
  c *= vec3(0.40, 0.45, 0.52) + vec3(0.62, 0.56, 0.47) * min(l, 1.6);
  // the sea is 0 m in Mapterhorn; blend over the first metre so the coast
  // is not a staircase of 80 m cells
  c = mix(vec3(0.18, 0.32, 0.45), c, smoothstep(0.0, 1.0, vH));
  o = vec4(mix(c, vec3(${SKY_HORIZON}), vFog), 1.0);
}`;

const TURBINE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in float aPart;
layout(location = 3) in vec3 aBase;
layout(location = 4) in vec2 aScale;   // hub / REF_HUB, radius / REF_RADIUS
layout(location = 5) in float aAngle;
uniform mat4 uVP;
uniform vec3 uEye;
uniform vec2 uFwd;    // rotor axis direction (east, north), into the wind
out vec3 vN;
out float vFog;
out float vPart;
void main() {
  vec3 p = aPos, n = aNor;
  if (aPart > 0.5) {
    float c = cos(aAngle), s = sin(aAngle);
    p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z) * aScale.y;
    n = vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);
    p += vec3(0.0, ${f(ROTOR_OFFSET)}, ${f(REF_HUB)}) * aScale.x;
  } else {
    p *= aScale.x;
  }
  vec2 r = vec2(uFwd.y, -uFwd.x);
  vec3 w = vec3(p.x * r + p.y * uFwd, p.z) + aBase;
  vN = vec3(n.x * r + n.y * uFwd, n.z);
  vFog = 1.0 - exp(-distance(w, uEye) / ${f(HAZE)});
  vPart = aPart;
  gl_Position = uVP * vec4(w, 1.0);
}`;
const TURBINE_FS = `#version 300 es
precision highp float;
in vec3 vN;
in float vFog;
in float vPart;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  float d = dot(n, vec3(${SUN}));
  // thin blades are lit from either side; the sun side warm, the other in
  // cool sky light
  vec3 c = vec3(0.93, 0.94, 0.95) * (vec3(0.62, 0.65, 0.70) + vec3(0.46, 0.40, 0.32) * abs(d));
  o = vec4(mix(c, vec3(${SKY_HORIZON}), vFog), 1.0);
}`;

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

export class WindFarmRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly turbines: TurbineInstance[];
  camera: CameraMatrices | null = null;
  drawCalls = 0;
  private sky: WebGLProgram;
  private terrainProg: WebGLProgram;
  private turbineProg: WebGLProgram;
  private terrainVao: WebGLVertexArrayObject;
  private turbineVao: WebGLVertexArrayObject;
  private angleBuf: WebGLBuffer;
  private heightTex: WebGLTexture;
  private terrain: Terrain;
  private indexCount: number;
  private meshCount: number;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement, terrain: Terrain, turbines: TurbineInstance[]) {
    const gl = canvas.getContext('webgl2', { antialias: true, depth: true });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.terrain = terrain;
    this.turbines = turbines;
    this.sky = program(gl, SKY_VS, SKY_FS);
    this.terrainProg = program(gl, TERRAIN_VS, TERRAIN_FS);
    this.turbineProg = program(gl, TURBINE_VS, TURBINE_FS);
    for (const [p, names] of [[this.sky, ['uInv']], [this.terrainProg, ['uH', 'uVP', 'uEye', 'uSize', 'uGrid']], [this.turbineProg, ['uVP', 'uEye', 'uFwd']]] as const) {
      const key = p === this.sky ? 's' : p === this.terrainProg ? 't' : 'w';
      for (const n of names) this.u[key + n] = gl.getUniformLocation(p, n);
    }

    // terrain: heights as a texture, indices only
    this.heightTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, terrain.w, terrain.h, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, terrain.raw);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.terrainVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.terrainVao);
    const idx = gridIndices(terrain.w, terrain.h);
    this.indexCount = idx.length;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    // turbines: one mesh, per-instance base, scales and rotor angle
    const mesh = buildTurbineMesh();
    this.meshCount = mesh.count;
    this.turbineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.turbineVao);
    const attr = (loc: number, data: Float32Array, size: number, divisor: number, usage: number = gl.STATIC_DRAW) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(loc, divisor);
      return b;
    };
    attr(0, mesh.position, 3, 0);
    attr(1, mesh.normal, 3, 0);
    attr(2, Float32Array.from(mesh.part), 1, 0);
    attr(3, Float32Array.from(turbines.flatMap((t) => [t.x, t.y, t.z])), 3, 1);
    attr(4, Float32Array.from(turbines.flatMap((t) => [t.hub / REF_HUB, t.diameter / 2 / REF_RADIUS])), 2, 1);
    this.angleBuf = attr(5, new Float32Array(turbines.length), 1, 1, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
  }

  resize(w: number, h: number): void {
    const c = this.gl.canvas as HTMLCanvasElement;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  render(view: OrbitView, windDeg: number, angles: Float32Array, opt: RenderOptions = {}): number {
    const gl = this.gl, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const cam = orbitCamera(view, W / H);
    this.camera = cam;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    let calls = 0;
    gl.useProgram(this.sky);
    gl.uniformMatrix4fv(this.u.suInv, false, cam.invViewProj);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    calls++;
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (opt.terrain !== false) {
      gl.enable(gl.CULL_FACE);
      gl.useProgram(this.terrainProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
      gl.uniform1i(this.u.tuH, 0);
      gl.uniformMatrix4fv(this.u.tuVP, false, cam.viewProj);
      gl.uniform3fv(this.u.tuEye, cam.eye);
      gl.uniform2i(this.u.tuSize, this.terrain.w, this.terrain.h);
      gl.uniform3f(this.u.tuGrid, this.terrain.x0, this.terrain.y0, this.terrain.cell);
      gl.bindVertexArray(this.terrainVao);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      gl.disable(gl.CULL_FACE);
      calls++;
    }
    if (opt.turbines !== false) {
      gl.useProgram(this.turbineProg);
      gl.uniformMatrix4fv(this.u.wuVP, false, cam.viewProj);
      gl.uniform3fv(this.u.wuEye, cam.eye);
      gl.uniform2fv(this.u.wuFwd, windForward(windDeg));
      gl.bindVertexArray(this.turbineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.angleBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, angles);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.meshCount, this.turbines.length);
      calls++;
    }
    gl.bindVertexArray(null);
    this.drawCalls = calls;
    return calls;
  }

  // RGBA of a screen rectangle (x, y from the top-left, device pixels), rows
  // from the top. Call right after render, in the same task.
  read(x: number, y: number, w: number, h: number): Uint8Array {
    const gl = this.gl, H = gl.drawingBufferHeight, raw = new Uint8Array(w * h * 4), out = new Uint8Array(w * h * 4);
    gl.readPixels(x, H - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    for (let r = 0; r < h; r++) out.set(raw.subarray((h - 1 - r) * w * 4, (h - r) * w * 4), r * w * 4);
    return out;
  }
}
