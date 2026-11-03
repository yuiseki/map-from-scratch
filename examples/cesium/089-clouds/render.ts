import {
  createCumulusClouds,
  updateClouds,
  packCloudPuffs,
  type CloudPuff,
} from './clouds.ts';

const SKY_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.9999, 1.0);
}
`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  // Atmospheric sky gradient from horizon to zenith
  vec3 zenith = vec3(0.12, 0.38, 0.82);
  vec3 horizon = vec3(0.68, 0.82, 0.95);
  vec3 color = mix(horizon, zenith, clamp(v_uv.y * 1.4 - 0.2, 0.0, 1.0));
  fragColor = vec4(color, 1.0);
}
`;

const TERRAIN_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_proj;
uniform mat4 u_view;

out vec3 v_worldPos;
out vec3 v_normal;

void main() {
  v_worldPos = a_position;
  v_normal = a_normal;
  gl_Position = u_proj * u_view * vec4(a_position, 1.0);
}
`;

const TERRAIN_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;

uniform vec3 u_sunDir;
uniform vec3 u_cloudCenters[8];
uniform float u_cloudRadii[8];

out vec4 fragColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 L = normalize(u_sunDir);

  float NdotL = max(dot(N, L), 0.0);

  // Natural terrain coloring (grass / alpine meadow / rock)
  vec3 grass = vec3(0.25, 0.48, 0.20);
  vec3 rock = vec3(0.45, 0.42, 0.38);
  float slope = 1.0 - N.y;
  vec3 baseColor = mix(grass, rock, clamp(slope * 2.5, 0.0, 1.0));

  // Cloud shadows projected onto ground
  float shadow = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 c = u_cloudCenters[i];
    float r = u_cloudRadii[i];
    // Project cloud center onto ground plane along sun direction
    float t = c.y / max(L.y, 0.1);
    vec2 shadowPos = c.xz - L.xz * t;
    float dist = length(v_worldPos.xz - shadowPos);
    shadow += smoothstep(r * 1.4, r * 0.4, dist) * 0.45;
  }
  shadow = clamp(shadow, 0.0, 0.65);

  vec3 diffuse = baseColor * (0.35 + 0.65 * NdotL * (1.0 - shadow));
  fragColor = vec4(diffuse, 1.0);
}
`;

const CLOUD_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in float a_radius;
layout(location = 2) in float a_density;

uniform mat4 u_proj;
uniform mat4 u_view;

out float v_radius;
out float v_density;
out vec3 v_worldPos;

void main() {
  v_radius = a_radius;
  v_density = a_density;
  v_worldPos = a_position;

  vec4 viewPos = u_view * vec4(a_position, 1.0);
  gl_Position = u_proj * viewPos;
  // Point size in pixels scales with distance and radius
  gl_PointSize = clamp(a_radius * 2.5 * (750.0 / -viewPos.z), 12.0, 360.0);
}
`;

const CLOUD_FS = `#version 300 es
precision highp float;

in float v_radius;
in float v_density;
in vec3 v_worldPos;

uniform vec3 u_sunDir;

out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord) * 2.0;
  if (dist > 1.0) discard;

  // Soft spherical volumetric density falloff
  float alpha = smoothstep(1.0, 0.15, dist) * v_density * 0.85;

  // 3D pseudo normal of the spherical puff
  vec3 N = normalize(vec3(coord.x * 2.0, -coord.y * 2.0, sqrt(max(0.0, 1.0 - dist * dist))));
  vec3 L = normalize(u_sunDir);

  // Directional sun illumination: cloud tops are sunlit silver-white, base has cool ambient shadow
  float sunFactor = clamp(dot(N, L) * 0.6 + 0.45, 0.0, 1.0);
  vec3 sunlitColor = vec3(1.0, 0.98, 0.96);
  vec3 ambientColor = vec3(0.62, 0.70, 0.82); // Ambient sky bounce

  vec3 color = mix(ambientColor, sunlitColor, sunFactor);
  fragColor = vec4(color, alpha);
}
`;

export interface CloudsState {
  cloudCount: number;
  windSpeed: number;
  altitude: number;
  sunAngle: number;
  yaw: number;
  pitch: number;
  distance: number;
  autoDrift: boolean;
}

export class CloudsRenderer {
  public readonly gl: WebGL2RenderingContext;
  private skyProg: WebGLProgram;
  private terrainProg: WebGLProgram;
  private cloudProg: WebGLProgram;

  private skyVao: WebGLVertexArrayObject;
  private terrainVao: WebGLVertexArrayObject;
  private terrainIndexCount: number;

  private cloudVao: WebGLVertexArrayObject;
  private cloudVbo: WebGLBuffer;

  private puffs: CloudPuff[] = [];
  private bounds: [number, number, number] = [3200, 500, 3200];
  private clusterCount = 8;
  private puffsPerCluster = 14;

  public state: CloudsState = {
    cloudCount: 112,
    windSpeed: 35,
    altitude: 320,
    sunAngle: 0.9,
    yaw: 0.4,
    pitch: 0.28,
    distance: 900,
    autoDrift: true,
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.skyProg = this.createProgram(SKY_VS, SKY_FS);
    this.terrainProg = this.createProgram(TERRAIN_VS, TERRAIN_FS);
    this.cloudProg = this.createProgram(CLOUD_VS, CLOUD_FS);

    // 1. Sky Quad VAO
    this.skyVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.skyVao);
    const skyVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, skyVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // 2. Terrain VAO
    const { positions, normals, indices } = this.generateTerrainMesh(60, 60, 2800);
    this.terrainIndexCount = indices.length;
    this.terrainVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.terrainVao);

    const terrainVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainVbo);
    const vertCount = positions.length / 3;
    const terrainData = new Float32Array(vertCount * 6);
    for (let i = 0; i < vertCount; i++) {
      terrainData[i * 6 + 0] = positions[i * 3 + 0];
      terrainData[i * 6 + 1] = positions[i * 3 + 1];
      terrainData[i * 6 + 2] = positions[i * 3 + 2];
      terrainData[i * 6 + 3] = normals[i * 3 + 0];
      terrainData[i * 6 + 4] = normals[i * 3 + 1];
      terrainData[i * 6 + 5] = normals[i * 3 + 2];
    }
    gl.bufferData(gl.ARRAY_BUFFER, terrainData, gl.STATIC_DRAW);

    const terrainIbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const stride = 6 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0); // pos
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4); // normal

    // 3. Clouds VAO
    this.puffs = createCumulusClouds(this.clusterCount, this.puffsPerCluster, this.bounds, this.state.altitude);

    this.cloudVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.cloudVao);
    this.cloudVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVbo);

    const cloudStride = 5 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, cloudStride, 0); // pos (x, y, z)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, cloudStride, 3 * 4); // radius
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, cloudStride, 4 * 4); // density

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

  private generateTerrainMesh(cols: number, rows: number, size: number): {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint16Array;
  } {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const half = size / 2;
    const step = size / cols;

    for (let r = 0; r <= rows; r++) {
      const z = -half + r * step;
      for (let c = 0; c <= cols; c++) {
        const x = -half + c * step;
        const y = 22 * Math.sin(x / 140) * Math.cos(z / 140) + 30 * Math.sin(x / 350 + z / 300);

        // Numerical normal
        const eps = 1.0;
        const yL = 22 * Math.sin((x - eps) / 140) * Math.cos(z / 140) + 30 * Math.sin((x - eps) / 350 + z / 300);
        const yR = 22 * Math.sin((x + eps) / 140) * Math.cos(z / 140) + 30 * Math.sin((x + eps) / 350 + z / 300);
        const yD = 22 * Math.sin(x / 140) * Math.cos((z - eps) / 140) + 30 * Math.sin(x / 350 + (z - eps) / 300);
        const yU = 22 * Math.sin(x / 140) * Math.cos((z + eps) / 140) + 30 * Math.sin(x / 350 + (z + eps) / 300);

        const nx = -(yR - yL) / (2 * eps);
        const nz = -(yU - yD) / (2 * eps);
        const ny = 1.0;
        const len = Math.hypot(nx, ny, nz);

        positions.push(x, y, z);
        normals.push(nx / len, ny / len, nz / len);
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * (cols + 1) + c;
        const next = idx + (cols + 1);
        indices.push(idx, next, idx + 1);
        indices.push(next, next + 1, idx + 1);
      }
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint16Array(indices),
    };
  }

  private setupInteraction(canvas: HTMLCanvasElement): void {
    let dragging = false;
    let prevX = 0;
    let prevY = 0;

    canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      this.state.yaw += dx * 0.005;
      this.state.pitch = Math.max(0.08, Math.min(1.2, this.state.pitch + dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.state.distance = Math.max(300, Math.min(2200, this.state.distance + e.deltaY * 0.8));
    }, { passive: false });
  }

  public render(dt = 0.016): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    if (this.state.autoDrift) {
      updateClouds(this.puffs, dt, [this.state.windSpeed, 0, 0], this.bounds);
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    const proj = this.perspective(45 * (Math.PI / 180), aspect, 5.0, 6000.0);

    const camY = 120 + this.state.distance * Math.sin(this.state.pitch);
    const camX = this.state.distance * Math.sin(this.state.yaw) * Math.cos(this.state.pitch);
    const camZ = this.state.distance * Math.cos(this.state.yaw) * Math.cos(this.state.pitch);
    const view = this.lookAt([camX, camY, camZ], [0, 80, 0], [0, 1, 0]);

    const sunDir: [number, number, number] = [
      Math.cos(this.state.sunAngle) * 0.8,
      0.65,
      Math.sin(this.state.sunAngle) * 0.8,
    ];

    // 1. Draw Sky Dome
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.skyProg);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2. Draw Terrain with Cloud Shadows
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    gl.useProgram(this.terrainProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainProg, 'u_view'), false, view);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'u_sunDir'), sunDir);

    // Collect 8 cluster centers for shadows
    const centers = new Float32Array(8 * 3);
    const radii = new Float32Array(8);
    for (let c = 0; c < 8; c++) {
      const p = this.puffs[c * this.puffsPerCluster];
      if (p) {
        centers[c * 3 + 0] = p.x;
        centers[c * 3 + 1] = p.y;
        centers[c * 3 + 2] = p.z;
        radii[c] = 160.0;
      }
    }
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'u_cloudCenters'), centers);
    gl.uniform1fv(gl.getUniformLocation(this.terrainProg, 'u_cloudRadii'), radii);

    gl.bindVertexArray(this.terrainVao);
    gl.drawElements(gl.TRIANGLES, this.terrainIndexCount, gl.UNSIGNED_SHORT, 0);

    // 3. Draw Volumetric Cumulus Clouds
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    const cloudData = packCloudPuffs(this.puffs);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVbo);
    gl.bufferData(gl.ARRAY_BUFFER, cloudData, gl.DYNAMIC_DRAW);

    gl.useProgram(this.cloudProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.cloudProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.cloudProg, 'u_view'), false, view);
    gl.uniform3fv(gl.getUniformLocation(this.cloudProg, 'u_sunDir'), sunDir);

    gl.bindVertexArray(this.cloudVao);
    gl.drawArrays(gl.POINTS, 0, this.puffs.length);

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
