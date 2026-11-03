import {
  generateSphereMesh,
  computeSunDirection,
  type SphereMesh,
} from './atmosphere.ts';

const GLOBE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;

void main() {
  vec4 wp = u_model * vec4(a_position, 1.0);
  v_worldPos = wp.xyz;
  v_normal = normalize(mat3(u_model) * a_normal);
  v_uv = a_uv;
  gl_Position = u_proj * u_view * wp;
}
`;

const GLOBE_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;

uniform vec3 u_sunDir;
uniform vec3 u_camPos;
uniform float u_atmosphereDensity;

out vec4 fragColor;

// Procedural pseudo-noise for continents
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(u_sunDir);
  vec3 V = normalize(u_camPos - v_worldPos);

  // Surface geography
  vec2 p = v_uv * vec2(14.0, 7.0);
  float landShape = fbm(p);
  bool isLand = landShape > 0.46;
  bool isIceCap = abs(N.y) > 0.82;

  vec3 surfaceColor;
  float roughness = 0.8;

  if (isIceCap) {
    surfaceColor = vec3(0.92, 0.95, 0.98);
    roughness = 0.4;
  } else if (isLand) {
    float elevation = (landShape - 0.46) / 0.54;
    surfaceColor = mix(vec3(0.18, 0.35, 0.16), vec3(0.48, 0.40, 0.28), elevation);
  } else {
    // Deep Ocean
    surfaceColor = vec3(0.03, 0.12, 0.28);
    roughness = 0.12;
  }

  // Lighting
  float NdotL = dot(N, L);
  float dayFactor = clamp(NdotL * 1.5 + 0.1, 0.0, 1.0);

  // Specular reflection (ocean glint)
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 32.0) * (isLand ? 0.02 : 0.85);

  // Atmospheric sunset extinction near terminator
  float sunset = clamp(1.0 - abs(NdotL) * 3.5, 0.0, 1.0) * float(NdotL > -0.15);
  vec3 sunsetGlow = vec3(0.85, 0.35, 0.08) * sunset * 0.9;

  // Night city lights
  float nightCities = (fbm(p * 2.5) > 0.65 && isLand && !isIceCap) ? 0.8 : 0.0;
  vec3 nightColor = vec3(0.01, 0.015, 0.03) + vec3(1.0, 0.75, 0.3) * nightCities * (1.0 - dayFactor);

  vec3 dayColor = surfaceColor * max(NdotL, 0.05) + vec3(spec) * vec3(1.0, 0.95, 0.85) + sunsetGlow;

  // Atmospheric aerial haze over the surface
  float rim = 1.0 - max(dot(N, V), 0.0);
  vec3 hazeColor = vec3(0.25, 0.55, 0.95) * pow(rim, 2.5) * u_atmosphereDensity * dayFactor;

  vec3 finalColor = mix(nightColor, dayColor, dayFactor) + hazeColor;
  fragColor = vec4(finalColor, 1.0);
}
`;

const ATMOSPHERE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;

out vec3 v_worldPos;
out vec3 v_normal;

void main() {
  vec4 wp = u_model * vec4(a_position, 1.0);
  v_worldPos = wp.xyz;
  v_normal = normalize(mat3(u_model) * a_normal);
  gl_Position = u_proj * u_view * wp;
}
`;

const ATMOSPHERE_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;

uniform vec3 u_sunDir;
uniform vec3 u_camPos;
uniform float u_atmosphereDensity;

out vec4 fragColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 V = normalize(u_camPos - v_worldPos);
  vec3 L = normalize(u_sunDir);

  float NdotV = max(dot(N, V), 0.0);
  // Strong scattering at the grazing edge (rim / limb)
  float rim = pow(1.0 - NdotV, 3.2);

  // Sunlight illumination factor
  float NdotL = dot(N, L);
  float light = clamp(NdotL * 1.2 + 0.35, 0.0, 1.0);

  // Rayleigh phase function
  float cosTheta = dot(V, L);
  float rayleigh = 0.75 * (1.0 + cosTheta * cosTheta);

  // Mie forward scattering glow around sun
  float mie = pow(max(cosTheta, 0.0), 16.0) * 1.5;

  // Sky scattering blue
  vec3 rayleighColor = vec3(0.18, 0.52, 0.98) * rayleigh;
  // Sunset reddening near terminator
  float sunset = clamp(1.0 - abs(NdotL) * 2.5, 0.0, 1.0);
  vec3 sunsetColor = vec3(0.95, 0.35, 0.05) * sunset;

  vec3 skyColor = (rayleighColor + sunsetColor + vec3(mie)) * light * u_atmosphereDensity;

  float alpha = clamp(rim * 1.6 * light * u_atmosphereDensity, 0.0, 1.0);
  if (alpha < 0.01) discard;

  fragColor = vec4(skyColor, alpha);
}
`;

export interface AtmosphereState {
  sunAngle: number;
  atmosphereDensity: number;
  cameraDistance: number;
  yaw: number;
  pitch: number;
  autoRotate: boolean;
}

export class AtmosphereRenderer {
  public readonly gl: WebGL2RenderingContext;
  private globeProg: WebGLProgram;
  private atmoProg: WebGLProgram;

  private globeVao: WebGLVertexArrayObject;
  private atmoVao: WebGLVertexArrayObject;
  private indexCount: number;

  public state: AtmosphereState = {
    sunAngle: 1.1,
    atmosphereDensity: 1.2,
    cameraDistance: 2.6,
    yaw: 0.3,
    pitch: 0.2,
    autoRotate: true,
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.globeProg = this.createProgram(GLOBE_VS, GLOBE_FS);
    this.atmoProg = this.createProgram(ATMOSPHERE_VS, ATMOSPHERE_FS);

    const sphere = generateSphereMesh(48, 64, 1.0);
    this.indexCount = sphere.indices.length;

    // 1. Globe VAO
    this.globeVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.globeVao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    // Interleave pos(3), normal(3), uv(2)
    const vertexCount = sphere.positions.length / 3;
    const vertexData = new Float32Array(vertexCount * 8);
    for (let i = 0; i < vertexCount; i++) {
      vertexData[i * 8 + 0] = sphere.positions[i * 3 + 0];
      vertexData[i * 8 + 1] = sphere.positions[i * 3 + 1];
      vertexData[i * 8 + 2] = sphere.positions[i * 3 + 2];

      vertexData[i * 8 + 3] = sphere.normals[i * 3 + 0];
      vertexData[i * 8 + 4] = sphere.normals[i * 3 + 1];
      vertexData[i * 8 + 5] = sphere.normals[i * 3 + 2];

      vertexData[i * 8 + 6] = sphere.uvs[i * 2 + 0];
      vertexData[i * 8 + 7] = sphere.uvs[i * 2 + 1];
    }
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);

    const stride = 8 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0); // pos
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4); // normal
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4); // uv

    // 2. Atmosphere VAO (outer sphere with radius 1.04)
    const atmoSphere = generateSphereMesh(48, 64, 1.04);
    this.atmoVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.atmoVao);

    const atmoVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, atmoVbo);
    const atmoVertexData = new Float32Array(vertexCount * 6);
    for (let i = 0; i < vertexCount; i++) {
      atmoVertexData[i * 6 + 0] = atmoSphere.positions[i * 3 + 0];
      atmoVertexData[i * 6 + 1] = atmoSphere.positions[i * 3 + 1];
      atmoVertexData[i * 6 + 2] = atmoSphere.positions[i * 3 + 2];

      atmoVertexData[i * 6 + 3] = atmoSphere.normals[i * 3 + 0];
      atmoVertexData[i * 6 + 4] = atmoSphere.normals[i * 3 + 1];
      atmoVertexData[i * 6 + 5] = atmoSphere.normals[i * 3 + 2];
    }
    gl.bufferData(gl.ARRAY_BUFFER, atmoVertexData, gl.STATIC_DRAW);

    const atmoIbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, atmoIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, atmoSphere.indices, gl.STATIC_DRAW);

    const atmoStride = 6 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, atmoStride, 0); // pos
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, atmoStride, 3 * 4); // normal

    gl.bindVertexArray(null);

    this.setupInteraction(canvas);
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error(`VS compile: ${gl.getShaderInfoLog(vs)}`);
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error(`FS compile: ${gl.getShaderInfoLog(fs)}`);
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Link: ${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
  }

  private setupInteraction(canvas: HTMLCanvasElement): void {
    let dragging = false;
    let prevX = 0;
    let prevY = 0;

    canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      this.state.autoRotate = false;
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      this.state.yaw += dx * 0.005;
      this.state.pitch = Math.max(-1.3, Math.min(1.3, this.state.pitch + dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.state.cameraDistance = Math.max(1.3, Math.min(6.0, this.state.cameraDistance + e.deltaY * 0.003));
    }, { passive: false });
  }

  public render(dt = 0.016): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    if (this.state.autoRotate) {
      this.state.yaw += dt * 0.12;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    // Deep space black
    gl.clearColor(0.01, 0.015, 0.025, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    const proj = this.perspective(45 * (Math.PI / 180), aspect, 0.1, 100.0);

    const camX = this.state.cameraDistance * Math.sin(this.state.yaw) * Math.cos(this.state.pitch);
    const camY = this.state.cameraDistance * Math.sin(this.state.pitch);
    const camZ = this.state.cameraDistance * Math.cos(this.state.yaw) * Math.cos(this.state.pitch);
    const view = this.lookAt([camX, camY, camZ], [0, 0, 0], [0, 1, 0]);

    const sunDir = computeSunDirection(this.state.sunAngle);
    const model = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);

    // 1. Draw Earth Globe
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.useProgram(this.globeProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.globeProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.globeProg, 'u_view'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.globeProg, 'u_model'), false, model);
    gl.uniform3fv(gl.getUniformLocation(this.globeProg, 'u_sunDir'), sunDir);
    gl.uniform3fv(gl.getUniformLocation(this.globeProg, 'u_camPos'), [camX, camY, camZ]);
    gl.uniform1f(gl.getUniformLocation(this.globeProg, 'u_atmosphereDensity'), this.state.atmosphereDensity);

    gl.bindVertexArray(this.globeVao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    // 2. Draw Atmospheric Limb Outer Shell
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive luminous halo
    gl.depthMask(false);

    gl.useProgram(this.atmoProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.atmoProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.atmoProg, 'u_view'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.atmoProg, 'u_model'), false, model);
    gl.uniform3fv(gl.getUniformLocation(this.atmoProg, 'u_sunDir'), sunDir);
    gl.uniform3fv(gl.getUniformLocation(this.atmoProg, 'u_camPos'), [camX, camY, camZ]);
    gl.uniform1f(gl.getUniformLocation(this.atmoProg, 'u_atmosphereDensity'), this.state.atmosphereDensity);

    gl.bindVertexArray(this.atmoVao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  public readPixel(x: number, y: number): Uint8Array {
    const pixel = new Uint8Array(4);
    this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return pixel;
  }

  // --- Math utilities ---
  private perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1.0 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, (2 * far * near) * nf, 0,
    ]);
  }

  private lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
    let z0 = eye[0] - target[0];
    let z1 = eye[1] - target[1];
    let z2 = eye[2] - target[2];
    const lenZ = Math.hypot(z0, z1, z2);
    z0 /= lenZ; z1 /= lenZ; z2 /= lenZ;

    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    const lenX = Math.hypot(x0, x1, x2);
    x0 /= lenX; x1 /= lenX; x2 /= lenX;

    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;

    return new Float32Array([
      x0, y0, z0, 0,
      x1, y1, z1, 0,
      x2, y2, z2, 0,
      -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
      -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
      -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
      1,
    ]);
  }
}
