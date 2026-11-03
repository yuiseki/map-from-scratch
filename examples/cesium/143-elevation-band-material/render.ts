import { generateMountainTerrain, type TerrainMesh } from './elevation.ts';

const TERRAIN_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in float a_elevation;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;

out vec3 v_worldPos;
out vec3 v_normal;
out float v_elevation;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_normal = mat3(u_model) * a_normal;
  v_elevation = a_elevation;

  gl_Position = u_proj * u_view * worldPos;
}
`;

const TERRAIN_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in float v_elevation;

uniform vec3 u_camPos;
uniform vec3 u_lightDir;
uniform float u_contourInterval; // e.g. 200.0
uniform int u_paletteMode;       // 0: Topographic, 1: Thermal, 2: Cyber

out vec4 fragColor;

vec3 getBandColor(float h) {
  if (u_paletteMode == 0) {
    // Topographic standard elevation bands
    if (h < 1000.0) return vec3(0.18, 0.49, 0.20);      // Valley forest green
    if (h < 1800.0) return vec3(0.55, 0.76, 0.29);      // Subalpine light green
    if (h < 2500.0) return vec3(1.00, 0.93, 0.35);      // Alpine meadow yellow
    if (h < 3200.0) return vec3(0.96, 0.49, 0.00);      // Rocky scree orange
    return vec3(0.98, 0.98, 1.00);                       // Summit snow white
  } else if (u_paletteMode == 1) {
    // Thermal hypsometric
    if (h < 1000.0) return vec3(0.15, 0.25, 0.70);
    if (h < 1800.0) return vec3(0.20, 0.65, 0.85);
    if (h < 2500.0) return vec3(0.95, 0.75, 0.10);
    if (h < 3200.0) return vec3(0.90, 0.30, 0.15);
    return vec3(0.70, 0.10, 0.35);
  } else {
    // Cyber neon
    if (h < 1000.0) return vec3(0.05, 0.10, 0.25);
    if (h < 1800.0) return vec3(0.00, 0.85, 0.85);
    if (h < 2500.0) return vec3(0.95, 0.15, 0.85);
    if (h < 3200.0) return vec3(1.00, 0.95, 0.20);
    return vec3(0.40, 1.00, 0.50);
  }
}

void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(u_lightDir);
  vec3 V = normalize(u_camPos - v_worldPos);

  // Elevation band base color
  vec3 baseColor = getBandColor(v_elevation);

  // Sharp contour lines at interval boundaries using screen-space derivatives
  if (u_contourInterval > 0.0) {
    float f = v_elevation / u_contourInterval;
    float fw = fwidth(f);
    float line = 1.0 - smoothstep(0.0, fw * 1.5, abs(fract(f - 0.5) - 0.5));
    // Dark contour line
    baseColor = mix(baseColor, vec3(0.1, 0.12, 0.15), line * 0.75);

    // Thick major band step boundary lines (every 800m)
    float majorF = v_elevation / 800.0;
    float majorFw = fwidth(majorF);
    float majorLine = 1.0 - smoothstep(0.0, majorFw * 2.0, abs(fract(majorF - 0.5) - 0.5));
    baseColor = mix(baseColor, vec3(0.02, 0.03, 0.05), majorLine * 0.9);
  }

  // Directional diffuse + ambient
  float diffuse = max(dot(N, L), 0.0);
  float ambient = 0.35;
  vec3 litColor = baseColor * (ambient + 0.65 * diffuse);

  // Specular glint on snowy summit (h > 3200m)
  if (v_elevation > 3200.0) {
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 16.0);
    litColor += vec3(spec * 0.4);
  }

  // Atmospheric distance fog
  float dist = length(u_camPos - v_worldPos);
  float fogFactor = clamp((dist - 15000.0) / 45000.0, 0.0, 0.65);
  vec3 fogColor = vec3(0.68, 0.78, 0.90);

  vec3 finalColor = mix(litColor, fogColor, fogFactor);
  fragColor = vec4(finalColor, 1.0);
}
`;

export interface ElevationState {
  yaw: number;
  pitch: number;
  distance: number;
  contourInterval: number;
  paletteMode: number;
  autoRotate: boolean;
}

export class ElevationRenderer {
  public readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private indexCount: number;

  public state: ElevationState = {
    yaw: 0.85,
    pitch: 0.55,
    distance: 34000,
    contourInterval: 200,
    paletteMode: 0,
    autoRotate: true,
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.program = this.createProgram(TERRAIN_VS, TERRAIN_FS);

    const mesh = generateMountainTerrain(128, 3776);
    this.indexCount = mesh.indices.length;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Positions (location 0)
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // Normals (location 1)
    const normBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    // Elevations (location 2)
    const elevBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, elevBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.elevations, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

    // Indices
    const idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    this.setupInteraction(canvas);
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error(`VS: ${gl.getShaderInfoLog(vs)}`);
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error(`FS: ${gl.getShaderInfoLog(fs)}`);
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
      this.state.yaw -= dx * 0.005;
      this.state.pitch = Math.max(0.15, Math.min(1.4, this.state.pitch + dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.state.distance = Math.max(12000, Math.min(70000, this.state.distance + e.deltaY * 30));
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
    // Sky blue background
    gl.clearColor(0.68, 0.78, 0.90, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const aspect = canvas.width / canvas.height;
    const proj = this.perspective(45 * (Math.PI / 180), aspect, 100.0, 150000.0);

    // Orbit camera looking at mountain center (height = 1500m)
    const targetY = 1500;
    const camX = this.state.distance * Math.sin(this.state.yaw) * Math.cos(this.state.pitch);
    const camY = targetY + this.state.distance * Math.sin(this.state.pitch);
    const camZ = this.state.distance * Math.cos(this.state.yaw) * Math.cos(this.state.pitch);
    const camPos: [number, number, number] = [camX, camY, camZ];

    const view = this.lookAt(camPos, [0, targetY, 0], [0, 1, 0]);
    const model = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);

    // Sun light direction (slanted afternoon mountain sun)
    const lightDir: [number, number, number] = [0.6, 0.75, 0.3];
    const lenL = Math.hypot(...lightDir);
    lightDir[0] /= lenL; lightDir[1] /= lenL; lightDir[2] /= lenL;

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'u_view'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'u_model'), false, model);
    gl.uniform3fv(gl.getUniformLocation(this.program, 'u_camPos'), camPos);
    gl.uniform3fv(gl.getUniformLocation(this.program, 'u_lightDir'), lightDir);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_contourInterval'), this.state.contourInterval);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_paletteMode'), this.state.paletteMode);

    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
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
