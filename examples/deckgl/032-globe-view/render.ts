import type { SphereMesh, ArcGeometry } from './globe.ts';

function mat4Identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

function mat4Multiply(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}

function mat4Perspective(fovyRad: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

// Globe Shaders
const GLOBE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_mvp;
uniform vec3 u_lightDir;
uniform vec3 u_cameraPos;

out vec3 v_normal;
out vec2 v_uv;
out vec3 v_viewDir;

void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_normal = normalize(a_normal);
  v_uv = a_uv;
  v_viewDir = normalize(u_cameraPos - a_position);
}
`;

const GLOBE_FS = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_uv;
in vec3 v_viewDir;

uniform vec3 u_lightDir;

out vec4 fragColor;

// Procedural harmonic continental noise
float noise(vec2 p) {
  return sin(p.x * 6.28) * cos(p.y * 3.14) +
         0.5 * sin(p.x * 12.56 + 1.2) * cos(p.y * 6.28 + 0.8) +
         0.25 * sin(p.x * 25.12) * cos(p.y * 12.56);
}

void main() {
  vec3 norm = normalize(v_normal);
  vec3 view = normalize(v_viewDir);

  // Sunlight diffuse
  float diff = max(dot(norm, u_lightDir), 0.0);
  float ambient = 0.22;
  float light = clamp(ambient + diff * 0.78, 0.0, 1.0);

  // Procedural Earth surface from UV
  float n = noise(v_uv * vec2(2.0, 1.0));
  
  // Ocean vs Land
  vec3 ocean = vec3(0.08, 0.20, 0.38);
  vec3 land = vec3(0.24, 0.42, 0.22);
  vec3 desert = vec3(0.62, 0.54, 0.36);
  vec3 ice = vec3(0.92, 0.95, 0.98);

  vec3 surface;
  if (abs(v_uv.y - 0.5) > 0.42) {
    // Polar ice caps
    surface = ice;
  } else if (n > 0.15) {
    // Continents
    surface = mix(land, desert, clamp((n - 0.15) * 1.5, 0.0, 1.0));
  } else {
    // Ocean
    surface = ocean;
  }

  // Atmospheric limb glow / Fresnel scattering
  float rim = 1.0 - max(dot(view, norm), 0.0);
  float atmo = pow(rim, 3.2);
  vec3 atmoColor = vec3(0.25, 0.65, 1.0);

  vec3 col = surface * light + atmoColor * atmo * 0.85;
  fragColor = vec4(col, 1.0);
}
`;

// 3D Arc Shaders
const ARC_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_color;

uniform mat4 u_mvp;
out vec3 v_color;

void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_color = a_color;
}
`;

const ARC_FS = `#version 300 es
precision highp float;

in vec3 v_color;
out vec4 fragColor;

void main() {
  fragColor = vec4(v_color * 1.25, 1.0); // Vibrant neon glow
}
`;

export class GlobeRenderer {
  gl: WebGL2RenderingContext;
  globeProg: WebGLProgram;
  arcProg: WebGLProgram;

  uGlobeMvp: WebGLUniformLocation;
  uGlobeLightDir: WebGLUniformLocation;
  uGlobeCameraPos: WebGLUniformLocation;

  uArcMvp: WebGLUniformLocation;

  globeVao: WebGLVertexArrayObject;
  globeIndexCount: number;

  arcVao: WebGLVertexArrayObject;
  arcCount: number;

  constructor(canvas: HTMLCanvasElement, sphere: SphereMesh, arcs: ArcGeometry) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    // 1. Globe Program
    const gvs = this.createShader(gl.VERTEX_SHADER, GLOBE_VS);
    const gfs = this.createShader(gl.FRAGMENT_SHADER, GLOBE_FS);
    this.globeProg = this.createProgram(gvs, gfs);

    this.uGlobeMvp = gl.getUniformLocation(this.globeProg, 'u_mvp')!;
    this.uGlobeLightDir = gl.getUniformLocation(this.globeProg, 'u_lightDir')!;
    this.uGlobeCameraPos = gl.getUniformLocation(this.globeProg, 'u_cameraPos')!;

    // Globe VAO
    this.globeVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.globeVao);

    const gpBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, gpBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const gnBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, gnBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const guBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, guBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

    const giBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, giBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);

    this.globeIndexCount = sphere.indices.length;

    // 2. Arc Program
    const avs = this.createShader(gl.VERTEX_SHADER, ARC_VS);
    const afs = this.createShader(gl.FRAGMENT_SHADER, ARC_FS);
    this.arcProg = this.createProgram(avs, afs);

    this.uArcMvp = gl.getUniformLocation(this.arcProg, 'u_mvp')!;

    // Arc VAO
    this.arcVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.arcVao);

    const apBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, apBuf);
    gl.bufferData(gl.ARRAY_BUFFER, arcs.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const acBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, acBuf);
    gl.bufferData(gl.ARRAY_BUFFER, arcs.colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    this.arcCount = arcs.count;

    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.lineWidth(2.5);
  }

  createShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Shader error');
    return s;
  }

  createProgram(vs: WebGLShader, fs: WebGLShader): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Link error');
    return p;
  }

  render(yawDeg: number, pitchDeg: number, distance: number): void {
    const gl = this.gl;
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    gl.viewport(0, 0, w, h);

    // Deep space black
    gl.clearColor(0.015, 0.02, 0.04, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = w / h;
    const proj = mat4Perspective((45 * Math.PI) / 180, aspect, 0.1, 100);

    const yawRad = (yawDeg * Math.PI) / 180;
    const pitchRad = (pitchDeg * Math.PI) / 180;

    const eyeX = distance * Math.cos(pitchRad) * Math.sin(yawRad);
    const eyeY = -distance * Math.cos(pitchRad) * Math.cos(yawRad);
    const eyeZ = distance * Math.sin(pitchRad);

    const eye = [eyeX, eyeY, eyeZ];
    const target = [0, 0, 0];
    const up = [0, 0, 1];

    const view = this.lookAt(eye, target, up);
    const mvp = mat4Identity();
    mat4Multiply(mvp, proj, view);

    // 1. Draw Globe
    gl.useProgram(this.globeProg);
    gl.uniformMatrix4fv(this.uGlobeMvp, false, mvp);
    gl.uniform3f(this.uGlobeCameraPos, eyeX, eyeY, eyeZ);

    const lx = 0.8;
    const ly = -0.5;
    const lz = 0.4;
    const llen = Math.hypot(lx, ly, lz);
    gl.uniform3f(this.uGlobeLightDir, lx / llen, ly / llen, lz / llen);

    gl.bindVertexArray(this.globeVao);
    gl.drawElements(gl.TRIANGLES, this.globeIndexCount, gl.UNSIGNED_INT, 0);

    // 2. Draw 3D Flight Arcs
    gl.useProgram(this.arcProg);
    gl.uniformMatrix4fv(this.uArcMvp, false, mvp);

    gl.bindVertexArray(this.arcVao);
    gl.drawArrays(gl.LINES, 0, this.arcCount);

    gl.bindVertexArray(null);
  }

  lookAt(eye: number[], center: number[], up: number[]): Float32Array {
    let z0 = eye[0] - center[0];
    let z1 = eye[1] - center[1];
    let z2 = eye[2] - center[2];
    let len = 1 / Math.hypot(z0, z1, z2);
    z0 *= len; z1 *= len; z2 *= len;

    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    len = 1 / Math.hypot(x0, x1, x2);
    x0 *= len; x1 *= len; x2 *= len;

    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;

    const out = mat4Identity();
    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    out[15] = 1;
    return out;
  }

  readPixel(x: number, y: number): Uint8Array {
    const gl = this.gl;
    const pixels = new Uint8Array(4);
    gl.readPixels(x, gl.canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }
}
