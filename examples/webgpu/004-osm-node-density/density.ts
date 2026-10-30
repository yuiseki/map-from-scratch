// Point density of every OSM node in Tokyo's 23 wards, recounted at screen
// resolution on every frame: the request of 04-osm-node-density, counted with
// WebGPU compute instead of additive blending. One frame is
//   1. a compute pass of three dispatches:
//      clear the per-pixel counts, atomicAdd every point into its pixel,
//      reduce the counts to their max (one atomicMax per workgroup)
//   2. a render pass colouring log(1 + count) / log(1 + max)
// The data, the camera, the point order and the colours are 04's, so the two
// differ only in how the counting is done. Nothing goes back to the CPU.

// TypeScript's DOM types have the GPU* interfaces but not the constant
// objects, so the flags are spelled out.
const STORAGE = 0x80, UNIFORM = 0x40, COPY_SRC = 0x4, COPY_DST = 0x8, MAP_READ = 0x1;
const RENDER_ATTACHMENT = 0x10, TEX_COPY_SRC = 0x01;

const COUNT_WGSL = /* wgsl */ `
struct Cam { center: vec2f, scale: f32, n: u32, size: vec2u }
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> pts: array<u32>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> peak: atomic<u32>;
var<workgroup> wmax: atomic<u32>;

@compute @workgroup_size(256)
fn clear(@builtin(global_invocation_id) g: vec3u) {
  if (g.x == 0u) { atomicStore(&peak, 0u); }
  if (g.x < cam.size.x * cam.size.y) { atomicStore(&counts[g.x], 0u); }
}

// The pixel whose square holds the point, as WebGL rasterises a 1 px point.
@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= cam.n) { return; }
  let q = pts[g.x];
  let a = vec2f(f32(q & 0xffffu), f32(q >> 16u)) / 65535.0;
  let p = (a - cam.center) * cam.scale + vec2f(cam.size) * 0.5;
  if (any(p < vec2f(0.0)) || any(p >= vec2f(cam.size))) { return; }
  let c = vec2u(p);
  atomicAdd(&counts[c.y * cam.size.x + c.x], 1u);
}

@compute @workgroup_size(256)
fn reduce(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) l: u32) {
  if (l == 0u) { atomicStore(&wmax, 0u); }
  workgroupBarrier();
  if (g.x < cam.size.x * cam.size.y) { atomicMax(&wmax, atomicLoad(&counts[g.x])); }
  workgroupBarrier();
  if (l == 0u) { atomicMax(&peak, atomicLoad(&wmax)); }
}
`;

const COLOR_WGSL = /* wgsl */ `
struct Cam { center: vec2f, scale: f32, n: u32, size: vec2u }
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> counts: array<u32>;
@group(0) @binding(2) var<storage, read> peak: u32;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(select(-1.0, 3.0, i == 1u), select(-1.0, 3.0, i == 2u), 0.0, 1.0);
}

// 04's ramp: black, purple, orange, pale yellow.
@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = f32(counts[u32(pos.y) * cam.size.x + u32(pos.x)]);
  let t = log(1.0 + c) / log(1.0 + max(f32(peak), 1.0));
  var col = mix(mix(vec3f(0.23, 0.06, 0.44), vec3f(0.96, 0.42, 0.24), smoothstep(0.0, 0.6, t)), vec3f(0.99, 0.95, 0.74), smoothstep(0.6, 1.0, t));
  if (c == 0.0) { col = vec3f(0.03, 0.03, 0.06); }
  return vec4f(col, 1.0);
}
`;

// Where the bench wants the frame's first and last GPU timestamps.
export interface Timestamps { begin: GPUComputePassTimestampWrites; end: GPURenderPassTimestampWrites }

export type DensityMap = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, url: string) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU unavailable');
  // Only the bench reads timestamps, but the feature costs nothing unused.
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
  });
  device.lost.then((e) => console.error('WebGPU device lost:', e.message));
  const gpu = `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();

  const bin = await fetch(url).then((r) => r.arrayBuffer());
  const n = new Uint32Array(bin, 0, 1)[0];
  const bbox = new Float64Array(bin, 8, 4);
  const dx = new Uint16Array(bin, 40, n), dy = new Uint16Array(bin, 40 + n * 2, n);
  // Undo the delta coding and deal the Morton-ordered points out across S
  // strides, as 04 does for its blending. The same order keeps the two
  // renderers' inputs identical.
  const S = 128;
  const per = Math.ceil(n / S);
  const pos = new Uint32Array(n);
  for (let i = 0, x = 0, y = 0; i < n; i++) {
    x = (x + dx[i]) & 0xffff;
    y = (y + dy[i]) & 0xffff;
    pos[(i % S) * per + Math.floor(i / S)] = x | (y << 16);
  }
  const pts = device.createBuffer({ size: pos.byteLength, usage: STORAGE, mappedAtCreation: true });
  new Uint32Array(pts.getMappedRange()).set(pos);
  pts.unmap();

  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctx) throw new Error('WebGPU canvas unavailable');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque', usage: RENDER_ATTACHMENT | TEX_COPY_SRC });

  const camBuf = device.createBuffer({ size: 32, usage: UNIFORM | COPY_DST });
  const peak = device.createBuffer({ size: 4, usage: STORAGE | COPY_SRC });
  const countModule = device.createShaderModule({ code: COUNT_WGSL });
  const pipe = (entryPoint: string) => device.createComputePipeline({ layout: 'auto', compute: { module: countModule, entryPoint } });
  const clearP = pipe('clear'), countP = pipe('count'), reduceP = pipe('reduce');
  const colorModule = device.createShaderModule({ code: COLOR_WGSL });
  const colorP = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: colorModule, entryPoint: 'vs' },
    fragment: { module: colorModule, entryPoint: 'fs', targets: [{ format }] },
  });

  // Per canvas size: the counts, their bind groups and the offscreen target
  // the bench draws timed frames into.
  let w = 0, h = 0;
  let counts: GPUBuffer, offscreen: GPUTexture, colorBG: GPUBindGroup;
  let clearBG: GPUBindGroup, countBG: GPUBindGroup, reduceBG: GPUBindGroup;
  function resize() {
    counts?.destroy();
    offscreen?.destroy();
    w = canvas.width; h = canvas.height;
    counts = device.createBuffer({ size: w * h * 4, usage: STORAGE | COPY_SRC });
    offscreen = device.createTexture({ size: [w, h], format, usage: RENDER_ATTACHMENT | TEX_COPY_SRC });
    // 'auto' layouts hold only the bindings each entry point uses.
    clearBG = device.createBindGroup({ layout: clearP.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: camBuf } }, { binding: 2, resource: { buffer: counts } }, { binding: 3, resource: { buffer: peak } }] });
    countBG = device.createBindGroup({ layout: countP.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: camBuf } }, { binding: 1, resource: { buffer: pts } }, { binding: 2, resource: { buffer: counts } }] });
    reduceBG = device.createBindGroup({ layout: reduceP.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: camBuf } }, { binding: 2, resource: { buffer: counts } }, { binding: 3, resource: { buffer: peak } }] });
    colorBG = device.createBindGroup({ layout: colorP.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: camBuf } }, { binding: 1, resource: { buffer: counts } }, { binding: 2, resource: { buffer: peak } }] });
  }

  const cam = { x: 0.5, y: 0.5, zoom: 1 };   // zoom 1: the whole grid fits
  const scale = () => cam.zoom * Math.min(canvas.width, canvas.height);
  const camData = new ArrayBuffer(32);

  function draw(ts?: Timestamps, toOffscreen = false) {
    const f = new Float32Array(camData), u = new Uint32Array(camData);
    f[0] = cam.x; f[1] = cam.y; f[2] = scale(); u[3] = n; u[4] = w; u[5] = h;
    device.queue.writeBuffer(camBuf, 0, camData);
    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass(ts && { timestampWrites: ts.begin });
    const pixels = Math.ceil((w * h) / 256);
    cp.setPipeline(clearP); cp.setBindGroup(0, clearBG); cp.dispatchWorkgroups(pixels);
    cp.setPipeline(countP); cp.setBindGroup(0, countBG); cp.dispatchWorkgroups(Math.ceil(n / 256));
    cp.setPipeline(reduceP); cp.setBindGroup(0, reduceBG); cp.dispatchWorkgroups(pixels);
    cp.end();
    const target = toOffscreen ? offscreen : ctx!.getCurrentTexture();
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      timestampWrites: ts?.end,
    });
    rp.setPipeline(colorP); rp.setBindGroup(0, colorBG); rp.draw(3);
    rp.end();
    device.queue.submit([enc.finish()]);
  }

  // Copies a buffer or the drawn canvas back. The canvas is drawn again in
  // the same task: a presented canvas texture reads back as zeros.
  async function readBuffer(src: GPUBuffer | null, size: number, bytesPerRow = 0): Promise<ArrayBuffer> {
    const read = device.createBuffer({ size, usage: COPY_DST | MAP_READ });
    const enc = device.createCommandEncoder();
    if (src) enc.copyBufferToBuffer(src, 0, read, 0, size);
    else {
      draw();
      enc.copyTextureToBuffer({ texture: ctx!.getCurrentTexture() }, { buffer: read, bytesPerRow }, [w, h]);
    }
    device.queue.submit([enc.finish()]);
    await read.mapAsync(MAP_READ);
    const out = read.getMappedRange().slice(0);
    read.destroy();
    return out;
  }
  const readCounts = async () => new Uint32Array(await readBuffer(counts, w * h * 4));
  // RGBA rows, top first, whatever the canvas format.
  async function readScreen(): Promise<Uint8Array> {
    const row = Math.ceil((w * 4) / 256) * 256;
    const raw = new Uint8Array(await readBuffer(null, row * h, row));
    const out = new Uint8Array(w * h * 4), bgra = format === 'bgra8unorm';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = y * row + x * 4, d = (y * w + x) * 4;
        out[d] = raw[s + (bgra ? 2 : 0)]; out[d + 1] = raw[s + 1]; out[d + 2] = raw[s + (bgra ? 0 : 2)]; out[d + 3] = raw[s + 3];
      }
    }
    return out;
  }

  let pending = false;
  const render = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; draw(); }); } };
  const dev = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio];
  };
  const toGrid = ([sx, sy]: [number, number]): [number, number] => [cam.x + (sx - canvas.width / 2) / scale(), cam.y + (sy - canvas.height / 2) / scale()];
  let drag: [number, number] | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = dev(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = dev(e);
    cam.x -= (p[0] - drag[0]) / scale();
    cam.y -= (p[1] - drag[1]) / scale();
    drag = p;
    render();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = dev(e), before = toGrid(p);
    cam.zoom = Math.min(1024, Math.max(0.5, cam.zoom * Math.exp(-e.deltaY * 0.002)));
    const after = toGrid(p);
    cam.x += before[0] - after[0];
    cam.y += before[1] - after[1];
    render();
  }, { passive: false });
  const fit = () => {
    canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
    canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
    resize();
    draw();
  };
  fit();
  new ResizeObserver(() => { if (Math.round(canvas.clientWidth * devicePixelRatio) !== w || Math.round(canvas.clientHeight * devicePixelRatio) !== h) fit(); }).observe(canvas);

  return { device, gpu, cam, draw, points: n, bbox, size: () => [w, h] as const, scale, readCounts, readScreen };
}
