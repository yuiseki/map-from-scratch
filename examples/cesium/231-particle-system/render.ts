import {
  type ParticleSystemState,
  type Vec3,
  updateParticleSystem,
} from './particle.ts';

function createShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile error: ${err}`);
  }
  return s;
}

function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const p = gl.createProgram()!;
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link error: ${err}`);
  }
  return p;
}

// 4x4 matrix utilities
function mat4Perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number): void {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = (2 * far * near) * nf;
}

function mat4LookAt(out: Float32Array, eye: Vec3, center: Vec3, up: Vec3): void {
  let z0 = eye[0] - center[0];
  let z1 = eye[1] - center[1];
  let z2 = eye[2] - center[2];
  let len = Math.hypot(z0, z1, z2) || 1;
  z0 /= len; z1 /= len; z2 /= len;

  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2) || 1;
  x0 /= len; x1 /= len; x2 /= len;

  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;

  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
}

function mat4Multiply(out: Float32Array, a: Float32Array, b: Float32Array): void {
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
    out[i]      = ai0 * b[0]  + ai1 * b[1]  + ai2 * b[2]  + ai3 * b[3];
    out[i + 4]  = ai0 * b[4]  + ai1 * b[5]  + ai2 * b[6]  + ai3 * b[7];
    out[i + 8]  = ai0 * b[8]  + ai1 * b[9]  + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
}

const PAD_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_uv;
uniform mat4 u_viewProjection;
out vec2 v_uv;
out vec3 v_worldPos;
void main() {
  v_uv = a_uv;
  v_worldPos = a_position;
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
}
`;

const PAD_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_worldPos;
out vec4 fragColor;

void main() {
  float r = length(v_worldPos.xz);
  // Metallic circular ground pad with concentric rings and glowing center core
  vec3 groundColor = vec3(0.06, 0.08, 0.12);
  
  // Concentric circle lines
  float rings = step(0.92, fract(r * 2.0));
  groundColor += vec3(0.12, 0.16, 0.22) * rings * smoothstep(12.0, 0.0, r);

  // Pad rim
  if (r < 4.0) {
    groundColor = mix(vec3(0.14, 0.16, 0.20), vec3(0.22, 0.24, 0.28), smoothstep(3.8, 4.0, r));
  }
  
  // Heat glow at base of rocket / emitter
  float heat = exp(-r * 1.5) * 1.5;
  groundColor += vec3(1.0, 0.5, 0.1) * heat;

  fragColor = vec4(groundColor, 1.0);
}
`;

const PARTICLE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in float a_size;
layout(location = 2) in vec4 a_color;

uniform mat4 u_viewProjection;
uniform float u_viewportHeight;

out vec4 v_color;

void main() {
  v_color = a_color;
  vec4 clipPos = u_viewProjection * vec4(a_position, 1.0);
  gl_Position = clipPos;
  // Size attenuation
  gl_PointSize = clamp(a_size * (u_viewportHeight / max(clipPos.w, 0.1)) * 0.015, 2.0, 48.0);
}
`;

const PARTICLE_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) {
    discard;
  }
  // Soft smooth radial falloff
  float alpha = smoothstep(0.5, 0.0, dist);
  alpha = pow(alpha, 1.4);
  fragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;

export interface Renderer {
  gl: WebGL2RenderingContext;
  render(dt: number): void;
  resize(w: number, h: number): void;
  getCanvas(): HTMLCanvasElement;
  setCameraAngles(yaw: number, pitch: number): void;
  setCameraDistance(dist: number): void;
  readPixel(x: number, y: number): [number, number, number, number];
  destroy(): void;
}

export function createRenderer(canvas: HTMLCanvasElement, sys: ParticleSystemState): Renderer {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 not supported');

  const padProg = createProgram(gl, PAD_VS, PAD_FS);
  const padLocViewProj = gl.getUniformLocation(padProg, 'u_viewProjection');

  const partProg = createProgram(gl, PARTICLE_VS, PARTICLE_FS);
  const partLocViewProj = gl.getUniformLocation(partProg, 'u_viewProjection');
  const partLocVpHeight = gl.getUniformLocation(partProg, 'u_viewportHeight');

  // Ground plane mesh (quad at Y=0)
  const padVao = gl.createVertexArray()!;
  gl.bindVertexArray(padVao);
  const padVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, padVbo);
  const padR = 25.0;
  // 2 triangles covering [-padR, padR] on XZ
  const padVerts = new Float32Array([
    -padR, 0, -padR,  0, 0,
     padR, 0, -padR,  1, 0,
     padR, 0,  padR,  1, 1,
    -padR, 0, -padR,  0, 0,
     padR, 0,  padR,  1, 1,
    -padR, 0,  padR,  0, 1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, padVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 5 * 4, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 5 * 4, 3 * 4);

  // Particle buffer and VAO
  const partVao = gl.createVertexArray()!;
  gl.bindVertexArray(partVao);
  const partVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, partVbo);
  gl.bufferData(gl.ARRAY_BUFFER, sys.buffer.byteLength, gl.DYNAMIC_DRAW);

  // layout: [x, y, z, size, r, g, b, a] = 8 floats = 32 bytes
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);

  gl.bindVertexArray(null);

  // Camera state
  let yaw = 0.6;
  let pitch = 0.35;
  let distance = 20.0;
  let width = canvas.width;
  let height = canvas.height;

  const projMat = new Float32Array(16);
  const viewMat = new Float32Array(16);
  const vpMat = new Float32Array(16);

  const wind: Vec3 = [0.8, 0, 0.4];

  return {
    gl,
    resize(w: number, h: number) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },

    setCameraAngles(y: number, p: number) {
      yaw = y;
      pitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, p));
    },

    setCameraDistance(d: number) {
      distance = Math.max(5.0, Math.min(60.0, d));
    },

    readPixel(x: number, y: number): [number, number, number, number] {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [pixel[0], pixel[1], pixel[2], pixel[3]];
    },

    getCanvas() {
      return canvas;
    },

    render(dt: number) {
      // Step simulation
      updateParticleSystem(sys, dt, wind);

      // Camera view-proj
      mat4Perspective(projMat, Math.PI / 4, width / Math.max(1, height), 0.1, 200.0);
      const eyeY = Math.sin(pitch) * distance + 3.0; // look from slight elevation
      const rH = Math.cos(pitch) * distance;
      const eyeX = Math.sin(yaw) * rH;
      const eyeZ = Math.cos(yaw) * rH;
      const center: Vec3 = [0, 4.0, 0]; // target center of flame column
      mat4LookAt(viewMat, [eyeX, eyeY, eyeZ], center, [0, 1, 0]);
      mat4Multiply(vpMat, projMat, viewMat);

      // Clear
      gl.viewport(0, 0, width, height);
      gl.clearColor(0.04, 0.05, 0.08, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 1. Render ground pad (opaque with depth test)
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);

      gl.useProgram(padProg);
      gl.uniformMatrix4fv(padLocViewProj, false, vpMat);
      gl.bindVertexArray(padVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // 2. Upload particle buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, partVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sys.buffer);

      // 3. Render particles
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.useProgram(partProg);
      gl.uniformMatrix4fv(partLocViewProj, false, vpMat);
      gl.uniform1f(partLocVpHeight, height);
      gl.bindVertexArray(partVao);

      // First pass: Smoke (Alpha blend)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, sys.fireCount, sys.smokeCount);

      // Second pass: Fire & Embers (Additive blend)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, sys.fireCount);
      gl.drawArrays(gl.POINTS, sys.fireCount + sys.smokeCount, sys.emberCount);

      gl.bindVertexArray(null);
    },

    destroy() {
      gl.deleteBuffer(padVbo);
      gl.deleteBuffer(partVbo);
      gl.deleteVertexArray(padVao);
      gl.deleteVertexArray(partVao);
      gl.deleteProgram(padProg);
      gl.deleteProgram(partProg);
    },
  };
}
