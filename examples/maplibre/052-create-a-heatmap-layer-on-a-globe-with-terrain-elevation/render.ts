// WebGL2 renderer: sky and atmosphere, the Akita terrain mesh with the
// heatmap draped on it, and a coarse world mesh around it, all on one globe.
import { frame, metresPerPixel, atmosphereBlend, EARTH_R, FOV, type View, type Frame } from './camera.ts';
import {
  ACCUM_VS, ACCUM_FS, HIST_VS, HIST_FS, PCT_VS, PCT_FS, HEAT_T_GLSL, HIST_BINS, HIST_SAMPLES_FLOAT, HIST_SAMPLES_HALF,
  kernelExtent, radiusZoomFactor, heatLevel, histSampling, rampTexture, RAMP_SIZE,
} from './heat.ts';
import { gridMesh } from './mesh.ts';
import { mercX, mercY, lonOfX, latOfY } from './tiles.ts';
import { yearRange, type Points } from './points.ts';

export interface Grid { z: number; x0: number; y0: number; nx: number; ny: number }
export interface Heights { h: Float32Array; w: number; hgt: number; grid: Grid }

// Mesh resolution of the Akita area: 512 x 683 cells, one vertex per 3
// texels of the z9 heights (351 m). Shading is per pixel from the texture.
const AREA_CELLS: [number, number] = [512, 683];
const WORLD_CELLS: [number, number] = [360, 180];
export const HEAT_W = 2048, HEAT_H = 2730;      // 3:4, like the area (3 x 4 z9 tiles)
const SKIRT_M = 1500;

const SHADE = /* glsl */`
const float PI = 3.141592653589793;
const float R = ${EARTH_R.toFixed(1)};
vec3 globe(float lon, float lat, float h) {
  float r = R + h;
  return r * vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
}`;

const TERRAIN_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 a;
uniform mat4 u_m;
uniform vec3 u_eye;
uniform int u_mode;          // 0 the Akita area, 1 the world
uniform vec4 u_area;         // mercator x0, y0, width, height of the area
uniform sampler2D u_hArea, u_hWorld;
out vec2 v_merc;
out vec3 v_rel, v_dir;
${SHADE}
void main() {
  float lon, lat, h;
  if (u_mode == 0) {
    v_merc = u_area.xy + a.xy * u_area.zw;
    lon = (v_merc.x * 2.0 - 1.0) * PI;
    lat = atan(sinh(PI * (1.0 - 2.0 * v_merc.y)));
    h = textureLod(u_hArea, a.xy, 0.0).r - a.z * ${SKIRT_M.toFixed(1)};
  } else {
    lon = (a.x * 2.0 - 1.0) * PI;
    lat = (0.5 - a.y) * PI;
    float l = clamp(lat, -1.5, 1.5);
    v_merc = vec2(a.x, 0.5 - log(tan(PI / 4.0 + l / 2.0)) / (2.0 * PI));
    h = textureLod(u_hWorld, vec2(v_merc.x, clamp(v_merc.y, 0.0, 1.0)), 0.0).r;
  }
  vec3 p = globe(lon, lat, h);
  v_rel = p - u_eye;
  v_dir = normalize(p);
  gl_Position = u_m * vec4(v_rel, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_merc;
in vec3 v_rel, v_dir;
uniform int u_mode;
uniform vec4 u_area;
uniform sampler2D u_hArea, u_hWorld, u_heat, u_ramp, u_dref;
uniform vec2 u_heatScale;
uniform float u_heatOn, u_atm, u_fogAmt, u_intensity;
uniform vec2 u_fog;
uniform vec3 u_horizon;
out vec4 o;
${SHADE}
const vec3 ATM = vec3(0.55, 0.78, 1.0);
${HEAT_T_GLSL}
void main() {
  vec2 uv; ivec2 n;
  bool area = u_mode == 0;
  if (area) {
    uv = (v_merc - u_area.xy) / u_area.zw;
    n = textureSize(u_hArea, 0);
  } else {
    vec2 q = (v_merc - u_area.xy) / u_area.zw;
    if (all(greaterThan(q, vec2(0.0))) && all(lessThan(q, vec2(1.0)))) discard;
    uv = vec2(v_merc.x, clamp(v_merc.y, 0.0, 1.0));
    n = textureSize(u_hWorld, 0);
  }
  vec2 t = 1.0 / vec2(n);
  #define H(o) (area ? texture(u_hArea, uv + (o)).r : texture(u_hWorld, uv + (o)).r)
  float h = H(vec2(0.0));
  float hl = H(vec2(-t.x, 0.0)), hr = H(vec2(t.x, 0.0)), hu = H(vec2(0.0, -t.y)), hd = H(vec2(0.0, t.y));
  // Texel size in metres: mercator units times the circumference at this latitude.
  float lat = asin(clamp(v_dir.z, -1.0, 1.0));
  vec2 mercPerTexel = area ? t * u_area.zw : t;
  vec2 m = mercPerTexel * 2.0 * PI * R * max(cos(lat), 0.01);
  vec3 nrm = normalize(vec3(-(hr - hl) / (2.0 * m.x), -(hu - hd) / (2.0 * m.y), 1.0));
  // Hillshade lit from the north-west, 45 degrees up (MapLibre's default direction).
  float s = dot(nrm, normalize(vec3(-0.5, 0.5, 0.7071))) - 0.7071;
  vec3 low = vec3(0.86, 0.90, 0.78), mid = vec3(0.90, 0.87, 0.77), high = vec3(0.96, 0.95, 0.93);
  vec3 c = h < 600.0 ? mix(low, mid, h / 600.0) : mix(mid, high, clamp((h - 600.0) / 1200.0, 0.0, 1.0));
  if (abs(h) < 0.2) c = vec3(0.66, 0.81, 0.91);          // Mapterhorn's sea is exactly 0 m
  c = s < 0.0 ? mix(c, vec3(0.278, 0.231, 0.141), clamp(-s * 1.4, 0.0, 0.85)) : mix(c, vec3(1.0), clamp(s * 0.8, 0.0, 0.5));
  if (area) {
    float d = heatT(texture(u_heat, uv * u_heatScale).r, texelFetch(u_dref, ivec2(0), 0).r, u_intensity);
    vec4 r = texture(u_ramp, vec2(d * ${((RAMP_SIZE - 1) / RAMP_SIZE).toFixed(6)} + ${(0.5 / RAMP_SIZE).toFixed(6)}, 0.5));
    c = mix(c, r.rgb, r.a * u_heatOn);
  }
  float dist = length(v_rel);
  c = mix(c, u_horizon, smoothstep(u_fog.x, u_fog.y, dist) * u_fogAmt);
  float rim = 1.0 - abs(dot(normalize(-v_rel), v_dir));
  c = mix(c, ATM, pow(rim, 4.0) * u_atm * 0.7);
  o = vec4(c, 1.0);
}`;

const SKY_VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
uniform vec3 u_eye, u_fwd, u_right, u_up, u_horizon;
uniform vec2 u_size, u_tan;
uniform float u_atm;
out vec4 o;
${SHADE}
const vec3 ATM = vec3(0.55, 0.78, 1.0);
void main() {
  vec2 ndc = gl_FragCoord.xy / u_size * 2.0 - 1.0;
  vec3 d = normalize(u_fwd + u_right * ndc.x * u_tan.x + u_up * ndc.y * u_tan.y);
  float r = length(u_eye);
  vec3 up = u_eye / r;
  float dip = -sqrt(max(0.0, 1.0 - (R / r) * (R / r)));
  float e = clamp((dot(d, up) - dip) / 0.35, 0.0, 1.0);
  vec3 sky = mix(u_horizon, vec3(0.533, 0.776, 0.988), sqrt(e));
  vec3 c = mix(sky, vec3(0.02, 0.03, 0.07), u_atm);
  // Atmosphere halo: glow by how close the ray passes to the sphere.
  float tc = -dot(u_eye, d);
  float b = tc > 0.0 ? length(u_eye + d * tc) : r;
  float glow = exp(-max(b - R, 0.0) / (0.1 * R));
  c = mix(c, ATM, glow * u_atm);
  o = vec4(c, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
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

function floatTarget(gl: WebGL2RenderingContext, format: number, w: number, h: number): [WebGLTexture, WebGLFramebuffer] {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const f = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('float framebuffer incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return [t, f];
}

function heightTexture(gl: WebGL2RenderingContext, h: Float32Array, w: number, hgt: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, hgt, 0, gl.RED, gl.FLOAT, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function meshVao(gl: WebGL2RenderingContext, nx: number, ny: number, skirts: boolean): [WebGLVertexArrayObject, number] {
  const m = gridMesh(nx, ny, skirts);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, m.vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return [vao, m.indices.length];
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  view: View;
  radius = 15;          // px at zoom 9 and above, the original's curve below
  intensity = 1;        // MapLibre's default; scales density / Dref (heat.ts heatT)
  year = 0;             // 0: every year
  heatOn = 1;
  lastFrame: Frame | null = null;
  heatCalls = 0;        // accumulation passes run (the bench reports it)
  private terrain: WebGLProgram; private sky: WebGLProgram; private accum: WebGLProgram;
  private histProg: WebGLProgram; private pctProg: WebGLProgram;
  private hist: [WebGLTexture, WebGLFramebuffer]; private dref: [WebGLTexture, WebGLFramebuffer];
  private histSamples: number;
  private u = new Map<string, WebGLUniformLocation | null>();
  private area: Heights; private world: Heights | null = null;
  private areaRect: [number, number, number, number];
  private hArea: WebGLTexture; private hWorld: WebGLTexture; private heat: WebGLTexture; private ramp: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private areaVao: [WebGLVertexArrayObject, number]; private worldVao: [WebGLVertexArrayObject, number] | null = null;
  private pointVao: WebGLVertexArrayObject; private pointBuf: WebGLBuffer;
  points: Points;
  private heatKey = ''; private heatScale: [number, number] = [1, 1];

  constructor(canvas: HTMLCanvasElement, area: Heights, points: Points, view: View) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is needed for the half-float heat texture');
    this.gl = gl;
    this.view = view;
    this.area = area;
    this.points = points;
    const g = area.grid, n = 2 ** g.z;
    this.areaRect = [g.x0 / n, g.y0 / n, g.nx / n, g.ny / n];
    this.terrain = compile(gl, TERRAIN_VS, TERRAIN_FS);
    this.sky = compile(gl, SKY_VS, SKY_FS);
    this.accum = compile(gl, ACCUM_VS, ACCUM_FS);
    this.histProg = compile(gl, HIST_VS, HIST_FS);
    this.pctProg = compile(gl, PCT_VS, PCT_FS);
    // The percentile of the density, on the GPU: a log2 histogram counted with additive
    // blending (exact in float32 with EXT_float_blend, else half float with fewer samples),
    // then a 1 x 1 pass that walks it. Nothing is read back to the CPU.
    const floatBlend = !!gl.getExtension('EXT_float_blend');
    this.histSamples = floatBlend ? HIST_SAMPLES_FLOAT : HIST_SAMPLES_HALF;
    this.hist = floatTarget(gl, floatBlend ? gl.R32F : gl.R16F, HIST_BINS, 1);
    this.dref = floatTarget(gl, gl.R32F, 1, 1);
    this.hArea = heightTexture(gl, area.h, area.w, area.hgt);
    this.hWorld = heightTexture(gl, new Float32Array(1), 1, 1);
    this.areaVao = meshVao(gl, AREA_CELLS[0], AREA_CELLS[1], true);

    this.heat = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.heat);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, HEAT_W, HEAT_H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.heat, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('heat framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.ramp = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.ramp);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, RAMP_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rampTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

    this.pointVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.pointBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, points.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  setWorld(world: Heights): void {
    const gl = this.gl;
    this.world = world;
    gl.deleteTexture(this.hWorld);
    this.hWorld = heightTexture(gl, world.h, world.w, world.hgt);
    this.worldVao = meshVao(gl, WORLD_CELLS[0], WORLD_CELLS[1], false);
  }

  /** Replace the heat points (the bench places a single known point). */
  setPoints(points: Points): void {
    this.points = points;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, points.uv, gl.STATIC_DRAW);
    this.heatKey = '';
  }

  /** Force the next draw to accumulate the heat again (the bench times that path). */
  invalidateHeat(): void { this.heatKey = ''; }

  /** Ground height (m) as the meshes draw it: the area where it has data, else the world. */
  heightAt(lon: number, lat: number): number {
    const sample = (d: Heights) => {
      const n = 2 ** d.grid.z;
      const u = (mercX(lon) * n - d.grid.x0) / d.grid.nx, v = (mercY(lat) * n - d.grid.y0) / d.grid.ny;
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
      const x = Math.min(d.w - 1.001, Math.max(0, u * d.w - 0.5)), y = Math.min(d.hgt - 1.001, Math.max(0, v * d.hgt - 0.5));
      const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, H = (a: number, b: number) => d.h[b * d.w + a];
      return (H(i, j) * (1 - fx) + H(i + 1, j) * fx) * (1 - fy) + (H(i, j + 1) * (1 - fx) + H(i + 1, j + 1) * fx) * fy;
    };
    return sample(this.area) ?? (this.world ? sample(this.world) : null) ?? 0;
  }

  /** The area's lon/lat bounds [west, north, east, south]. */
  areaBounds(): [number, number, number, number] {
    const [x, y, w, h] = this.areaRect;
    return [lonOfX(x), latOfY(y), lonOfX(x + w), latOfY(y + h)];
  }

  private loc(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    const k = `${p === this.terrain ? 't' : p === this.sky ? 's' : p === this.accum ? 'a' : p === this.histProg ? 'h' : 'p'}${name}`;
    if (!this.u.has(k)) this.u.set(k, this.gl.getUniformLocation(p, name));
    return this.u.get(k)!;
  }

  private accumulate(): void {
    const gl = this.gl, v = this.view, [, , mw, mh] = this.areaRect;
    const areaLat = latOfY(this.areaRect[1] + mh / 2);
    const rM = this.radius * radiusZoomFactor(v.zoom) * metresPerPixel(v.zoom, v.lat);
    const rMerc = rM / (2 * Math.PI * EARTH_R * Math.cos((areaLat * Math.PI) / 180));
    const ru = rMerc / mw, rv = rMerc / mh;
    const k = heatLevel(ru * kernelExtent(1, 1) * HEAT_W);
    const [first, end] = yearRange(this.points, this.year);
    const key = `${ru.toPrecision(5)}|${first}|${end}|${k}`;
    if (key === this.heatKey) return;
    this.heatKey = key;
    this.heatCalls++;
    const w = Math.ceil(HEAT_W / 2 ** k), h = Math.ceil(HEAT_H / 2 ** k);
    this.heatScale = [w / HEAT_W, h / HEAT_H];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (end > first) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.accum);
      gl.uniform2f(this.loc(this.accum, 'u_radius'), ru, rv);
      gl.bindVertexArray(this.pointVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
      gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, true, 0, first * 4);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - first);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
    // Dref: the HEAT_PERCENTILE density of the texels with heat (heat.ts).
    const s = histSampling(w, h, this.histSamples);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hist[1]);
    gl.viewport(0, 0, HIST_BINS, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.histProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heat);
    gl.uniform1i(this.loc(this.histProg, 'u_heat'), 0);
    gl.uniform2i(this.loc(this.histProg, 'u_size'), w, h);
    gl.uniform1i(this.loc(this.histProg, 'u_stride'), s.stride);
    gl.uniform1i(this.loc(this.histProg, 'u_cols'), s.cols);
    gl.drawArrays(gl.POINTS, 0, s.cols * s.rows);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dref[1]);
    gl.viewport(0, 0, 1, 1);
    gl.useProgram(this.pctProg);
    gl.bindTexture(gl.TEXTURE_2D, this.hist[0]);
    gl.uniform1i(this.loc(this.pctProg, 'u_hist'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  draw(): Frame {
    const gl = this.gl, v = this.view;
    v.width = gl.drawingBufferWidth; v.height = gl.drawingBufferHeight;
    v.centerH = this.heightAt(v.lon, v.lat);
    const f = frame(v);
    this.lastFrame = f;
    this.accumulate();
    const atm = atmosphereBlend(v.zoom);
    const horizon = [0.9, 0.94, 0.97];
    gl.viewport(0, 0, v.width, v.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    // Sky, relative to the eye (the eye's own coordinates are fine in float here).
    gl.useProgram(this.sky);
    const S = (n: string) => this.loc(this.sky, n);
    gl.uniform3f(S('u_eye'), f.eye[0], f.eye[1], f.eye[2]);
    gl.uniform3f(S('u_fwd'), f.fwd[0], f.fwd[1], f.fwd[2]);
    gl.uniform3f(S('u_right'), f.right[0], f.right[1], f.right[2]);
    gl.uniform3f(S('u_up'), f.up[0], f.up[1], f.up[2]);
    gl.uniform3f(S('u_horizon'), horizon[0], horizon[1], horizon[2]);
    gl.uniform2f(S('u_size'), v.width, v.height);
    gl.uniform2f(S('u_tan'), Math.tan(FOV / 2) * (v.width / v.height), Math.tan(FOV / 2));
    gl.uniform1f(S('u_atm'), atm);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.terrain);
    const T = (n: string) => this.loc(this.terrain, n);
    gl.uniformMatrix4fv(T('u_m'), false, new Float32Array(f.m));
    gl.uniform3f(T('u_eye'), f.eye[0], f.eye[1], f.eye[2]);
    gl.uniform4f(T('u_area'), ...this.areaRect);
    gl.uniform2f(T('u_heatScale'), ...this.heatScale);
    gl.uniform1f(T('u_heatOn'), this.heatOn);
    gl.uniform1f(T('u_intensity'), this.intensity);
    gl.uniform1f(T('u_atm'), atm);
    // Haze from twice the camera distance to the horizon hides the coarse world beyond the area.
    const alt = Math.hypot(...f.eye) - EARTH_R;
    const toCentre = (0.5 * v.height / Math.tan(FOV / 2)) * metresPerPixel(v.zoom, v.lat);
    gl.uniform2f(T('u_fog'), toCentre * 1.6, Math.max(toCentre * 6, alt * 3));
    gl.uniform1f(T('u_fogAmt'), (1 - atm) * Math.min(1, Math.max(0, (v.pitch - 30) / 30)) * 0.85);
    gl.uniform3f(T('u_horizon'), horizon[0], horizon[1], horizon[2]);
    const tex: [string, WebGLTexture][] = [['u_hArea', this.hArea], ['u_hWorld', this.hWorld], ['u_heat', this.heat], ['u_ramp', this.ramp], ['u_dref', this.dref[0]]];
    tex.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(T(name), i);
    });
    gl.uniform1i(T('u_mode'), 0);
    gl.bindVertexArray(this.areaVao[0]);
    gl.drawElements(gl.TRIANGLES, this.areaVao[1], gl.UNSIGNED_INT, 0);
    if (this.worldVao) {
      gl.uniform1i(T('u_mode'), 1);
      gl.bindVertexArray(this.worldVao[0]);
      gl.drawElements(gl.TRIANGLES, this.worldVao[1], gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    return f;
  }
}
