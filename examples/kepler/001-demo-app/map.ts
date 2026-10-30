// examples/kepler/001-demo-app/map.ts

export interface KeplerMap {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  pointCount: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  getZoom(): number;
  setCenter(lng: number, lat: number): void;
  setPitch(pitchRad: number): void;
  getPitch(): number;
  setMinMagnitude(minMag: number): void;
  setLayerVisible(visible: boolean): void;
  readPixel(x: number, y: number): [number, number, number, number];
  resize(): void;
  destroy(): void;
}

function projectMercator(lon: number, lat: number): [number, number] {
  const x = (lon + 180) / 360;
  const sin = Math.sin((lat * Math.PI) / 180);
  const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
  const y = 0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI);
  return [x, y];
}

const LAND_VS = `#version 300 es
precision highp float;
in vec2 aPos;
uniform vec2 uCenter;
uniform float uZoom;
uniform vec2 uViewport;
uniform float uPitch;

void main() {
  vec2 diff = aPos - uCenter;
  diff.x = diff.x - floor(diff.x + 0.5);
  float scale = 256.0 * exp2(uZoom);
  vec2 px = diff * scale;

  float cosP = cos(uPitch);
  float sinP = sin(uPitch);
  float z = -px.y * sinP;
  float y = px.y * cosP;
  float d = 1200.0;
  float perspective = d / max(1.0, d + z);
  vec2 tiltedPx = vec2(px.x, y) * perspective;

  vec2 clip = (tiltedPx / (uViewport * 0.5));
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const LAND_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 fragColor;
void main() {
  fragColor = uColor;
}
`;

const POINTS_VS = `#version 300 es
precision highp float;
in vec4 aPoint; // x, y, mag, depth
uniform vec2 uCenter;
uniform float uZoom;
uniform vec2 uViewport;
uniform float uPitch;
uniform float uMinMag;
out float vMag;

void main() {
  float mag = aPoint.z;
  if (mag < uMinMag) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vMag = mag;
  vec2 diff = aPoint.xy - uCenter;
  diff.x = diff.x - floor(diff.x + 0.5);
  float scale = 256.0 * exp2(uZoom);
  vec2 px = diff * scale;

  float cosP = cos(uPitch);
  float sinP = sin(uPitch);
  float z = -px.y * sinP;
  float y = px.y * cosP;
  float d = 1200.0;
  float perspective = d / max(1.0, d + z);
  vec2 tiltedPx = vec2(px.x, y) * perspective;

  vec2 clip = (tiltedPx / (uViewport * 0.5));
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  float baseSize = 3.0 + (mag - 2.5) * 3.5;
  gl_PointSize = clamp(baseSize * perspective, 2.5, 48.0);
}
`;

const POINTS_FS = `#version 300 es
precision mediump float;
in float vMag;
out vec4 fragColor;

vec3 getMagmaColor(float t) {
  if (t < 0.25) {
    return mix(vec3(0.99, 0.90, 0.14), vec3(0.98, 0.64, 0.36), t / 0.25);
  } else if (t < 0.50) {
    return mix(vec3(0.98, 0.64, 0.36), vec3(0.89, 0.35, 0.20), (t - 0.25) / 0.25);
  } else if (t < 0.75) {
    return mix(vec3(0.89, 0.35, 0.20), vec3(0.71, 0.18, 0.42), (t - 0.50) / 0.25);
  } else {
    return mix(vec3(0.71, 0.18, 0.42), vec3(0.45, 0.12, 0.51), (t - 0.75) / 0.25);
  }
}

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  float alpha = smoothstep(0.5, 0.3, dist);

  float t = clamp((vMag - 2.5) / 4.5, 0.0, 1.0);
  vec3 rgb = getMagmaColor(t);
  fragColor = vec4(rgb, alpha * 0.85);
}
`;

function createShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('Failed to create program');
  const v = createShader(gl, gl.VERTEX_SHADER, vs);
  const f = createShader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(p);
    throw new Error(`Program link error: ${info}`);
  }
  return p;
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<KeplerMap> {
  const glCtx = canvas.getContext('webgl2', {
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  });
  if (!glCtx) throw new Error('WebGL2 context not supported');
  const gl: WebGL2RenderingContext = glCtx;

  // Load binary data
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`Failed to fetch data: ${res.status}`);
  const arrayBuf = await res.arrayBuffer();

  const view = new DataView(arrayBuf);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'KPLR') throw new Error(`Invalid magic: ${magic}`);

  const pointCount = view.getUint32(6, true);
  const landTriCount = view.getUint32(10, true);
  const landLineCount = view.getUint32(14, true);

  const headerSize = 32;
  const pointOffset = headerSize;
  const triOffset = pointOffset + pointCount * 16;
  const lineOffset = triOffset + landTriCount * 2 * 4;

  const pointsData = new Float32Array(arrayBuf, pointOffset, pointCount * 4);
  const landTriData = new Float32Array(arrayBuf, triOffset, landTriCount * 2);
  const landLineData = new Float32Array(arrayBuf, lineOffset, landLineCount * 2);

  // Setup Buffers & VAOs
  const landProg = createProgram(gl, LAND_VS, LAND_FS);
  const landTriVAO = gl.createVertexArray();
  const landTriVBO = gl.createBuffer();
  gl.bindVertexArray(landTriVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, landTriVBO);
  gl.bufferData(gl.ARRAY_BUFFER, landTriData, gl.STATIC_DRAW);
  const landTriPosLoc = gl.getAttribLocation(landProg, 'aPos');
  gl.enableVertexAttribArray(landTriPosLoc);
  gl.vertexAttribPointer(landTriPosLoc, 2, gl.FLOAT, false, 0, 0);

  const landLineVAO = gl.createVertexArray();
  const landLineVBO = gl.createBuffer();
  gl.bindVertexArray(landLineVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, landLineVBO);
  gl.bufferData(gl.ARRAY_BUFFER, landLineData, gl.STATIC_DRAW);
  const landLinePosLoc = gl.getAttribLocation(landProg, 'aPos');
  gl.enableVertexAttribArray(landLinePosLoc);
  gl.vertexAttribPointer(landLinePosLoc, 2, gl.FLOAT, false, 0, 0);

  const pointsProg = createProgram(gl, POINTS_VS, POINTS_FS);
  const pointsVAO = gl.createVertexArray();
  const pointsVBO = gl.createBuffer();
  gl.bindVertexArray(pointsVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointsVBO);
  gl.bufferData(gl.ARRAY_BUFFER, pointsData, gl.STATIC_DRAW);
  const pointAttrLoc = gl.getAttribLocation(pointsProg, 'aPoint');
  gl.enableVertexAttribArray(pointAttrLoc);
  gl.vertexAttribPointer(pointAttrLoc, 4, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);

  // Initial map state (California Coast: -122.8, 37.0588, zoom 5.75)
  const [initMx, initMy] = projectMercator(-122.8, 37.0588);
  let centerMx = initMx;
  let centerMy = initMy;
  let zoom = 5.75;
  let pitch = 0;
  let minMag = 2.5;
  let layerVisible = true;

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw();
  }

  function draw(): void {
    const w = canvas.width;
    const h = canvas.height;

    // Kepler Dark Ocean: #131519
    gl.clearColor(0.075, 0.082, 0.098, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 1. Draw Land Polygons
    gl.useProgram(landProg);
    const uCenterLoc = gl.getUniformLocation(landProg, 'uCenter');
    const uZoomLoc = gl.getUniformLocation(landProg, 'uZoom');
    const uViewportLoc = gl.getUniformLocation(landProg, 'uViewport');
    const uPitchLoc = gl.getUniformLocation(landProg, 'uPitch');
    const uColorLoc = gl.getUniformLocation(landProg, 'uColor');

    gl.uniform2f(uCenterLoc, centerMx, centerMy);
    gl.uniform1f(uZoomLoc, zoom);
    gl.uniform2f(uViewportLoc, w, h);
    gl.uniform1f(uPitchLoc, pitch);

    // Land Fill: #1e2229
    gl.uniform4f(uColorLoc, 0.118, 0.133, 0.161, 1.0);
    gl.bindVertexArray(landTriVAO);
    gl.drawArrays(gl.TRIANGLES, 0, landTriCount);

    // Land Coastlines: #2a313d
    gl.uniform4f(uColorLoc, 0.165, 0.192, 0.239, 1.0);
    gl.bindVertexArray(landLineVAO);
    gl.drawArrays(gl.LINES, 0, landLineCount);

    // 2. Draw Earthquake Points
    if (layerVisible && pointCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(pointsProg);
      const pCenterLoc = gl.getUniformLocation(pointsProg, 'uCenter');
      const pZoomLoc = gl.getUniformLocation(pointsProg, 'uZoom');
      const pViewportLoc = gl.getUniformLocation(pointsProg, 'uViewport');
      const pPitchLoc = gl.getUniformLocation(pointsProg, 'uPitch');
      const pMinMagLoc = gl.getUniformLocation(pointsProg, 'uMinMag');

      gl.uniform2f(pCenterLoc, centerMx, centerMy);
      gl.uniform1f(pZoomLoc, zoom);
      gl.uniform2f(pViewportLoc, w, h);
      gl.uniform1f(pPitchLoc, pitch);
      gl.uniform1f(pMinMagLoc, minMag);

      gl.bindVertexArray(pointsVAO);
      gl.drawArrays(gl.POINTS, 0, pointCount);

      gl.disable(gl.BLEND);
    }
  }

  function panBy(dx: number, dy: number): void {
    const scale = 256.0 * Math.pow(2, zoom);
    centerMx -= dx / scale;
    centerMy -= dy / scale;
    draw();
  }

  function setZoom(z: number): void {
    zoom = Math.max(1, Math.min(20, z));
    draw();
  }

  function getZoom(): number {
    return zoom;
  }

  function setCenter(lng: number, lat: number): void {
    const [mx, my] = projectMercator(lng, lat);
    centerMx = mx;
    centerMy = my;
    draw();
  }

  function setPitch(pitchRad: number): void {
    pitch = pitchRad;
    draw();
  }

  function getPitch(): number {
    return pitch;
  }

  function setMinMagnitude(m: number): void {
    minMag = m;
    draw();
  }

  function setLayerVisible(visible: boolean): void {
    layerVisible = visible;
    draw();
  }

  function readPixel(x: number, y: number): [number, number, number, number] {
    const pixel = new Uint8Array(4);
    // In WebGL, bottom-left is (0, 0)
    const glY = canvas.height - y - 1;
    gl.readPixels(x, glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [pixel[0], pixel[1], pixel[2], pixel[3]];
  }

  function destroy(): void {
    gl.deleteProgram(landProg);
    gl.deleteProgram(pointsProg);
    gl.deleteBuffer(landTriVBO);
    gl.deleteBuffer(landLineVBO);
    gl.deleteBuffer(pointsVBO);
    gl.deleteVertexArray(landTriVAO);
    gl.deleteVertexArray(landLineVAO);
    gl.deleteVertexArray(pointsVAO);
  }

  // Pointer interactions
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dpr = window.devicePixelRatio || 1;
    const dx = (e.clientX - lastX) * dpr;
    const dy = (e.clientY - lastY) * dpr;
    lastX = e.clientX;
    lastY = e.clientY;
    panBy(dx, dy);
  });

  canvas.addEventListener('pointerup', (e) => {
    if (isDragging) {
      isDragging = false;
      canvas.releasePointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom(zoom + Math.log2(factor));
  }, { passive: false });

  window.addEventListener('resize', resize);
  resize();

  return {
    canvas,
    gl,
    pointCount,
    draw,
    panBy,
    setZoom,
    getZoom,
    setCenter,
    setPitch,
    getPitch,
    setMinMagnitude,
    setLayerVisible,
    readPixel,
    resize,
    destroy,
  };
}
