import { pixelAtCoordinate, type GeographicBounds } from "./raster.ts";
import type { LoadedEtopoWindow } from "./source.ts";

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_position;
void main() { v_position = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_elevation;
uniform vec2 u_resolution;
uniform vec4 u_rect;
uniform vec4 u_coverage;
out vec4 outColor;
vec3 ramp(float x) {
  if (x < 0.0) {
    float t = clamp((-x) / 9000.0, 0.0, 1.0);
    return mix(vec3(0.39, 0.68, 0.73), vec3(0.035, 0.12, 0.24), t);
  }
  float t = clamp(x / 4000.0, 0.0, 1.0);
  return mix(vec3(0.88, 0.86, 0.69), vec3(0.78, 0.39, 0.20), t);
}
void main() {
  vec2 pixel = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 uv = (pixel - u_rect.xy) / u_rect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) { outColor = vec4(0.0); return; }
  vec2 geo = vec2(mix(u_coverage.x, u_coverage.z, uv.x), mix(u_coverage.w, u_coverage.y, uv.y));
  if (geo.x < u_coverage.x || geo.x > u_coverage.z || geo.y < u_coverage.y || geo.y > u_coverage.w) { outColor = vec4(0.0); return; }
  float elevation = texture(u_elevation, uv).r;
  if (isnan(elevation) || isinf(elevation) || elevation < -90000.0) { outColor = vec4(0.0); return; }
  vec3 color = ramp(elevation);
  if (abs(elevation) < 0.5) color = vec3(0.94, 0.91, 0.76);
  outColor = vec4(color, 1.0);
}
`;

export function rasterCoordinateAtUv(bounds: GeographicBounds, width: number, height: number, u: number, v: number): { lon: number; lat: number } {
  if (width <= 0 || height <= 0 || !Number.isFinite(u) || !Number.isFinite(v)) throw new RangeError("Invalid raster coordinate");
  const [west, south, east, north] = bounds;
  return { lon: west + (Math.max(0, Math.min(1, u)) * (width - 1) + 0.5) / width * (east - west), lat: north - (Math.max(0, Math.min(1, v)) * (height - 1) + 0.5) / height * (north - south) };
}

export function visiblePixelWindow(coverage: GeographicBounds, width: number, height: number, visible: GeographicBounds): { x: number; y: number; width: number; height: number } | null {
  const [west, south, east, north] = coverage;
  const [vw, vs, ve, vn] = visible;
  const x0 = Math.max(west, vw), x1 = Math.min(east, ve), y0 = Math.max(south, vs), y1 = Math.min(north, vn);
  if (x0 >= x1 || y0 >= y1) return null;
  const left = Math.floor((x0 - west) / (east - west) * width);
  const right = Math.ceil((x1 - west) / (east - west) * width);
  const top = Math.floor((north - y1) / (north - south) * height);
  const bottom = Math.ceil((north - y0) / (north - south) * height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function viewContainsBaseCoverage(view: readonly [number, number, number, number], base: readonly [number, number, number, number], epsilon = 1): boolean {
  const [left, top, width, height] = view;
  const [baseLeft, baseTop, baseWidth, baseHeight] = base;
  return left <= baseLeft + epsilon && top <= baseTop + epsilon && left + width >= baseLeft + baseWidth - epsilon && top + height >= baseTop + baseHeight - epsilon;
}

export interface RasterRenderer {
  readonly data: LoadedEtopoWindow;
  readonly firstFrameMs: number;
  readonly gpuTimerAvailable: boolean;
  readonly gpuRenderer: string;
  draw(): number;
  resize(): void;
  zoomBy(factor: number): void;
  resetView(): void;
  scaleKilometers(): number;
  inspectAt(lon: number, lat: number): number | null;
}

export class EtopoRenderer implements RasterRenderer {
  readonly data: LoadedEtopoWindow;
  readonly firstFrameMs: number;
  readonly gpuTimerAvailable: boolean;
  readonly gpuRenderer: string;
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly buffer: WebGLBuffer;
  private readonly onInspect: (sample: { lon: number; lat: number; elevation: number } | null) => void;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private drag: { x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
  private readonly locations: { position: number; elevation: WebGLUniformLocation; resolution: WebGLUniformLocation; rect: WebGLUniformLocation; coverage: WebGLUniformLocation };
  private readonly timerExtension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;

  constructor(canvas: HTMLCanvasElement, data: LoadedEtopoWindow, started: number, onInspect: (sample: { lon: number; lat: number; elevation: number } | null) => void) {
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("This example requires WebGL2; no renderer fallback is available");
    this.canvas = canvas; this.gl = gl; this.data = data; this.onInspect = onInspect;
    this.timerExtension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    this.gpuTimerAvailable = this.timerExtension !== null;
    const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
    this.gpuRenderer = rendererInfo ? String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    this.program = this.createProgram();
    this.buffer = gl.createBuffer() ?? (() => { throw new Error("WebGL buffer allocation failed"); })();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    this.locations = {
      position: gl.getAttribLocation(this.program, "a_position"),
      elevation: this.requiredUniform("u_elevation"), resolution: this.requiredUniform("u_resolution"),
      rect: this.requiredUniform("u_rect"), coverage: this.requiredUniform("u_coverage"),
    };
    this.texture = gl.createTexture() ?? (() => { throw new Error("WebGL texture allocation failed"); })();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, data.window.width, data.window.height, 0, gl.RED, gl.FLOAT, data.values);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.resize(); this.bindInput(); this.draw();
    this.firstFrameMs = performance.now() - started;
  }

  static async mount(canvas: HTMLCanvasElement, started: number, onInspect: (sample: { lon: number; lat: number; elevation: number } | null) => void): Promise<EtopoRenderer> {
    const { loadEtopoWindow } = await import("./source.ts");
    const data = await loadEtopoWindow();
    return new EtopoRenderer(canvas, data, started, onInspect);
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error("WebGL shader allocation failed");
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`WebGL shader compile failed: ${message}`); }
      return shader;
    };
    const program = gl.createProgram();
    if (!program) throw new Error("WebGL program allocation failed");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`WebGL program link failed: ${gl.getProgramInfoLog(program)}`);
    return program;
  }
  private requiredUniform(name: string): WebGLUniformLocation { const value = this.gl.getUniformLocation(this.program, name); if (!value) throw new Error(`Missing WebGL uniform ${name}`); return value; }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1); this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr); this.draw();
  }
  private baseRect(): [number, number, number, number] {
    const mapAspect = (this.data.bounds[2] - this.data.bounds[0]) * Math.cos(((this.data.bounds[1] + this.data.bounds[3]) / 2) * Math.PI / 180) / (this.data.bounds[3] - this.data.bounds[1]);
    const h = Math.min(this.height * .86, this.width / Math.max(.01, mapAspect) * .78);
    const w = h * mapAspect;
    return [this.width * .65 - w / 2, this.height * .52 - h / 2, w, h];
  }
  private mapRect(): [number, number, number, number] {
    const [x,y,w,h] = this.baseRect(), sw = w * this.zoom, sh = h * this.zoom;
    return [x + (w-sw)/2 + this.panX, y + (h-sh)/2 + this.panY, sw, sh];
  }
  draw(): number {
    const start = performance.now(), gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(.035,.095,.14,1); gl.clear(gl.COLOR_BUFFER_BIT);
    const rect = this.mapRect(); gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.locations.position); gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.uniform1i(this.locations.elevation, 0);
    gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
    gl.uniform4f(this.locations.rect, rect[0]*this.dpr, rect[1]*this.dpr, rect[2]*this.dpr, rect[3]*this.dpr);
    gl.uniform4f(this.locations.coverage, this.data.bounds[0], this.data.bounds[1], this.data.bounds[2], this.data.bounds[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return performance.now() - start;
  }
  async measureGpuDrawMs(): Promise<number | null> {
    const ext = this.timerExtension;
    if (!ext) return null;
    const query = this.gl.createQuery();
    if (!query) return null;
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.draw();
    this.gl.endQuery(ext.TIME_ELAPSED_EXT);
    const deadline = performance.now() + 3000;
    while (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) {
      if (performance.now() >= deadline) { this.gl.deleteQuery(query); return null; }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const disjoint = this.gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    const nanoseconds = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number;
    this.gl.deleteQuery(query);
    return disjoint || !Number.isFinite(nanoseconds) ? null : nanoseconds / 1_000_000;
  }
  scaleKilometers(): number {
    const [, , w] = this.mapRect();
    const groundWidth = (this.data.bounds[2]-this.data.bounds[0]) * 111.32 * Math.cos(((this.data.bounds[1]+this.data.bounds[3])/2)*Math.PI/180) / this.zoom;
    const target = groundWidth * Math.min(.2, this.width * .2 / w);
    const unit = 10 ** Math.floor(Math.log10(Math.max(.01,target)));
    const value = target / unit;
    return (value >= 5 ? 5 : value >= 2 ? 2 : 1) * unit;
  }
  inspectAt(lon: number, lat: number): number | null {
    const { metadata, window, values } = this.data;
    const point = pixelAtCoordinate(metadata.transform, metadata.width, metadata.height, lon, lat);
    if (!point || point.x < window.x || point.y < window.y || point.x >= window.x+window.width || point.y >= window.y+window.height) return null;
    const elevation = values[(point.y-window.y)*window.width + point.x-window.x]!;
    if (!Number.isFinite(elevation) || elevation === metadata.nodata) { this.onInspect(null); return null; }
    this.onInspect({ lon, lat, elevation }); return elevation;
  }
  readRenderedColor(lon: number, lat: number): [number, number, number, number] | null {
    const [left, top, width, height] = this.mapRect();
    const u = (lon - this.data.bounds[0]) / (this.data.bounds[2] - this.data.bounds[0]);
    const v = (this.data.bounds[3] - lat) / (this.data.bounds[3] - this.data.bounds[1]);
    const x = Math.floor((left + u * width) * this.dpr);
    const y = this.canvas.height - 1 - Math.floor((top + v * height) * this.dpr);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return null;
    const pixel = new Uint8Array(4);
    this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
  }
  resetView(): void { this.zoom=1; this.panX=0; this.panY=0; this.draw(); }
  zoomBy(factor: number): void { this.zoom=Math.max(1, Math.min(16, this.zoom*factor)); this.clampPan(); this.draw(); }
  get cameraState(): Readonly<{ zoom: number; panX: number; panY: number }> { return { zoom: this.zoom, panX: this.panX, panY: this.panY }; }
  isWithinCoverageView(): boolean {
    return viewContainsBaseCoverage(this.mapRect(), this.baseRect());
  }
  private clampPan(): void {
    const [,, baseWidth, baseHeight] = this.baseRect();
    const excessX = (this.zoom - 1) * baseWidth / 2, excessY = (this.zoom - 1) * baseHeight / 2;
    this.panX = Math.max(-excessX, Math.min(excessX, this.panX));
    this.panY = Math.max(-excessY, Math.min(excessY, this.panY));
  }
  private uvAt(x: number, y: number): { lon: number; lat: number } | null {
    const [left,top,width,height] = this.mapRect(), u=(x-left)/width, v=(y-top)/height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    return rasterCoordinateAtUv(this.data.bounds, this.data.window.width, this.data.window.height, u, v);
  }
  private bindInput(): void {
    this.canvas.addEventListener("pointerdown", e => { this.drag={x:e.clientX,y:e.clientY,panX:this.panX,panY:this.panY,moved:false}; if(e.isTrusted)this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener("pointermove", e => { if(!this.drag)return; const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y; if(Math.abs(dx)+Math.abs(dy)>3)this.drag.moved=true; this.panX=this.drag.panX+dx; this.panY=this.drag.panY+dy; this.clampPan(); this.draw(); });
    this.canvas.addEventListener("pointerup", e => { if(!this.drag)return; const moved=this.drag.moved; this.drag=null; if(!moved){const rect=this.canvas.getBoundingClientRect(), point=this.uvAt(e.clientX-rect.left,e.clientY-rect.top); if(point)this.inspectAt(point.lon,point.lat);} });
    this.canvas.addEventListener("pointercancel",()=>{this.drag=null;});
    this.canvas.addEventListener("wheel",e=>{e.preventDefault();this.zoomBy(Math.exp(-Math.max(-180,Math.min(180,e.deltaY))*.0015));},{passive:false});
  }
}

export async function mount(canvas: HTMLCanvasElement, started: number, onInspect: (sample: { lon: number; lat: number; elevation: number } | null) => void): Promise<EtopoRenderer> {
  return EtopoRenderer.mount(canvas, started, onInspect);
}
