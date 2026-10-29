const VERT = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in uint packed;
uniform vec3 lo;
uniform vec3 span;
uniform float yaw;
uniform float pitch;
uniform float distance;
uniform float aspect;
uniform float pointSize;
uniform vec3 center;
void main(){
  vec3 p = lo + vec3(float(packed & 1023u), float((packed >> 10u) & 1023u), float((packed >> 20u) & 1023u)) * span / 1023.0 - center;
  vec3 right = vec3(cos(yaw), 0.0, -sin(yaw));
  vec3 up = vec3(-sin(pitch)*sin(yaw), cos(pitch), -sin(pitch)*cos(yaw));
  vec3 towardCamera = vec3(cos(pitch)*sin(yaw), sin(pitch), cos(pitch)*cos(yaw));
  float depth = max(0.05, distance - dot(p, towardCamera));
  float focal = 1.0 / tan(radians(50.0) * 0.5);
  gl_Position = vec4(dot(p,right)*focal/aspect, dot(p,up)*focal, depth*1.001-0.2001, depth);
  gl_PointSize = pointSize;
}`;
const FRAG = `#version 300 es
precision mediump float;
out vec4 color;
void main(){ color = vec4(0.90, 0.96, 1.0, 0.64); }`;
function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const item = gl.createShader(type)!;
  gl.shaderSource(item, source); gl.compileShader(item);
  if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item) || 'shader compile failed');
  return item;
}
export class PointCloud {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly count: number;
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  yaw = -0.65;
  pitch = 0.32;
  distance = 32;
  pointSize = 1.65;
  center = [0, 0, 0];
  autoRotate = true;
  private readonly lo: number[];
  private readonly span: number[];
  private readonly locations: Record<string, WebGLUniformLocation | null>;
  constructor(canvas: HTMLCanvasElement, data: ArrayBuffer) {
    this.canvas = canvas;
    const view = new DataView(data);
    if (String.fromCharCode(...new Uint8Array(data, 0, 4)) !== 'PC01') throw new Error('invalid point-cloud header');
    this.count = view.getUint32(4, true);
    if (data.byteLength !== 32 + this.count * 4) throw new Error('invalid point-cloud length');
    const mins = [0, 1, 2].map((i) => view.getFloat32(8 + i * 4, true));
    const maxs = [0, 1, 2].map((i) => view.getFloat32(20 + i * 4, true));
    this.lo = mins.map((v, i) => v - (v + maxs[i]) / 2);
    this.span = maxs.map((v, i) => v - mins[i]);
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
    this.program = program;
    this.locations = Object.fromEntries(['lo', 'span', 'center', 'yaw', 'pitch', 'distance', 'aspect', 'pointSize'].map((name) => [name, gl.getUniformLocation(program, name)]));
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(data, 32), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 4, 0);
    this.vao = vao;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.resize();
  }
  resize(): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.draw();
  }
  pan(dx: number, dy: number): void {
    const step = 2 * this.distance * Math.tan(25 * Math.PI / 180) / this.canvas.clientHeight;
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const up = [-Math.sin(this.pitch) * Math.sin(this.yaw), Math.cos(this.pitch), -Math.sin(this.pitch) * Math.cos(this.yaw)];
    for (let i = 0; i < 3; i++) this.center[i] += (-dx * right[i] + dy * up[i]) * step;
    this.draw();
  }
  draw(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.035, 0.063, 0.10, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform3fv(this.locations.lo, this.lo);
    gl.uniform3fv(this.locations.span, this.span);
    gl.uniform3fv(this.locations.center, this.center);
    gl.uniform1f(this.locations.yaw, this.yaw);
    gl.uniform1f(this.locations.pitch, this.pitch);
    gl.uniform1f(this.locations.distance, this.distance);
    gl.uniform1f(this.locations.aspect, this.canvas.width / this.canvas.height);
    gl.uniform1f(this.locations.pointSize, this.pointSize);
    gl.drawArrays(gl.POINTS, 0, this.count);
  }
}
