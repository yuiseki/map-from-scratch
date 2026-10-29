// One-purpose WebGL2 taxi-trip animator. All segments and building triangles
// are uploaded once. Playback changes a time uniform, with partial segments
// clipped to the visible trail window in the vertex shader.
const BUILDING_VS = `#version 300 es
layout(location=0) in vec2 a_xy;
layout(location=1) in float a_height;
layout(location=2) in float a_shade;
uniform vec2 u_bmin, u_bspan, u_center, u_view;
uniform float u_world_px, u_meters_per_world, u_pitch, u_bearing;
out float v_shade;
void main() {
  vec2 world = u_bmin + a_xy * u_bspan;
  vec2 delta = (world - u_center) * u_world_px;
  float c = cos(u_bearing), s = sin(u_bearing);
  vec2 rotated = vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
  float height = a_height * 0.1 / u_meters_per_world * u_world_px;
  float y = rotated.y * cos(u_pitch) - height * sin(u_pitch);
  float depth = rotated.y * sin(u_pitch) + height * cos(u_pitch);
  gl_Position = vec4(rotated.x / (u_view.x * 0.5), -y / (u_view.y * 0.5),
                     clamp(-depth / (u_view.y * 4.0), -0.95, 0.95), 1.0);
  v_shade = a_shade;
}`;
const BUILDING_FS = `#version 300 es
precision highp float;
in float v_shade;
out vec4 o;
void main() { o = vec4(vec3(0.29, 0.37, 0.43) * v_shade, 1.0); }`;

const TRIP_VS = `#version 300 es
layout(location=0) in vec3 a_x0;
layout(location=1) in vec3 a_y0;
layout(location=2) in vec3 a_x1;
layout(location=3) in vec3 a_y1;
layout(location=4) in float a_time0;
layout(location=5) in float a_time1;
layout(location=6) in float a_vendor;
layout(location=7) in float a_gap;
uniform vec2 u_center, u_view;
uniform float u_world_px, u_pitch, u_bearing, u_time, u_trail, u_width;
out float v_age, v_vendor;
float decode24(vec3 b) { return dot(b, vec3(1.0, 256.0, 65536.0)) * 255.0 / 16777215.0; }
vec2 screenPos(vec2 world) {
  vec2 delta = (world - u_center) * u_world_px;
  float c = cos(u_bearing), s = sin(u_bearing);
  vec2 rotated = vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
  return vec2(rotated.x, rotated.y * cos(u_pitch));
}
void main() {
  float t0 = a_time0 * 0.1, t1 = a_time1 * 0.1;
  if (a_gap > 0.5 || t1 < u_time - u_trail || t0 > u_time) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); v_age = 1.0; v_vendor = a_vendor; return;
  }
  float span = max(0.001, t1 - t0);
  float lo = clamp((u_time - u_trail - t0) / span, 0.0, 1.0);
  float hi = clamp((u_time - t0) / span, 0.0, 1.0);
  vec2 p0 = vec2(decode24(a_x0), decode24(a_y0));
  vec2 p1 = vec2(decode24(a_x1), decode24(a_y1));
  vec2 a = screenPos(mix(p0, p1, lo));
  vec2 b = screenPos(mix(p0, p1, hi));
  vec2 delta = b - a;
  float len = length(delta);
  vec2 normal = len > 0.001 ? vec2(-delta.y, delta.x) / len : vec2(0.0, 1.0);
  int i = gl_VertexID % 6;
  bool end = i == 2 || i == 4 || i == 5;
  float side = i == 1 || i == 2 || i == 4 ? 1.0 : -1.0;
  vec2 pos = (end ? b : a) + normal * side * u_width * 0.5;
  gl_Position = vec4(pos.x / (u_view.x * 0.5), -pos.y / (u_view.y * 0.5),
                     clamp(-(end ? b.y : a.y) * tan(u_pitch) / (u_view.y * 4.0) - 0.0001, -0.95, 0.95), 1.0);
  v_age = clamp((u_time - mix(t0, t1, end ? hi : lo)) / max(1.0, u_trail), 0.0, 1.0);
  v_vendor = a_vendor;
}`;
const TRIP_FS = `#version 300 es
precision highp float;
in float v_age, v_vendor;
out vec4 o;
void main() {
  vec3 color = v_vendor < 0.5 ? vec3(1.0, 0.48, 0.28) : vec3(0.08, 0.72, 0.79);
  float alpha = pow(1.0 - v_age, 1.4) * 0.68;
  o = vec4(color, alpha);
}`;

interface Data { buffer: ArrayBuffer; count: number; objects: number; bounds: [number, number, number, number] }
async function load(url: string, magic: number, stride: number): Promise<Data> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`data HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== magic) throw new Error('invalid trips data');
  const count = head.getUint32(4, true), objects = head.getUint32(8, true);
  if (buffer.byteLength !== 32 + count * stride) throw new Error('truncated trips data');
  return { buffer, count, objects, bounds: [12, 16, 20, 24].map((o) => head.getFloat32(o, true)) as Data['bounds'] };
}
async function loadBuildings(url: string): Promise<Data & { indices: Uint16Array }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`building data HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== 0x33304442) throw new Error('invalid building data');
  const count = head.getUint32(4, true), indexCount = head.getUint32(8, true);
  if (buffer.byteLength < 32 + count * 8) throw new Error('truncated building data');
  const packed = new Uint8Array(buffer, 32 + count * 8);
  const indices = new Uint16Array(indexCount);
  let offset = 0, previous = 0;
  for (let i = 0; i < indexCount; i++) {
    let code = 0, shift = 0, byte = 0;
    do {
      if (offset >= packed.length || shift > 21) throw new Error('truncated building indices');
      byte = packed[offset++];
      code += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    previous += (code >>> 1) ^ -(code & 1);
    if (previous < 0 || previous >= count) throw new Error('invalid building index');
    indices[i] = previous;
  }
  if (offset !== packed.length) throw new Error('unexpected building index bytes');
  return {
    buffer, count, indices, objects: head.getUint32(28, true),
    bounds: [12, 16, 20, 24].map((o) => head.getFloat32(o, true)) as Data['bounds'],
  };
}

export type TripsMap = Awaited<ReturnType<typeof mount>>;
export async function mount(canvas: HTMLCanvasElement, tripsUrl: string, buildingsUrl: string) {
  const [tripData, buildingData] = await Promise.all([
    load(tripsUrl, 0x33305054, 10), loadBuildings(buildingsUrl),
  ]);
  const ctx = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!ctx) throw new Error('WebGL2 unavailable');
  const gl = ctx;
  const program = (vs: string, fs: string): WebGLProgram => {
    const p = gl.createProgram();
    if (!p) throw new Error('createProgram failed');
    for (const [kind, text] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error('createShader failed');
      gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed');
      gl.attachShader(p, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link failed');
    return p;
  };
  const buildingP = program(BUILDING_VS, BUILDING_FS);
  const tripP = program(TRIP_VS, TRIP_FS);
  const loc = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
  let uploads = 0;

  const buildingVao = gl.createVertexArray();
  if (!buildingVao) throw new Error('createVertexArray failed');
  gl.bindVertexArray(buildingVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(buildingData.buffer, 32, buildingData.count * 8), gl.STATIC_DRAW);
  uploads++;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, 8, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, false, 8, 4);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, true, 8, 6);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, buildingData.indices, gl.STATIC_DRAW);
  uploads++;

  const tripVao = gl.createVertexArray();
  if (!tripVao) throw new Error('createVertexArray failed');
  gl.bindVertexArray(tripVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(tripData.buffer, 32), gl.STATIC_DRAW);
  uploads++;
  for (let i = 0; i < 4; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 3, gl.UNSIGNED_BYTE, true, 10, i < 2 ? i * 3 : (i - 2) * 3 + 10);
    gl.vertexAttribDivisor(i, 1);
  }
  for (const [index, size, type, offset] of [
    [4, 1, gl.UNSIGNED_SHORT, 6], [5, 1, gl.UNSIGNED_SHORT, 16],
    [6, 1, gl.UNSIGNED_BYTE, 8], [7, 1, gl.UNSIGNED_BYTE, 9],
  ]) {
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, size, type, false, 10, offset);
    gl.vertexAttribDivisor(index, 1);
  }

  const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
  const cam = { x: (-74 + 180) / 360, y: mercY(40.72), zoom: 13, pitch: 45, bearing: 0 };
  const metersPerWorld = 40075016.686 * Math.cos(40.72 * Math.PI / 180);
  const worldPx = () => 512 * 2 ** cam.zoom;
  let time = 900, trail = 180;
  function draw() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.045, 0.075, 0.11, 1);
    gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(buildingP);
    gl.uniform2f(loc(buildingP, 'u_bmin'), buildingData.bounds[0], buildingData.bounds[1]);
    gl.uniform2f(loc(buildingP, 'u_bspan'), buildingData.bounds[2] - buildingData.bounds[0], buildingData.bounds[3] - buildingData.bounds[1]);
    gl.uniform2f(loc(buildingP, 'u_center'), cam.x, cam.y);
    gl.uniform2f(loc(buildingP, 'u_view'), canvas.width, canvas.height);
    gl.uniform1f(loc(buildingP, 'u_world_px'), worldPx());
    gl.uniform1f(loc(buildingP, 'u_meters_per_world'), metersPerWorld);
    gl.uniform1f(loc(buildingP, 'u_pitch'), cam.pitch * Math.PI / 180);
    gl.uniform1f(loc(buildingP, 'u_bearing'), cam.bearing * Math.PI / 180);
    gl.bindVertexArray(buildingVao);
    gl.drawElements(gl.TRIANGLES, buildingData.indices.length, gl.UNSIGNED_SHORT, 0);

    gl.useProgram(tripP);
    gl.uniform2f(loc(tripP, 'u_center'), cam.x, cam.y);
    gl.uniform2f(loc(tripP, 'u_view'), canvas.width, canvas.height);
    gl.uniform1f(loc(tripP, 'u_world_px'), worldPx());
    gl.uniform1f(loc(tripP, 'u_pitch'), cam.pitch * Math.PI / 180);
    gl.uniform1f(loc(tripP, 'u_bearing'), cam.bearing * Math.PI / 180);
    gl.uniform1f(loc(tripP, 'u_time'), time);
    gl.uniform1f(loc(tripP, 'u_trail'), trail);
    gl.uniform1f(loc(tripP, 'u_width'), 2 * devicePixelRatio);
    gl.bindVertexArray(tripVao);
    gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, tripData.count - 1);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
  }
  const resize = () => {
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    draw();
  };
  const inverseScreen = (x: number, y: number) => {
    const sx = x - canvas.width / 2, sy = (y - canvas.height / 2) / Math.cos(cam.pitch * Math.PI / 180);
    const a = cam.bearing * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: cam.x + (c * sx + s * sy) / worldPx(), y: cam.y + (-s * sx + c * sy) / worldPx() };
  };
  const screen = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * devicePixelRatio, y: (e.clientY - r.top) * devicePixelRatio };
  };
  let pending = false;
  const render = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  };
  let dragging: { x: number; y: number; shift: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => { dragging = { ...screen(e), shift: e.shiftKey }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { dragging = null; });
  canvas.addEventListener('pointercancel', () => { dragging = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = screen(e);
    if (dragging.shift) {
      cam.bearing += (p.x - dragging.x) * 0.25;
      cam.pitch = Math.max(0, Math.min(70, cam.pitch + (p.y - dragging.y) * 0.15));
    } else {
      const a = inverseScreen(dragging.x, dragging.y), b = inverseScreen(p.x, p.y);
      cam.x += a.x - b.x; cam.y += a.y - b.y;
    }
    dragging = { ...p, shift: dragging.shift };
    render();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = screen(e), before = inverseScreen(p.x, p.y);
    cam.zoom = Math.max(8, Math.min(16, cam.zoom - e.deltaY * 0.002));
    const after = inverseScreen(p.x, p.y);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    render();
  }, { passive: false });
  new ResizeObserver(resize).observe(canvas);
  resize();
  return {
    gl, cam, draw,
    trips: tripData.objects, segments: new DataView(tripData.buffer).getUint32(28, true),
    buildings: buildingData.objects, buildingVertices: buildingData.count, buildingIndices: buildingData.indices.length,
    get uploads() { return uploads; },
    get time() { return time; },
    get trail() { return trail; },
    setTime: (value: number) => { time = Math.max(0, Math.min(1800, value)); draw(); },
    setTrail: (value: number) => { trail = Math.max(10, Math.min(500, value)); draw(); },
  };
}
