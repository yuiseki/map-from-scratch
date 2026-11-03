import {
  createWeatherParticles,
  updateWeather,
  packWeatherBuffer,
  type WeatherParticle,
  type WeatherType,
} from './weather.ts';

const WEATHER_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in float a_size;
layout(location = 2) in float a_alpha;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform int u_type; // 0: rain, 1: snow

out float v_alpha;
flat out int v_type;

void main() {
  vec4 viewPos = u_view * vec4(a_position, 1.0);
  gl_Position = u_proj * viewPos;

  // Rain particles are drawn larger/longer
  float baseSize = (u_type == 0) ? a_size * 2.2 : a_size;
  gl_PointSize = clamp(baseSize * (600.0 / -viewPos.z), 1.5, 48.0);
  v_alpha = a_alpha;
  v_type = u_type;
}
`;

const WEATHER_FS = `#version 300 es
precision highp float;

in float v_alpha;
flat in int v_type;

out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);

  if (v_type == 0) {
    // Rain droplet: vertically elongated streak
    coord.x *= 2.8;
    float dist = length(coord);
    if (dist > 0.5) discard;
    float alpha = (1.0 - dist * 2.0) * v_alpha * 0.7;
    fragColor = vec4(0.8, 0.9, 1.0, alpha);
  } else {
    // Snowflake: soft fuzzy circular particle
    float dist = length(coord);
    if (dist > 0.5) discard;
    float alpha = smoothstep(0.5, 0.05, dist) * v_alpha;
    fragColor = vec4(1.0, 1.0, 1.0, alpha);
  }
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
uniform int u_type;

out vec4 fragColor;

void main() {
  // Grid lines
  float gridX = abs(fract(v_worldPos.x / 50.0 - 0.5) - 0.5) / fwidth(v_worldPos.x / 50.0);
  float gridZ = abs(fract(v_worldPos.z / 50.0 - 0.5) - 0.5) / fwidth(v_worldPos.z / 50.0);
  float grid = 1.0 - min(gridX, gridZ);
  grid = clamp(grid, 0.0, 1.0);

  vec3 base = (u_type == 0)
    ? mix(vec3(0.12, 0.15, 0.18), vec3(0.20, 0.25, 0.30), grid * 0.5)  // Wet rainy pavement
    : mix(vec3(0.82, 0.85, 0.90), vec3(0.92, 0.95, 0.98), grid * 0.4); // Snow ground

  fragColor = vec4(base, 1.0);
}
`;

export interface WeatherState {
  type: WeatherType;
  particleCount: number;
  windSpeed: number;
  yaw: number;
  pitch: number;
  distance: number;
  autoRotate: boolean;
}

export class WeatherRenderer {
  public readonly gl: WebGL2RenderingContext;
  private weatherProg: WebGLProgram;
  private groundProg: WebGLProgram;

  private weatherVao: WebGLVertexArrayObject;
  private weatherVbo: WebGLBuffer;

  private groundVao: WebGLVertexArrayObject;
  private groundVertexCount = 6;

  public state: WeatherState = {
    type: 'rain',
    particleCount: 2500,
    windSpeed: 40,
    yaw: 0.5,
    pitch: 0.35,
    distance: 650,
    autoRotate: true,
  };

  private particles: WeatherParticle[] = [];
  private volume: [number, number, number] = [800, 500, 800];
  private timeSec = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.weatherProg = this.createProgram(WEATHER_VS, WEATHER_FS);
    this.groundProg = this.createProgram(GROUND_VS, GROUND_FS);

    this.particles = createWeatherParticles(this.state.particleCount, this.state.type, this.volume);

    // Weather VAO
    this.weatherVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.weatherVao);
    this.weatherVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.weatherVbo);

    const stride = 5 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0); // Position: vec3

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 3 * 4); // Size: float

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 4 * 4); // Alpha: float

    // Ground plane
    const s = 600;
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

  public setWeatherType(type: WeatherType): void {
    if (this.state.type !== type) {
      this.state.type = type;
      this.particles = createWeatherParticles(this.state.particleCount, type, this.volume);
    }
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
      this.state.yaw -= dx * 0.005;
      this.state.pitch = Math.max(0.05, Math.min(1.4, this.state.pitch + dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.state.distance = Math.max(250, Math.min(1500, this.state.distance + e.deltaY * 0.8));
    }, { passive: false });
  }

  public render(dt = 0.016): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    this.timeSec += dt;
    const wind: [number, number, number] = [this.state.windSpeed, 0, 0];
    updateWeather(this.particles, dt, this.state.type, wind, this.volume, this.timeSec);

    if (this.state.autoRotate) {
      this.state.yaw += dt * 0.08;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);

    // Weather atmosphere clear color
    if (this.state.type === 'rain') {
      gl.clearColor(0.20, 0.24, 0.28, 1.0); // Misty rain storm grey
    } else {
      gl.clearColor(0.72, 0.76, 0.82, 1.0); // Winter overcast snow white
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    const proj = this.perspective(50 * (Math.PI / 180), aspect, 5.0, 5000.0);

    const targetY = 150;
    const camX = this.state.distance * Math.sin(this.state.yaw) * Math.cos(this.state.pitch);
    const camY = targetY + this.state.distance * Math.sin(this.state.pitch);
    const camZ = this.state.distance * Math.cos(this.state.yaw) * Math.cos(this.state.pitch);
    const view = this.lookAt([camX, camY, camZ], [0, targetY, 0], [0, 1, 0]);

    // 1. Draw Ground Plane
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    gl.useProgram(this.groundProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.groundProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.groundProg, 'u_view'), false, view);
    gl.uniform1i(gl.getUniformLocation(this.groundProg, 'u_type'), this.state.type === 'rain' ? 0 : 1);

    gl.bindVertexArray(this.groundVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.groundVertexCount);

    // 2. Draw Weather Particles
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    const pBuffer = packWeatherBuffer(this.particles);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.weatherVbo);
    gl.bufferData(gl.ARRAY_BUFFER, pBuffer, gl.DYNAMIC_DRAW);

    gl.useProgram(this.weatherProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.weatherProg, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.weatherProg, 'u_view'), false, view);
    gl.uniform1i(gl.getUniformLocation(this.weatherProg, 'u_type'), this.state.type === 'rain' ? 0 : 1);

    gl.bindVertexArray(this.weatherVao);
    gl.drawArrays(gl.POINTS, 0, this.particles.length);

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
