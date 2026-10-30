// A dedicated fixed-data WebGL2 cluster renderer. Aggregate once per integer
// zoom; camera movement only changes uniforms and reuses the same GPU buffer.
type Point = { x: number; y: number; mag: number; tsunami: boolean };
type Cluster = { x: number; y: number; count: number; first: number };

const VS = `#version 300 es
layout(location=0) in vec4 a_cluster;
uniform vec2 u_center, u_view;
uniform float u_world_px, u_dpr;
out float v_count;
void main() {
  vec2 delta = (a_cluster.xy - u_center) * u_world_px;
  gl_Position = vec4(delta.x / (u_view.x * 0.5), -delta.y / (u_view.y * 0.5), 0.0, 1.0);
  v_count = a_cluster.z;
  gl_PointSize = (a_cluster.z < 1.5 ? 10.0 : a_cluster.z < 100.0 ? 40.0 : a_cluster.z < 750.0 ? 60.0 : 80.0) * u_dpr;
}`;
const FS = `#version 300 es
precision highp float;
in float v_count;
out vec4 o;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r > 1.0) discard;
  vec3 color = v_count < 1.5 ? vec3(0.067, 0.706, 0.855) :
               v_count < 100.0 ? vec3(0.318, 0.733, 0.839) :
               v_count < 750.0 ? vec3(0.945, 0.941, 0.459) : vec3(0.949, 0.549, 0.694);
  float edge = v_count < 1.5 ? 0.66 : 0.91;
  color = mix(color, vec3(0.97, 0.99, 1.0), smoothstep(edge, edge + 0.04, r));
  o = vec4(color, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  return shader;
}
const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const radius = (count: number) => count === 1 ? 5 : count < 100 ? 20 : count < 750 ? 30 : 40;

export type ClusterMap = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, labels: HTMLCanvasElement, land: HTMLCanvasElement,
  url: string, landUrl: string) {
  const [response, landResponse] = await Promise.all([fetch(url), fetch(landUrl)]);
  if (!response.ok || !landResponse.ok) throw new Error(`data HTTP ${response.status} / ${landResponse.status}`);
  const [buffer, polygons] = await Promise.all([
    response.arrayBuffer(), landResponse.json() as Promise<number[][][][]>,
  ]);
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x31305145) throw new Error('invalid earthquake data');
  const count = view.getUint32(4, true);
  if (buffer.byteLength !== 16 + count * 16) throw new Error('truncated earthquake data');
  const points: Point[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const at = 16 + i * 16;
    points[i] = { x: view.getFloat32(at, true), y: view.getFloat32(at + 4, true),
      mag: view.getFloat32(at + 8, true), tsunami: view.getUint32(at + 12, true) === 1 };
  }

  const levels: Cluster[][] = [];
  for (let z = 0; z <= 14; z++) {
    const scale = 512 * 2 ** z / 50;
    const bins = new Map<string, Cluster>();
    for (let i = 0; i < count; i++) {
      const p = points[i];
      const key = `${Math.floor(p.x * scale)}:${Math.floor(p.y * scale)}`;
      const cell = bins.get(key);
      if (cell) { cell.x += p.x; cell.y += p.y; cell.count++; }
      else bins.set(key, { x: p.x, y: p.y, count: 1, first: i });
    }
    levels.push([...bins.values()].map((c) => ({ ...c, x: c.x / c.count, y: c.y / c.count })));
  }
  levels.push(points.map((p, i) => ({ x: p.x, y: p.y, count: 1, first: i })));

  const maybeGl = canvas.getContext('webgl2', { antialias: false, alpha: true });
  const maybeCtx = labels.getContext('2d');
  const maybeLandCtx = land.getContext('2d');
  if (!maybeGl || !maybeCtx || !maybeLandCtx) throw new Error('WebGL2 or Canvas2D unavailable');
  const gl: WebGL2RenderingContext = maybeGl;
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const landCtx: CanvasRenderingContext2D = maybeLandCtx;
  const landPaths = polygons.map((rings) => {
    const path = new Path2D();
    for (const ring of rings) {
      if (!ring.length) continue;
      path.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) path.lineTo(ring[i][0], ring[i][1]);
      path.closePath();
    }
    return path;
  });
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  const vertex = compile(gl, gl.VERTEX_SHADER, VS), fragment = compile(gl, gl.FRAGMENT_SHADER, FS);
  gl.attachShader(program, vertex); gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  const vao = gl.createVertexArray(), gpuBuffer = gl.createBuffer();
  if (!vao || !gpuBuffer) throw new Error('GPU buffer allocation failed');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpuBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const cam = { x: mercX(-103.5918), y: mercY(40.66996), zoom: 3 };
  let activeLevel = -1;
  let current: Cluster[] = [];
  let labelOrder: Cluster[] = [];
  let uploadMs = 0;
  let shownStatus = '';
  const worldPx = () => 512 * 2 ** cam.zoom;
  const levelOf = () => Math.max(0, Math.min(15, Math.floor(cam.zoom)));
  const toScreen = (p: { x: number; y: number }) => ({ x: canvas.width / 2 + (p.x - cam.x) * worldPx(), y: canvas.height / 2 + (p.y - cam.y) * worldPx() });
  // The world copies the screen spans: k shifts a world x by whole worlds.
  const copies = (): number[] => {
    const half = canvas.width / 2 / worldPx(), out: number[] = [];
    for (let k = Math.floor(cam.x - half); k <= Math.floor(cam.x + half); k++) out.push(k);
    return out;
  };
  const fromScreen = (x: number, y: number) => ({ x: cam.x + (x - canvas.width / 2) / worldPx(), y: cam.y + (y - canvas.height / 2) / worldPx() });
  function upload() {
    const z = levelOf();
    if (z === activeLevel) return;
    const started = performance.now();
    current = levels[z];
    labelOrder = current.filter((c) => c.count > 1).sort((a, b) => b.count - a.count);
    const instances = new Float32Array(current.length * 4);
    for (let i = 0; i < current.length; i++) {
      const c = current[i], at = i * 4;
      instances[at] = c.x; instances[at + 1] = c.y;
      instances[at + 2] = c.count; instances[at + 3] = c.first;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gpuBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);
    activeLevel = z;
    uploadMs = performance.now() - started;
  }
  function drawGraticule() {
    ctx.clearRect(0, 0, labels.width, labels.height);
    ctx.strokeStyle = '#8fb0be39'; ctx.lineWidth = devicePixelRatio;
    ctx.fillStyle = '#b7cfda99'; ctx.font = `${11 * devicePixelRatio}px system-ui`;
    // The step that keeps lines and labels at least 60 px apart (a fixed 10 deg
    // below zoom 4 put labels on top of each other at zoom 0).
    const step = [0.5, 1, 2, 5, 10, 30, 60].find((d) => (d / 360) * worldPx() >= 60 * devicePixelRatio) ?? 90;
    const minX = cam.x - canvas.width / 2 / worldPx(), maxX = cam.x + canvas.width / 2 / worldPx();
    const minY = cam.y - canvas.height / 2 / worldPx(), maxY = cam.y + canvas.height / 2 / worldPx();
    for (let lon = Math.ceil((minX * 360 - 180) / step) * step; lon <= maxX * 360 - 180; lon += step) {
      const x = toScreen({ x: mercX(lon), y: cam.y }).x;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, labels.height); ctx.stroke();
      const label = ((((lon + 180) % 360) + 360) % 360) - 180;   // -370 is 350 W of the next world: say -10
      ctx.fillText(`${label.toFixed(step < 1 ? 1 : 0)}°`, x + 3, labels.height - 12 * devicePixelRatio);
    }
    for (let lat = -Math.floor(80 / step) * step; lat <= 80; lat += step) {
      const yWorld = mercY(lat);
      if (yWorld < minY || yWorld > maxY) continue;
      const y = toScreen({ x: cam.x, y: yWorld }).y;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(labels.width, y); ctx.stroke();
      ctx.fillText(`${lat.toFixed(step < 1 ? 1 : 0)}°`, labels.width - 54 * devicePixelRatio, y - 4);
    }
  }
  function drawLand() {
    landCtx.setTransform(1, 0, 0, 1, 0, 0);
    landCtx.clearRect(0, 0, land.width, land.height);
    const scale = worldPx();
    landCtx.fillStyle = '#1c3c4b';
    landCtx.strokeStyle = '#698999';
    landCtx.lineWidth = devicePixelRatio / scale;
    // One copy per world the screen spans, or the land ends at 180°.
    const half = land.width / 2 / scale;
    for (let k = Math.floor(cam.x - half); k <= Math.floor(cam.x + half); k++) {
      landCtx.setTransform(scale, 0, 0, scale, land.width / 2 - (cam.x - k) * scale, land.height / 2 - cam.y * scale);
      for (const path of landPaths) {
        landCtx.fill(path, 'evenodd');
        landCtx.stroke(path);
      }
    }
    landCtx.setTransform(1, 0, 0, 1, 0, 0);
  }
  function draw() {
    upload();
    const status = `${count.toLocaleString('ja-JP')} 地点 · ズーム ${cam.zoom.toFixed(1)} · ${current.length.toLocaleString('ja-JP')} 個の円`;
    if (status !== shownStatus) {
      const node = document.getElementById('status');
      if (node) node.textContent = status;
      shownStatus = status;
    }
    drawLand();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uniform('u_center'), cam.x, cam.y);
    gl.uniform2f(uniform('u_view'), canvas.width, canvas.height);
    gl.uniform1f(uniform('u_world_px'), worldPx());
    gl.uniform1f(uniform('u_dpr'), devicePixelRatio);
    gl.bindVertexArray(vao);
    for (const k of copies()) {
      gl.uniform2f(uniform('u_center'), cam.x - k, cam.y);
      gl.drawArrays(gl.POINTS, 0, current.length);
    }
    drawGraticule();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${12 * devicePixelRatio}px system-ui`;
    ctx.fillStyle = '#132b39';
    const occupied: { x: number; y: number }[] = [];
    for (const k of copies()) for (const c of labelOrder) {
      const p = toScreen({ x: c.x + k, y: c.y }), r = radius(c.count) * devicePixelRatio;
      if (p.x < -r || p.x > canvas.width + r || p.y < -r || p.y > canvas.height + r) continue;
      if (occupied.some((q) => Math.abs(q.x - p.x) < 24 * devicePixelRatio && Math.abs(q.y - p.y) < 15 * devicePixelRatio)) continue;
      ctx.fillText(c.count >= 1000 ? `${(c.count / 1000).toFixed(1)}k` : String(c.count), p.x, p.y);
      occupied.push(p);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  function resize() {
    const dpr = devicePixelRatio;
    canvas.width = labels.width = land.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = labels.height = land.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    draw();
  }
  const eventPixel = (e: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * devicePixelRatio, y: (e.clientY - rect.top) * devicePixelRatio };
  };
  const hit = (x: number, y: number): Cluster | undefined => {
    let best: Cluster | undefined, distance = Infinity;
    for (const k of copies()) for (const c of current) {
      const p = toScreen({ x: c.x + k, y: c.y }), d = Math.hypot(p.x - x, p.y - y);
      if (d <= radius(c.count) * devicePixelRatio + 2 && d < distance) { best = c; distance = d; }
    }
    return best;
  };
  function expand(c: Cluster) {
    for (let z = levelOf() + 1; z <= 15; z++) {
      const child = levels[z].find((item) => item.first === c.first);
      if (child && child.count < c.count) { cam.zoom = z; break; }
    }
    cam.x = c.x; cam.y = c.y;
    draw();
  }
  let pending = false;
  const requestDraw = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  };
  // sx, sy: where the press started; a click survives 3 CSS px of movement from it.
  let drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    const p0 = eventPixel(e);
    drag = { ...p0, sx: p0.x, sy: p0.y, moved: false }; canvas.setPointerCapture(e.pointerId);
    document.getElementById('popup')!.style.display = 'none';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = eventPixel(e), dx = p.x - drag.x, dy = p.y - drag.y;
    if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 3 * devicePixelRatio) drag.moved = true;
    cam.x -= dx / worldPx(); cam.y -= dy / worldPx();
    drag.x = p.x; drag.y = p.y; requestDraw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const wasMoved = drag.moved; drag = null;
    if (wasMoved) return;
    const p = eventPixel(e), c = hit(p.x, p.y);
    if (!c) return;
    if (c.count > 1) { expand(c); return; }
    const point = points[c.first], popup = document.getElementById('popup')!;
    popup.textContent = `M ${Number.isFinite(point.mag) ? point.mag.toFixed(1) : '不明'} · 津波 ${point.tsunami ? 'あり' : 'なし'}`;
    popup.style.left = `${e.clientX + 14}px`; popup.style.top = `${e.clientY + 14}px`;
    popup.style.display = 'block';
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = eventPixel(e), before = fromScreen(p.x, p.y);
    cam.zoom = Math.max(0, Math.min(18, cam.zoom - e.deltaY * 0.002));
    const after = fromScreen(p.x, p.y);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    requestDraw();
  }, { passive: false });
  new ResizeObserver(resize).observe(canvas);
  resize();
  return { gl, cam, draw, count, levels, hit, expand,
    get clusters() { return current.length; },
    get uploadMs() { return uploadMs; },
    sumCounts: () => current.reduce((sum, c) => sum + c.count, 0),
  };
}
