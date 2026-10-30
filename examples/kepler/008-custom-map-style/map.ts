// examples/kepler/008-custom-map-style/map.ts
export interface StylePalette {
  id: string;
  name: string;
  ocean: [number, number, number, number];
  land: [number, number, number, number];
  border: [number, number, number, number];
  pointRampMode: number; // 0: dark/magma, 1: light/plasma, 2: neon, 3: warm
}

export const STYLES: Record<string, StylePalette> = {
  dark: {
    id: 'dark',
    name: 'Dark Matter',
    ocean: [0.08, 0.09, 0.12, 1.0],
    land: [0.15, 0.17, 0.22, 1.0],
    border: [0.25, 0.28, 0.35, 1.0],
    pointRampMode: 0,
  },
  light: {
    id: 'light',
    name: 'Positron (Light)',
    ocean: [0.92, 0.94, 0.96, 1.0],
    land: [0.82, 0.84, 0.87, 1.0],
    border: [0.65, 0.68, 0.72, 1.0],
    pointRampMode: 1,
  },
  navy: {
    id: 'navy',
    name: 'Muted Navy',
    ocean: [0.05, 0.10, 0.18, 1.0],
    land: [0.12, 0.20, 0.32, 1.0],
    border: [0.20, 0.35, 0.50, 1.0],
    pointRampMode: 2,
  },
  desert: {
    id: 'desert',
    name: 'Desert Gold',
    ocean: [0.16, 0.14, 0.12, 1.0],
    land: [0.28, 0.24, 0.20, 1.0],
    border: [0.45, 0.38, 0.30, 1.0],
    pointRampMode: 3,
  },
};

const LAND_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 uCenter;
uniform float uZoom;
uniform vec2 uResolution;
void main() {
  vec2 diff = aPos - uCenter;
  float scale = exp2(uZoom) * uResolution.y;
  vec2 screen = diff * scale;
  vec2 clip = vec2(screen.x / (uResolution.x * 0.5), -screen.y / (uResolution.y * 0.5));
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const LAND_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() {
  fragColor = uColor;
}
`;

const POINT_VS = `#version 300 es
layout(location = 0) in vec4 aPoint; // x, y, mag, depth
uniform vec2 uCenter;
uniform float uZoom;
uniform vec2 uResolution;
uniform float uMinMag;
out float vMag;
void main() {
  vMag = aPoint.z;
  if (aPoint.z < uMinMag) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec2 diff = aPoint.xy - uCenter;
  float scale = exp2(uZoom) * uResolution.y;
  vec2 screen = diff * scale;
  vec2 clip = vec2(screen.x / (uResolution.x * 0.5), -screen.y / (uResolution.y * 0.5));
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = clamp(pow(aPoint.z, 1.4) * (uZoom * 0.4), 3.0, 48.0);
}
`;

const POINT_FS = `#version 300 es
precision highp float;
in float vMag;
uniform int uRampMode;
out vec4 fragColor;

vec3 getMagma(float t) {
  return mix(vec3(0.98, 0.88, 0.22), vec3(0.72, 0.11, 0.44), clamp(t, 0.0, 1.0));
}

vec3 getPlasma(float t) {
  return mix(vec3(0.15, 0.45, 0.95), vec3(0.95, 0.25, 0.35), clamp(t, 0.0, 1.0));
}

vec3 getNeon(float t) {
  return mix(vec3(0.1, 0.9, 0.8), vec3(0.9, 0.1, 0.6), clamp(t, 0.0, 1.0));
}

vec3 getWarm(float t) {
  return mix(vec3(0.95, 0.65, 0.15), vec3(0.85, 0.15, 0.1), clamp(t, 0.0, 1.0));
}

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  float alpha = smoothstep(0.5, 0.35, dist);
  float normMag = clamp((vMag - 2.5) / 5.5, 0.0, 1.0);
  
  vec3 col = getMagma(normMag);
  if (uRampMode == 1) col = getPlasma(normMag);
  else if (uRampMode == 2) col = getNeon(normMag);
  else if (uRampMode == 3) col = getWarm(normMag);

  fragColor = vec4(col, alpha * 0.85);
}
`;

function createShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || 'Shader error');
  }
  return s;
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, createShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, createShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'Program error');
  }
  return p;
}

export class KeplerCustomStyleMap {
  private gl: WebGL2RenderingContext;
  private landProg: WebGLProgram;
  private pointProg: WebGLProgram;

  private pointVbo!: WebGLBuffer;
  private landTriVbo!: WebGLBuffer;
  private landLineVbo!: WebGLBuffer;

  private pointCount = 0;
  private landTriVertCount = 0;
  private landLineVertCount = 0;

  private center = [0.174, 0.392]; // California [x, y]
  private zoom = 4.2;
  private minMag = 2.5;

  private currentStyle: StylePalette = STYLES.dark;
  private showLand = true;
  private showBorders = true;
  private showPoints = true;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 unsupported');
    this.gl = gl;

    this.landProg = createProgram(gl, LAND_VS, LAND_FS);
    this.pointProg = createProgram(gl, POINT_VS, POINT_FS);

    this.initInteraction();
  }

  async loadData(url: string) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const view = new DataView(buf);

    if (view.getUint32(0) !== 0x4b504c52) {
      throw new Error('Invalid binary format');
    }

    this.pointCount = view.getUint32(4, true);
    this.landTriVertCount = view.getUint32(8, true);
    this.landLineVertCount = view.getUint32(12, true);

    const f32 = new Float32Array(buf, 16);
    const gl = this.gl;

    // 1. Point Buffer
    const pointData = f32.subarray(0, this.pointCount * 4);
    this.pointVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVbo);
    gl.bufferData(gl.ARRAY_BUFFER, pointData, gl.STATIC_DRAW);

    // 2. Land Triangles Buffer
    const landTriData = f32.subarray(this.pointCount * 4, this.pointCount * 4 + this.landTriVertCount * 2);
    this.landTriVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.landTriVbo);
    gl.bufferData(gl.ARRAY_BUFFER, landTriData, gl.STATIC_DRAW);

    // 3. Land Lines Buffer
    const landLineData = f32.subarray(this.pointCount * 4 + this.landTriVertCount * 2);
    this.landLineVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.landLineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, landLineData, gl.STATIC_DRAW);

    this.resize();
  }

  setStyle(styleKey: string) {
    if (STYLES[styleKey]) {
      this.currentStyle = STYLES[styleKey];
      this.draw();
    }
  }

  setLayerVisibility(layer: 'land' | 'borders' | 'points', visible: boolean) {
    if (layer === 'land') this.showLand = visible;
    if (layer === 'borders') this.showBorders = visible;
    if (layer === 'points') this.showPoints = visible;
    this.draw();
  }

  setMinMag(mag: number) {
    this.minMag = mag;
    this.draw();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.draw();
  }

  panBy(dx: number, dy: number) {
    const scale = Math.pow(2, this.zoom) * this.canvas.height;
    this.center[0] -= dx / scale;
    this.center[1] += dy / scale;
    this.draw();
  }

  zoomBy(delta: number) {
    this.zoom = Math.max(1.5, Math.min(14.0, this.zoom + delta));
    this.draw();
  }

  private initInteraction() {
    let dragging = false;
    let lx = 0;
    let ly = 0;

    this.canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      this.panBy(dx, dy);
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY * -0.002;
      this.zoomBy(delta);
    }, { passive: false });

    window.addEventListener('resize', () => this.resize());
  }

  draw() {
    const gl = this.gl;
    const style = this.currentStyle;

    gl.clearColor(style.ocean[0], style.ocean[1], style.ocean[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 1. Draw Land Polygons
    if (this.showLand && this.landTriVertCount > 0) {
      gl.useProgram(this.landProg);
      gl.uniform2f(gl.getUniformLocation(this.landProg, 'uCenter'), this.center[0], this.center[1]);
      gl.uniform1f(gl.getUniformLocation(this.landProg, 'uZoom'), this.zoom);
      gl.uniform2f(gl.getUniformLocation(this.landProg, 'uResolution'), this.canvas.width, this.canvas.height);
      gl.uniform4fv(gl.getUniformLocation(this.landProg, 'uColor'), style.land);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.landTriVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.landTriVertCount);
    }

    // 2. Draw Land Borders
    if (this.showBorders && this.landLineVertCount > 0) {
      gl.useProgram(this.landProg);
      gl.uniform2f(gl.getUniformLocation(this.landProg, 'uCenter'), this.center[0], this.center[1]);
      gl.uniform1f(gl.getUniformLocation(this.landProg, 'uZoom'), this.zoom);
      gl.uniform2f(gl.getUniformLocation(this.landProg, 'uResolution'), this.canvas.width, this.canvas.height);
      gl.uniform4fv(gl.getUniformLocation(this.landProg, 'uColor'), style.border);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.landLineVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.drawArrays(gl.LINES, 0, this.landLineVertCount);
    }

    // 3. Draw Points
    if (this.showPoints && this.pointCount > 0) {
      gl.useProgram(this.pointProg);
      gl.uniform2f(gl.getUniformLocation(this.pointProg, 'uCenter'), this.center[0], this.center[1]);
      gl.uniform1f(gl.getUniformLocation(this.pointProg, 'uZoom'), this.zoom);
      gl.uniform2f(gl.getUniformLocation(this.pointProg, 'uResolution'), this.canvas.width, this.canvas.height);
      gl.uniform1f(gl.getUniformLocation(this.pointProg, 'uMinMag'), this.minMag);
      gl.uniform1i(gl.getUniformLocation(this.pointProg, 'uRampMode'), style.pointRampMode);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.drawArrays(gl.POINTS, 0, this.pointCount);
    }
  }

  readPixel(x: number, y: number): [number, number, number, number] {
    const gl = this.gl;
    const px = new Uint8Array(4);
    gl.readPixels(x, gl.drawingBufferHeight - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2], px[3]];
  }
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<KeplerCustomStyleMap> {
  const map = new KeplerCustomStyleMap(canvas);
  await map.loadData(dataUrl);
  return map;
}
