/** Convert geographic degrees to a unit sphere; longitude zero faces +Z. */
export function lonLatToUnitSphere(longitudeDeg: number, latitudeDeg: number): [number, number, number] {
  if (!Number.isFinite(longitudeDeg) || !Number.isFinite(latitudeDeg)) {
    throw new TypeError('Longitude and latitude must be finite numbers');
  }
  if (latitudeDeg < -90 || latitudeDeg > 90) {
    throw new RangeError('Latitude must be within [-90, 90] degrees');
  }
  const longitude = ((longitudeDeg % 360) + 360) % 360;
  if (latitudeDeg === 90) return [0, 1, 0];
  if (latitudeDeg === -90) return [0, -1, 0];
  const lon = longitude * Math.PI / 180;
  const lat = latitudeDeg * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [Math.sin(lon) * cosLat, Math.sin(lat), Math.cos(lon) * cosLat];
}

export interface SphereGrid {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Equirectangular sphere mesh with duplicated seam vertices and outward winding. */
export function createSphereGrid(latitudeSegments: number, longitudeSegments: number): SphereGrid {
  if (!Number.isInteger(latitudeSegments) || latitudeSegments < 2 || !Number.isInteger(longitudeSegments) || longitudeSegments < 3) {
    throw new RangeError('Sphere grid needs at least 2 latitude and 3 longitude segments');
  }
  const columns = longitudeSegments + 1;
  const positions = new Float32Array((latitudeSegments + 1) * columns * 3);
  const uvs = new Float32Array((latitudeSegments + 1) * columns * 2);
  for (let row = 0; row <= latitudeSegments; row++) {
    const lat = 90 - row * 180 / latitudeSegments;
    for (let column = 0; column <= longitudeSegments; column++) {
      const index = row * columns + column;
      const lon = -180 + column * 360 / longitudeSegments;
      positions.set(lonLatToUnitSphere(lon, lat), index * 3);
      uvs[index * 2] = column / longitudeSegments;
      uvs[index * 2 + 1] = row / latitudeSegments;
    }
  }
  const indices = new Uint32Array(latitudeSegments * longitudeSegments * 6);
  let offset = 0;
  for (let row = 0; row < latitudeSegments; row++) {
    for (let column = 0; column < longitudeSegments; column++) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], offset);
      offset += 6;
    }
  }
  return { positions, uvs, indices };
}

const VERTEX = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec2 aUv;
uniform float uYaw;
uniform float uPitch;
uniform float uDistance;
uniform float uAspect;
uniform float uRadius;
out vec2 vUv;
out vec3 vNormal;
out vec3 vViewPosition;
void main() {
  float cy = cos(uYaw), sy = sin(uYaw);
  float cp = cos(uPitch), sp = sin(uPitch);
  vec3 q = vec3(cy * aPosition.x + sy * aPosition.z, aPosition.y, -sy * aPosition.x + cy * aPosition.z);
  q = vec3(q.x, cp * q.y - sp * q.z, sp * q.y + cp * q.z) * uRadius;
  float depth = uDistance - q.z;
  float f = 1.75;
  gl_Position = vec4(q.x * f / uAspect, q.y * f, (depth - 1.0) / 19.0 * 2.0 - 1.0, depth);
  vUv = aUv;
  vNormal = normalize(q);
  vViewPosition = vec3(0.0, 0.0, uDistance) - q;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vNormal;
in vec3 vViewPosition;
uniform sampler2D uEarth;
uniform int uAtmosphere;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);
  if (uAtmosphere == 1) {
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    if (rim < 0.025) discard;
    outColor = vec4(0.11, 0.48, 1.0, rim * 0.78);
  } else {
    vec3 texel = texture(uEarth, vUv).rgb;
    vec3 lightDir = normalize(vec3(-0.48, 0.28, 0.83));
    float day = max(dot(n, lightDir), 0.0);
    float limb = 0.78 + 0.22 * max(dot(n, viewDir), 0.0);
    vec3 lit = texel * (0.12 + 0.98 * day) * limb;
    float twilight = smoothstep(-0.2, 0.12, dot(n, lightDir));
    vec3 night = texel * vec3(0.12, 0.18, 0.33);
    outColor = vec4(mix(night, lit, twilight), 1.0);
  }
}`;

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const value = gl.createShader(type);
  if (!value) throw new Error('WebGL shader allocation failed');
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value) ?? 'WebGL shader compilation failed');
  return value;
}

function program(gl: WebGL2RenderingContext): WebGLProgram {
  const result = gl.createProgram();
  if (!result) throw new Error('WebGL program allocation failed');
  gl.attachShader(result, shader(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(result, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? 'WebGL program link failed');
  return result;
}

export class EarthRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  private readonly shader: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation>;
  private readonly indexCount: number;
  private readonly texture: WebGLTexture;

  constructor(canvas: HTMLCanvasElement, image: HTMLImageElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.canvas = canvas;
    this.shader = program(gl);
    this.uniforms = Object.fromEntries(['uYaw', 'uPitch', 'uDistance', 'uAspect', 'uRadius', 'uEarth', 'uAtmosphere']
      .map((name) => [name, gl.getUniformLocation(this.shader, name)!]));
    const mesh = createSphereGrid(96, 192);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bind = (name: string, data: Float32Array, size: number) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data as Float32Array<ArrayBuffer>, gl.STATIC_DRAW);
      const location = gl.getAttribLocation(this.shader, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    bind('aPosition', mesh.positions, 3);
    bind('aUv', mesh.uvs, 2);
    const index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices.buffer as ArrayBuffer, gl.STATIC_DRAW);
    this.indexCount = mesh.indices.length;
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(this.shader);
    gl.uniform1i(this.uniforms.uEarth, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.008, 0.018, 0.045, 0);
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
    gl.useProgram(this.shader);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1f(this.uniforms.uYaw, yaw);
    gl.uniform1f(this.uniforms.uPitch, pitch);
    gl.uniform1f(this.uniforms.uDistance, distance);
    gl.uniform1f(this.uniforms.uAspect, this.canvas.width / this.canvas.height);
    gl.uniform1i(this.uniforms.uAtmosphere, 0);
    gl.uniform1f(this.uniforms.uRadius, 1);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.uniform1i(this.uniforms.uAtmosphere, 1);
    gl.uniform1f(this.uniforms.uRadius, 1.065);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  readPixel(x: number, y: number): Uint8Array {
    const pixel = new Uint8Array(4);
    this.gl.readPixels(x, this.canvas.height - y - 1, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return pixel;
  }
}

export function rotateCamera(yaw: number, pitch: number, dx: number, dy: number): [number, number] {
  return [yaw + dx * 0.006, Math.max(-1.15, Math.min(1.15, pitch + dy * 0.004))];
}

export function zoomDistance(distance: number, deltaY: number): number {
  return Math.max(2.55, Math.min(5.5, distance + deltaY * 0.002));
}
