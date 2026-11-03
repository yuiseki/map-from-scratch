import { FireworkSimulation, packParticleBuffer } from './fireworks.ts';

const PARTICLE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in float a_size;

uniform mat4 u_proj;
uniform mat4 u_view;

out vec4 v_color;

void main() {
  vec4 viewPos = u_view * vec4(a_position, 1.0);
  gl_Position = u_proj * viewPos;
  // Size attenuation with camera distance
  gl_PointSize = clamp(a_size * (800.0 / -viewPos.z), 2.0, 80.0);
  v_color = a_color;
}
`;

const PARTICLE_FS = `#version 300 es
precision highp float;

in vec4 v_color;
out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;

  // Soft spherical particle glow with intense bright center
  float glow = exp(-dist * 7.0);
  float core = smoothstep(0.12, 0.0, dist);

  vec3 rgb = v_color.rgb * glow * 1.8 + vec3(core * 0.8);
  fragColor = vec4(rgb, v_color.a * glow);
}
`;

const GROUND_VS = `#version 300 es
layout(location = 0) in vec3 a_position;

uniform mat4 u_proj;
uniform mat4 u_view;

out vec3 v_worldPos;

void main() {
  v_worldPos = a_position;
  gl_Position = u_proj * u_view * vec4(a_position, 1.0);
}
`;

const GROUND_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
out vec4 fragColor;

void main() {
  // Dark night ground with subtle coordinate grid
  float gridX = abs(fract(v_worldPos.x / 100.0 - 0.5) - 0.5) / fwidth(v_worldPos.x / 100.0);
  float gridZ = abs(fract(v_worldPos.z / 100.0 - 0.5) - 0.5) / fwidth(v_worldPos.z / 100.0);
  float grid = 1.0 - min(gridX, gridZ);
  grid = clamp(grid, 0.0, 1.0);

  vec3 groundColor = mix(vec3(0.02, 0.03, 0.06), vec3(0.08, 0.12, 0.20), grid * 0.4);
  fragColor = vec4(groundColor, 1.0);
}
`;

export interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  autoRotate: boolean;
}

export class FireworksRenderer {
  public readonly gl: WebGL2RenderingContext;
  public sim: FireworkSimulation;

  private particleProg: WebGLProgram;
  private groundProg: WebGLProgram;

  private particleVao: WebGLVertexArrayObject;
  private particleVbo: WebGLBuffer;

  private groundVao: WebGLVertexArrayObject;
  private groundVertexCount = 6;

  public camera: CameraState = {
    yaw: 0.4,
    pitch: 0.25,
    distance: 1200,
    autoRotate: true,
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.sim = new FireworkSimulation(true);

    this.particleProg = this.createProgram(PARTICLE_VS, PARTICLE_FS);
    this.groundProg = this.createProgram(GROUND_VS, GROUND_FS);

    // Particle buffers
    this.particleVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.particleVao);
    this.particleVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);

    const stride = 8 * 4; // 8 floats * 4 bytes
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0); // Pos: vec3

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 3 * 4); // Color: vec4

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 7 * 4); // Size: float

    // Ground buffers (quad plane at y = 0)
    const s = 1500;
    const groundPos = new Float32Array([
      -s, 0, -s,  s, 0, -s,  s, 0,  s,
      -s, 0, -s,  s, 0,  s, -s, 0,  s,
    ]);
    this.groundVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.groundVao);
    const groundVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, groundVbo);
    gl.bufferData(gl.ARRAY_BUFFER, groundPos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    this.setupInteraction(canvas);
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error(`VS compile error: ${gl.getShaderInfoLog(vs)}`);
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error(`FS compile error: ${gl.getShaderInfoLog(fs)}`);
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Link error: ${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
  }

  private setupInteraction(canvas: HTMLCanvasElement): void {
    let dragging = false;
    let prevX = 0;
    let prevY = 0;

    canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      this.camera.autoRotate = false;
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      this.camera.yaw -= dx * 0.005;
      this.camera.pitch = Math.max(0.05, Math.min(1.4, this.camera.pitch + dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.distance = Math.max(400, Math.min(3000, this.camera.distance + e.deltaY * 1.5));
    }, { passive: false });
  }

  public render(dt = 0.016): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    this.sim.update(dt);

    if (this.camera.autoRotate) {
      this.camera.yaw += dt * 0.1;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    // Dark starry night clear
    gl.clearColor(0.01, 0.015, 0.03, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    const proj = this.perspective(50 * (Math.PI / 180), aspect, 10.0, 10000.0);

    const targetY = 350;
    const camX = this.camera.distance * Math.sin(this.camera.yaw) * Math.cos(this.camera.pitch);
    const camY = targetY + this.camera.distance * Math.sin(this.camera.pitch);
    const camZ = this.camera.distance * Math.cos(this.camera.yaw) * Math.cos(this.camera.pitch);
    const view = this.lookAt([camX, camY, camZ], [0, targetY, 0], [0, 1, 0]);

    // 1. Draw Ground Plane (with depth write)
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    gl.useProgram(this.groundProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.groundProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.groundProg, 'u_view'), false, view);

    gl.bindVertexArray(this.groundVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.groundVertexCount);

    // 2. Draw Fireworks Particles (additive blending, depth test without depth write)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    const pBuffer = packParticleBuffer(this.sim.particles);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    gl.bufferData(gl.ARRAY_BUFFER, pBuffer, gl.DYNAMIC_DRAW);

    gl.useProgram(this.particleProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.particleProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.particleProg, 'u_view'), false, view);

    gl.bindVertexArray(this.particleVao);
    gl.drawArrays(gl.POINTS, 0, this.sim.particles.length);

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
