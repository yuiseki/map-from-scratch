import {
  createStarBurstParticles,
  updateStarBurst,
  packStarBurstLines,
  type StarParticle,
} from './starburst.ts';

const LINE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_color;
layout(location = 2) in float a_alpha;

uniform mat4 u_proj;
uniform mat4 u_view;

out vec3 v_color;
out float v_alpha;

void main() {
  v_color = a_color;
  v_alpha = a_alpha;
  gl_Position = u_proj * u_view * vec4(a_position, 1.0);
}
`;

const LINE_FS = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_alpha;

out vec4 fragColor;

void main() {
  fragColor = vec4(v_color * (v_alpha * 1.5), v_alpha);
}
`;

const CORE_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_color;
layout(location = 2) in float a_size;

uniform mat4 u_proj;
uniform mat4 u_view;

out vec3 v_color;

void main() {
  v_color = a_color;
  vec4 viewPos = u_view * vec4(a_position, 1.0);
  gl_Position = u_proj * viewPos;
  gl_PointSize = clamp(a_size * (800.0 / -viewPos.z), 2.0, 32.0);
}
`;

const CORE_FS = `#version 300 es
precision highp float;

in vec3 v_color;
out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord) * 2.0;
  if (dist > 1.0) discard;
  float alpha = pow(1.0 - dist, 1.8);
  fragColor = vec4(v_color * 1.8, alpha);
}
`;

export interface StarBurstState {
  starCount: number;
  warpSpeed: number;
  streakLength: number;
  yaw: number;
  pitch: number;
  distance: number;
  autoRotate: boolean;
}

export class StarBurstRenderer {
  public readonly gl: WebGL2RenderingContext;
  private lineProg: WebGLProgram;
  private coreProg: WebGLProgram;

  private lineVao: WebGLVertexArrayObject;
  private lineVbo: WebGLBuffer;

  private coreVao: WebGLVertexArrayObject;
  private coreVbo: WebGLBuffer;

  private stars: StarParticle[] = [];
  private maxRadius = 1200;

  public state: StarBurstState = {
    starCount: 2000,
    warpSpeed: 3.5,
    streakLength: 0.12,
    yaw: 0.0,
    pitch: 0.0,
    distance: 400,
    autoRotate: true,
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.lineProg = this.createProgram(LINE_VS, LINE_FS);
    this.coreProg = this.createProgram(CORE_VS, CORE_FS);

    this.stars = createStarBurstParticles(this.state.starCount, this.maxRadius);

    // Line VAO
    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    this.lineVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);

    const lineStride = 7 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, lineStride, 0); // pos
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, lineStride, 3 * 4); // color
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, lineStride, 6 * 4); // alpha

    // Core VAO
    this.coreVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.coreVao);
    this.coreVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.coreVbo);

    const coreStride = 7 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, coreStride, 0); // pos
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, coreStride, 3 * 4); // color
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, coreStride, 6 * 4); // size

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
      this.state.yaw += dx * 0.005;
      this.state.pitch = Math.max(-1.4, Math.min(1.4, this.state.pitch + dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.state.distance = Math.max(50, Math.min(1200, this.state.distance + e.deltaY * 0.8));
    }, { passive: false });
  }

  public render(dt = 0.016): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    updateStarBurst(this.stars, dt, this.state.warpSpeed, this.maxRadius);

    if (this.state.autoRotate) {
      this.state.yaw += dt * 0.15;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    // Deep hyperspace black
    gl.clearColor(0.01, 0.015, 0.03, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    const proj = this.perspective(60 * (Math.PI / 180), aspect, 1.0, 4000.0);

    const camX = this.state.distance * Math.sin(this.state.yaw) * Math.cos(this.state.pitch);
    const camY = this.state.distance * Math.sin(this.state.pitch);
    const camZ = this.state.distance * Math.cos(this.state.yaw) * Math.cos(this.state.pitch);
    const view = this.lookAt([camX, camY, camZ], [0, 0, 0], [0, 1, 0]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive luminous warp glow
    gl.disable(gl.DEPTH_TEST);

    // 1. Draw Star Streak Lines
    const lineData = packStarBurstLines(this.stars, this.state.streakLength * this.state.warpSpeed * 0.08);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.DYNAMIC_DRAW);

    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'u_view'), false, view);

    gl.bindVertexArray(this.lineVao);
    gl.drawArrays(gl.LINES, 0, this.stars.length * 2);

    // 2. Draw Star Point Cores
    const coreStride = 7;
    const coreData = new Float32Array(this.stars.length * coreStride);
    let offset = 0;
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      coreData[offset++] = s.x;
      coreData[offset++] = s.y;
      coreData[offset++] = s.z;
      coreData[offset++] = s.color[0];
      coreData[offset++] = s.color[1];
      coreData[offset++] = s.color[2];
      coreData[offset++] = s.size;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.coreVbo);
    gl.bufferData(gl.ARRAY_BUFFER, coreData, gl.DYNAMIC_DRAW);

    gl.useProgram(this.coreProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.coreProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.coreProg, 'u_view'), false, view);

    gl.bindVertexArray(this.coreVao);
    gl.drawArrays(gl.POINTS, 0, this.stars.length);

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
