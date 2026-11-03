import {
  type GlobeMesh,
  generateGlobeMesh,
} from './materials.ts';

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

const GLOBE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in float a_elevation;

uniform mat4 u_viewProjection;
uniform mat4 u_model;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out float v_elevation;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize((u_model * vec4(a_normal, 0.0)).xyz);
  v_elevation = a_elevation;
  gl_Position = u_viewProjection * worldPos;
}
`;

const GLOBE_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in float v_elevation;

uniform vec3 u_eyePos;
uniform vec3 u_lightDir;
uniform float u_radarSweep;
uniform float u_showElevation;
uniform float u_showContours;
uniform float u_showRadar;

out vec4 fragColor;

const float PI = 3.141592653589793;

vec3 getHypsometricTint(float h) {
  if (h < 0.2) {
    float k = h / 0.2;
    return mix(vec3(0.04, 0.12, 0.45), vec3(0.08, 0.35, 0.65), k);
  } else if (h < 0.35) {
    float k = (h - 0.2) / 0.15;
    return mix(vec3(0.12, 0.55, 0.65), vec3(0.18, 0.68, 0.32), k);
  } else if (h < 0.6) {
    float k = (h - 0.35) / 0.25;
    return mix(vec3(0.20, 0.70, 0.28), vec3(0.72, 0.65, 0.25), k);
  } else if (h < 0.8) {
    float k = (h - 0.6) / 0.2;
    return mix(vec3(0.72, 0.65, 0.25), vec3(0.65, 0.35, 0.18), k);
  } else {
    float k = (h - 0.8) / 0.2;
    return mix(vec3(0.65, 0.35, 0.18), vec3(0.95, 0.96, 1.00), k);
  }
}

void main() {
  vec3 norm = normalize(v_worldNormal);
  vec3 viewDir = normalize(u_eyePos - v_worldPos);
  
  // Diffuse illumination
  float diff = max(0.05, dot(norm, normalize(u_lightDir)));

  // Base globe color
  vec3 color = vec3(0.15, 0.18, 0.24);
  if (u_showElevation > 0.5) {
    color = getHypsometricTint(v_elevation);
  }

  // 1. Topographic Contour Lines
  if (u_showContours > 0.5) {
    float contourBand = fract(v_elevation * 16.0);
    float lineDist = min(contourBand, 1.0 - contourBand);
    float line = smoothstep(0.08, 0.0, lineDist);
    // Golden contour lines with slight glow
    color = mix(color, vec3(1.0, 0.85, 0.3), line * 0.9);
  }

  // 2. Radar sweep & range rings
  if (u_showRadar > 0.5) {
    // Azimuth on globe
    float azimuth = atan(norm.z, norm.x);
    float angleDiff = mod((u_radarSweep - azimuth) + PI * 2.0, PI * 2.0);
    float beamWidth = 1.0;
    if (angleDiff <= beamWidth) {
      float sweepIntensity = pow(1.0 - angleDiff / beamWidth, 2.0);
      vec3 radarColor = vec3(0.1, 1.0, 0.4); // phosphor emerald
      color += radarColor * sweepIntensity * 0.85;
    }

    // Concentric range rings
    float rRings = fract(length(norm.xz) * 5.0);
    float ringLine = smoothstep(0.06, 0.0, min(rRings, 1.0 - rRings));
    color += vec3(0.15, 0.85, 0.4) * ringLine * 0.35;
  }

  // Apply lighting
  color *= (diff * 0.85 + 0.15);

  // 3. Atmospheric Fresnel Rim Glow
  float fresnel = pow(1.0 - max(0.0, dot(norm, viewDir)), 3.5);
  vec3 atmosphere = vec3(0.2, 0.55, 1.0) * fresnel * 0.9;
  color += atmosphere;

  fragColor = vec4(color, 1.0);
}
`;

export interface GlobeMaterialsRenderer {
  gl: WebGL2RenderingContext;
  render(dt: number): void;
  resize(w: number, h: number): void;
  getCanvas(): HTMLCanvasElement;
  setCameraAngles(yaw: number, pitch: number): void;
  setCameraDistance(dist: number): void;
  toggleContours(val: boolean): void;
  toggleElevation(val: boolean): void;
  toggleRadar(val: boolean): void;
  toggleAutoRotate(val: boolean): void;
  readPixel(x: number, y: number): [number, number, number, number];
  destroy(): void;
}

export function createGlobeRenderer(canvas: HTMLCanvasElement): GlobeMaterialsRenderer {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 not supported');

  const prog = createProgram(gl, GLOBE_VS, GLOBE_FS);
  const locViewProj = gl.getUniformLocation(prog, 'u_viewProjection');
  const locModel = gl.getUniformLocation(prog, 'u_model');
  const locEyePos = gl.getUniformLocation(prog, 'u_eyePos');
  const locLightDir = gl.getUniformLocation(prog, 'u_lightDir');
  const locRadarSweep = gl.getUniformLocation(prog, 'u_radarSweep');
  const locShowElevation = gl.getUniformLocation(prog, 'u_showElevation');
  const locShowContours = gl.getUniformLocation(prog, 'u_showContours');
  const locShowRadar = gl.getUniformLocation(prog, 'u_showRadar');

  // Generate 3D globe mesh
  const mesh: GlobeMesh = generateGlobeMesh(48, 96, 60.0);

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const posVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, posVbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, normVbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const elevVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, elevVbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.elevations, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  // State
  let yaw = 0.5;
  let pitch = 0.3;
  let distance = 160.0;
  let autoRotate = true;
  let globeRotation = 0.0;
  let radarSweep = 0.0;

  let showElevation = true;
  let showContours = true;
  let showRadar = true;

  let width = canvas.width;
  let height = canvas.height;

  const projMat = new Float32Array(16);
  const viewMat = new Float32Array(16);
  const vpMat = new Float32Array(16);
  const modelMat = new Float32Array(16);

  function updateModelMatrix(): void {
    const c = Math.cos(globeRotation);
    const s = Math.sin(globeRotation);
    modelMat.fill(0);
    modelMat[0] = c;  modelMat[2] = s;
    modelMat[5] = 1;
    modelMat[8] = -s; modelMat[10] = c;
    modelMat[15] = 1;
  }

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
      pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, p));
    },

    setCameraDistance(d: number) {
      distance = Math.max(70.0, Math.min(400.0, d));
    },

    toggleContours(val: boolean) { showContours = val; },
    toggleElevation(val: boolean) { showElevation = val; },
    toggleRadar(val: boolean) { showRadar = val; },
    toggleAutoRotate(val: boolean) { autoRotate = val; },

    getCanvas() { return canvas; },

    readPixel(x: number, y: number): [number, number, number, number] {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [pixel[0], pixel[1], pixel[2], pixel[3]];
    },

    render(dt: number) {
      if (autoRotate) {
        globeRotation += dt * 0.25;
      }
      radarSweep = (radarSweep + dt * 1.8) % (Math.PI * 2);
      updateModelMatrix();

      // Camera view-projection
      mat4Perspective(projMat, Math.PI / 4, width / Math.max(1, height), 1.0, 1000.0);
      const eyeY = Math.sin(pitch) * distance;
      const rH = Math.cos(pitch) * distance;
      const eyeX = Math.sin(yaw) * rH;
      const eyeZ = Math.cos(yaw) * rH;
      mat4LookAt(viewMat, [eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);
      mat4Multiply(vpMat, projMat, viewMat);

      gl.viewport(0, 0, width, height);
      gl.clearColor(0.02, 0.03, 0.06, 1.0); // deep cosmos
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);

      gl.useProgram(prog);
      gl.uniformMatrix4fv(locViewProj, false, vpMat);
      gl.uniformMatrix4fv(locModel, false, modelMat);
      gl.uniform3f(locEyePos, eyeX, eyeY, eyeZ);
      gl.uniform3f(locLightDir, 0.8, 0.6, 0.5);
      gl.uniform1f(locRadarSweep, radarSweep);
      gl.uniform1f(locShowElevation, showElevation ? 1.0 : 0.0);
      gl.uniform1f(locShowContours, showContours ? 1.0 : 0.0);
      gl.uniform1f(locShowRadar, showRadar ? 1.0 : 0.0);

      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    },

    destroy() {
      gl.deleteBuffer(posVbo);
      gl.deleteBuffer(normVbo);
      gl.deleteBuffer(elevVbo);
      gl.deleteBuffer(ibo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
    },
  };
}
