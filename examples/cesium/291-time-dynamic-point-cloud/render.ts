import {
  type PointGrid,
  generatePointGrid,
} from './wave.ts';

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

function mat4LookAt(out: Float32Array, eye: [number, number, number], center: [number, number, number], up: [number, number, number]): void {
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

const POINT_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_uv;

uniform mat4 u_viewProjection;
uniform float u_time;
uniform float u_pointSize;
uniform float u_viewportHeight;

out float v_normElev;

void main() {
  float x = a_position.x;
  float z = a_position.z;
  
  // Harmonic multi-frequency waves
  float w1 = sin(x * 0.08 + u_time * 1.5) * cos(z * 0.08 + u_time * 1.2) * 10.0;
  float w2 = sin((x + z) * 0.14 + u_time * 2.2) * 5.0;
  float w3 = cos((x - z) * 0.22 - u_time * 3.1) * 2.5;
  float y = w1 + w2 + w3;

  v_normElev = clamp(y / 17.5, -1.0, 1.0);

  vec4 clipPos = u_viewProjection * vec4(x, y, z, 1.0);
  gl_Position = clipPos;
  gl_PointSize = clamp(u_pointSize * (u_viewportHeight / max(clipPos.w, 0.1)) * 0.035, 2.0, 36.0);
}
`;

const POINT_FS = `#version 300 es
precision highp float;
in float v_normElev;
out vec4 fragColor;

vec3 getWaveColor(float normElev) {
  float u = (normElev + 1.0) * 0.5;
  if (u < 0.25) {
    float k = u / 0.25;
    return mix(vec3(0.1, 0.1, 0.5), vec3(0.15, 0.35, 0.95), k);
  } else if (u < 0.5) {
    float k = (u - 0.25) / 0.25;
    return mix(vec3(0.15, 0.35, 0.95), vec3(0.10, 0.90, 0.80), k);
  } else if (u < 0.75) {
    float k = (u - 0.5) / 0.25;
    return mix(vec3(0.10, 0.90, 0.80), vec3(0.90, 0.95, 0.05), k);
  } else {
    float k = (u - 0.75) / 0.25;
    return mix(vec3(0.90, 0.95, 0.05), vec3(1.0, 1.0, 1.0), k);
  }
}

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;

  float alpha = smoothstep(0.5, 0.1, dist);
  vec3 col = getWaveColor(v_normElev);
  fragColor = vec4(col, alpha);
}
`;

const GRID_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
uniform mat4 u_viewProjection;
void main() {
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
}
`;

const GRID_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.12, 0.18, 0.28, 0.6);
}
`;

export interface PointCloudRenderer {
  gl: WebGL2RenderingContext;
  render(dt: number): void;
  resize(w: number, h: number): void;
  getCanvas(): HTMLCanvasElement;
  setCameraAngles(yaw: number, pitch: number): void;
  setCameraDistance(dist: number): void;
  setPointSize(sz: number): void;
  setSpeed(sp: number): void;
  togglePlay(play: boolean): void;
  readPixel(x: number, y: number): [number, number, number, number];
  destroy(): void;
}

export function createPointCloudRenderer(canvas: HTMLCanvasElement): PointCloudRenderer {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 not supported');

  const pointProg = createProgram(gl, POINT_VS, POINT_FS);
  const locPointVP = gl.getUniformLocation(pointProg, 'u_viewProjection');
  const locPointTime = gl.getUniformLocation(pointProg, 'u_time');
  const locPointSize = gl.getUniformLocation(pointProg, 'u_pointSize');
  const locPointVpHeight = gl.getUniformLocation(pointProg, 'u_viewportHeight');

  const gridProg = createProgram(gl, GRID_VS, GRID_FS);
  const locGridVP = gl.getUniformLocation(gridProg, 'u_viewProjection');

  // Generate 80x80 = 6,400 points
  const gridMesh: PointGrid = generatePointGrid(80, 80, 120.0, 120.0);

  const pointVao = gl.createVertexArray()!;
  gl.bindVertexArray(pointVao);

  const posVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, posVbo);
  gl.bufferData(gl.ARRAY_BUFFER, gridMesh.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const uvVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, uvVbo);
  gl.bufferData(gl.ARRAY_BUFFER, gridMesh.uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);

  // Wireframe base grid at y=-20
  const gridLines: number[] = [];
  const gSize = 60.0;
  const gSteps = 12;
  const gY = -20.0;
  for (let i = 0; i <= gSteps; i++) {
    const c = -gSize + (i / gSteps) * (gSize * 2);
    // Line along Z
    gridLines.push(c, gY, -gSize, c, gY, gSize);
    // Line along X
    gridLines.push(-gSize, gY, c, gSize, gY, c);
  }

  const gridVao = gl.createVertexArray()!;
  gl.bindVertexArray(gridVao);
  const gridVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, gridVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridLines), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // State
  let yaw = 0.6;
  let pitch = 0.45;
  let distance = 160.0;
  let pointSize = 14.0;
  let speed = 1.0;
  let isPlaying = true;
  let simTime = 0.0;

  let width = canvas.width;
  let height = canvas.height;

  const projMat = new Float32Array(16);
  const viewMat = new Float32Array(16);
  const vpMat = new Float32Array(16);

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
      pitch = Math.max(0.1, Math.min(Math.PI * 0.48, p));
    },

    setCameraDistance(d: number) {
      distance = Math.max(50.0, Math.min(400.0, d));
    },

    setPointSize(sz: number) {
      pointSize = Math.max(4.0, Math.min(40.0, sz));
    },

    setSpeed(sp: number) {
      speed = Math.max(0.0, Math.min(5.0, sp));
    },

    togglePlay(play: boolean) {
      isPlaying = play;
    },

    getCanvas() {
      return canvas;
    },

    readPixel(x: number, y: number): [number, number, number, number] {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [pixel[0], pixel[1], pixel[2], pixel[3]];
    },

    render(dt: number) {
      if (isPlaying) {
        simTime += dt * speed;
      }

      mat4Perspective(projMat, Math.PI / 4, width / Math.max(1, height), 1.0, 1000.0);
      const eyeY = Math.sin(pitch) * distance;
      const rH = Math.cos(pitch) * distance;
      const eyeX = Math.sin(yaw) * rH;
      const eyeZ = Math.cos(yaw) * rH;
      mat4LookAt(viewMat, [eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);
      mat4Multiply(vpMat, projMat, viewMat);

      gl.viewport(0, 0, width, height);
      gl.clearColor(0.03, 0.04, 0.07, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 1. Draw base reference grid
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(gridProg);
      gl.uniformMatrix4fv(locGridVP, false, vpMat);
      gl.bindVertexArray(gridVao);
      gl.drawArrays(gl.LINES, 0, gridLines.length / 3);

      // 2. Draw 4D Time-Dynamic Point Cloud (Additive glowing points)
      gl.depthMask(false);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      gl.useProgram(pointProg);
      gl.uniformMatrix4fv(locPointVP, false, vpMat);
      gl.uniform1f(locPointTime, simTime);
      gl.uniform1f(locPointSize, pointSize);
      gl.uniform1f(locPointVpHeight, height);

      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, gridMesh.pointCount);

      gl.bindVertexArray(null);
    },

    destroy() {
      gl.deleteBuffer(posVbo);
      gl.deleteBuffer(uvVbo);
      gl.deleteVertexArray(pointVao);

      gl.deleteBuffer(gridVbo);
      gl.deleteVertexArray(gridVao);

      gl.deleteProgram(pointProg);
      gl.deleteProgram(gridProg);
    },
  };
}
