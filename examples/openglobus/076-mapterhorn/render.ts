import type { TerrainMesh } from './terrain.ts';

const VERTEX = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aColor;
uniform float uYaw;
uniform float uPitch;
uniform float uDistance;
uniform float uAspect;
out vec3 vColor;
out vec3 vPosition;
void main() {
  float cy = cos(uYaw), sy = sin(uYaw);
  float cp = cos(uPitch), sp = sin(uPitch);
  vec3 p = vec3(cy * aPosition.x - sy * aPosition.y, sy * aPosition.x + cy * aPosition.y, aPosition.z);
  p = vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);
  float depth = uDistance - p.z;
  float f = 1.58;
  gl_Position = vec4(p.x * f / uAspect, p.y * f, ((depth - 1.0) / 19.0 * 2.0 - 1.0) * depth, depth);
  vColor = aColor;
  vPosition = p;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vPosition;
out vec4 outColor;
void main() {
  vec3 dx = dFdx(vPosition);
  vec3 dy = dFdy(vPosition);
  vec3 normal = normalize(cross(dx, dy));
  if (normal.z < 0.0) normal = -normal;
  vec3 light = normalize(vec3(-0.45, -0.35, 0.82));
  float shade = 0.32 + 0.78 * max(dot(normal, light), 0.0);
  vec3 ridge = vColor * shade;
  float haze = smoothstep(3.8, 8.0, length(vPosition));
  outColor = vec4(mix(ridge, vec3(0.43, 0.59, 0.72), haze * 0.32), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const result = gl.createShader(kind);
  if (!result) throw new Error('shader allocation failed');
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? 'shader compilation failed');
  return result;
}

export class TerrainRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation>;
  private readonly count: number;

  constructor(canvas: HTMLCanvasElement, mesh: TerrainMesh) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.canvas = canvas;
    const program = gl.createProgram();
    if (!program) throw new Error('program allocation failed');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
    this.program = program;
    this.uniforms = Object.fromEntries(['uYaw', 'uPitch', 'uDistance', 'uAspect'].map((name) => [name, gl.getUniformLocation(program, name)!]));
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attribute = (name: string, values: Float32Array) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, values as Float32Array<ArrayBuffer>, gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    };
    attribute('aPosition', mesh.positions);
    attribute('aColor', mesh.colors);
    const indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices as Uint32Array<ArrayBuffer>, gl.STATIC_DRAW);
    this.count = mesh.indices.length;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.035, 0.065, 0.11, 1);
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(yaw: number, pitch: number, distance: number): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uYaw, yaw);
    gl.uniform1f(this.uniforms.uPitch, pitch);
    gl.uniform1f(this.uniforms.uDistance, distance);
    gl.uniform1f(this.uniforms.uAspect, this.canvas.width / this.canvas.height);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  }

  readPixel(x: number, y: number): Uint8Array {
    const pixel = new Uint8Array(4);
    this.gl.readPixels(x, this.canvas.height - y - 1, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return pixel;
  }
}
