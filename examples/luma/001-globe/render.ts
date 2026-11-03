import { createSphereMesh, computeSunDirection, generateEarthTextures, type SphereMesh } from './globe.ts';

const EARTH_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;

out vec3 v_normal;
out vec3 v_worldPos;
out vec3 v_viewDir;
out vec2 v_uv;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  // Rotation only model matrix preserves normals
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;

  // View direction towards camera (camera position is roughly inverse view)
  v_viewDir = -normalize(worldPos.xyz);

  gl_Position = u_proj * u_view * worldPos;
}
`;

const EARTH_FS = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec3 v_worldPos;
in vec3 v_viewDir;
in vec2 v_uv;

uniform sampler2D u_dayTexture;
uniform sampler2D u_nightTexture;
uniform vec3 u_sunDir;
uniform vec3 u_camPos;

out vec4 fragColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 V = normalize(u_camPos - v_worldPos);
  vec3 L = normalize(u_sunDir);

  float NdotL = dot(N, L);
  float diffuse = clamp(NdotL, 0.0, 1.0);

  // Smooth terminator transition between night and day
  float dayWeight = smoothstep(-0.15, 0.15, NdotL);

  vec4 dayTex = texture(u_dayTexture, v_uv);
  vec4 nightTex = texture(u_nightTexture, v_uv);

  // Specular reflection on water/ice (stored in dayTex.a)
  vec3 H = normalize(L + V);
  float specFactor = pow(max(dot(N, H), 0.0), 32.0);
  float specular = specFactor * (dayTex.a) * diffuse;

  // Atmosphere Rayleigh rim glow
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.5);
  vec3 atmosphereRim = vec3(0.25, 0.55, 1.0) * fresnel * (0.2 + 0.8 * diffuse);

  // Twilight horizon tint (warm golden/orange along terminator)
  float terminatorBand = 1.0 - abs(NdotL) * 6.0;
  vec3 twilightTint = vec3(0.9, 0.4, 0.1) * max(0.0, terminatorBand) * 0.3;

  // Combine day surface with specular and night city lights
  vec3 daySurface = dayTex.rgb * (0.05 + 0.95 * diffuse) + vec3(specular * 0.7);
  vec3 nightSurface = nightTex.rgb * 1.6 + vec3(0.015, 0.02, 0.035); // Ambient moonlight

  vec3 surfaceColor = mix(nightSurface, daySurface, dayWeight) + twilightTint;

  fragColor = vec4(surfaceColor + atmosphereRim, 1.0);
}
`;

const ATMOSPHERE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;

out vec3 v_normal;
out vec3 v_worldPos;

void main() {
  // Expand atmosphere shell slightly beyond Earth radius
  vec4 worldPos = u_model * vec4(a_position * 1.055, 1.0);
  v_worldPos = worldPos.xyz;
  v_normal = mat3(u_model) * a_normal;
  gl_Position = u_proj * u_view * worldPos;
}
`;

const ATMOSPHERE_FS = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec3 v_worldPos;

uniform vec3 u_sunDir;
uniform vec3 u_camPos;

out vec4 fragColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 V = normalize(u_camPos - v_worldPos);
  vec3 L = normalize(u_sunDir);

  // Soft atmospheric rim scatter
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float sunScatter = max(dot(N, L) * 0.5 + 0.5, 0.0);

  vec3 atmoColor = vec3(0.22, 0.58, 1.0) * rim * sunScatter * 0.85;
  fragColor = vec4(atmoColor, rim * sunScatter * 0.75);
}
`;

export interface GlobeState {
  yaw: number;
  pitch: number;
  distance: number;
  sunAngle: number;
  autoRotate: boolean;
}

export class GlobeRenderer {
  public readonly gl: WebGL2RenderingContext;
  private earthProgram: WebGLProgram;
  private atmoProgram: WebGLProgram;
  private earthVao: WebGLVertexArrayObject;
  private atmoVao: WebGLVertexArrayObject;
  private dayTexture: WebGLTexture;
  private nightTexture: WebGLTexture;
  private indexCount: number;

  public state: GlobeState = {
    yaw: 0.8,
    pitch: 0.25,
    distance: 2.6,
    sunAngle: 1.2,
    autoRotate: true,
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.earthProgram = this.createProgram(EARTH_VS, EARTH_FS);
    this.atmoProgram = this.createProgram(ATMOSPHERE_VS, ATMOSPHERE_FS);

    const mesh = createSphereMesh(64, 128, 1.0);
    this.indexCount = mesh.indices.length;

    // Earth buffers & VAO
    this.earthVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.earthVao);

    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const normBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

    const idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    // Atmosphere VAO
    this.atmoVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.atmoVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);

    gl.bindVertexArray(null);

    // Textures
    const { day, night } = generateEarthTextures(512, 256);
    this.dayTexture = this.createTexture(day, 512, 256);
    this.nightTexture = this.createTexture(night, 512, 256);

    this.setupInteraction(canvas);
  }

  private createTexture(data: Uint8Array, width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
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
      this.state.yaw -= dx * 0.006;
      this.state.pitch = Math.max(-1.4, Math.min(1.4, this.state.pitch + dy * 0.006));
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.state.distance = Math.max(1.4, Math.min(6.0, this.state.distance + e.deltaY * 0.003));
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
      this.state.yaw -= dt * 0.15;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    // Deep space clear color
    gl.clearColor(0.01, 0.015, 0.03, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const aspect = canvas.width / canvas.height;
    const proj = this.perspective(45 * (Math.PI / 180), aspect, 0.1, 100.0);

    // Orbit Camera
    const camX = this.state.distance * Math.sin(this.state.yaw) * Math.cos(this.state.pitch);
    const camY = this.state.distance * Math.sin(this.state.pitch);
    const camZ = this.state.distance * Math.cos(this.state.yaw) * Math.cos(this.state.pitch);
    const camPos: [number, number, number] = [camX, camY, camZ];

    const view = this.lookAt(camPos, [0, 0, 0], [0, 1, 0]);

    // Model matrix (Earth axial tilt of 23.4 degrees)
    const tilt = (23.44 * Math.PI) / 180;
    const model = this.rotationZ(tilt);

    const sunDir = computeSunDirection(this.state.sunAngle);

    // 1. Draw Earth Sphere
    gl.useProgram(this.earthProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.earthProgram, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.earthProgram, 'u_view'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.earthProgram, 'u_model'), false, model);
    gl.uniform3fv(gl.getUniformLocation(this.earthProgram, 'u_sunDir'), sunDir);
    gl.uniform3fv(gl.getUniformLocation(this.earthProgram, 'u_camPos'), camPos);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dayTexture);
    gl.uniform1i(gl.getUniformLocation(this.earthProgram, 'u_dayTexture'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.nightTexture);
    gl.uniform1i(gl.getUniformLocation(this.earthProgram, 'u_nightTexture'), 1);

    gl.bindVertexArray(this.earthVao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    // 2. Draw Atmosphere Shell with Alpha Blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    gl.useProgram(this.atmoProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.atmoProgram, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.atmoProgram, 'u_view'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.atmoProgram, 'u_model'), false, model);
    gl.uniform3fv(gl.getUniformLocation(this.atmoProgram, 'u_sunDir'), sunDir);
    gl.uniform3fv(gl.getUniformLocation(this.atmoProgram, 'u_camPos'), camPos);

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

  private rotationZ(rad: number): Float32Array {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return new Float32Array([
      c, s, 0, 0,
      -s, c, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  }
}
