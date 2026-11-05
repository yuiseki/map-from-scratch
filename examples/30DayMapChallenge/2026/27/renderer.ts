import { decodeQuarterMesh, type CensusCell } from './mesh.ts';

const STORAGE = 0x80, UNIFORM = 0x40, COPY_DST = 0x8, COPY_SRC = 0x4, MAP_READ = 0x1;
const RENDER_ATTACHMENT = 0x10, TEXTURE_COPY_SRC = 0x01;
const BOUNDS = /* wgsl */ `
struct CellInput { bounds: vec4f, value: f32, status: u32, sourceIndex: u32, pad: u32 }
struct CellOutput { rect: vec4f, classIndex: u32, visible: u32, sourceIndex: u32, pad: u32 }
struct Camera { center: vec2f, viewport: vec2f, scale: f32, cosLat: f32, count: u32, selected: u32 }
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> cells: array<CellInput>;
@group(0) @binding(2) var<storage, read_write> projected: array<CellOutput>;
`;

const COMPUTE = BOUNDS + /* wgsl */ `
@compute @workgroup_size(64)
fn project_and_classify(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= camera.count) { return; }
  let cell = cells[i];
  let left = camera.viewport.x * 0.5 + (cell.bounds.x - camera.center.x) * camera.cosLat * camera.scale;
  let right = camera.viewport.x * 0.5 + (cell.bounds.z - camera.center.x) * camera.cosLat * camera.scale;
  let top = camera.viewport.y * 0.5 - (cell.bounds.w - camera.center.y) * camera.scale;
  let bottom = camera.viewport.y * 0.5 - (cell.bounds.y - camera.center.y) * camera.scale;
  let visible = right > 0.0 && left < camera.viewport.x && bottom > 0.0 && top < camera.viewport.y;
  var classIndex = 8u;
  if (cell.status == 0u) { classIndex = 0u; }
  if (cell.status == 1u) { classIndex = 1u; }
  if (cell.status == 2u) {
    classIndex = 2u;
    if (cell.value > 2.0) { classIndex = 3u; }
    if (cell.value > 10.0) { classIndex = 4u; }
    if (cell.value > 30.0) { classIndex = 5u; }
    if (cell.value > 100.0) { classIndex = 6u; }
  }
  if (cell.status == 3u) { classIndex = 7u; }
  projected[i] = CellOutput(vec4f(left, top, right, bottom), classIndex, select(0u, 1u, visible), i, 0u);
}
`;

const RENDER = /* wgsl */ `
struct Camera { center: vec2f, viewport: vec2f, scale: f32, cosLat: f32, count: u32, selected: u32 }
struct CellOutput { rect: vec4f, classIndex: u32, visible: u32, sourceIndex: u32, pad: u32 }
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> projected: array<CellOutput>;

struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) classIndex: u32, @location(2) @interpolate(flat) selected: u32 }
@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOut {
  let cell = projected[instance];
  let corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let uv = corners[vertex];
  let pixel = mix(cell.rect.xy, cell.rect.zw, uv);
  let clip = vec2f(pixel.x / camera.viewport.x * 2.0 - 1.0, 1.0 - pixel.y / camera.viewport.y * 2.0);
  var out: VertexOut;
  out.position = vec4f(select(vec2f(2.0), clip, cell.visible != 0u), 0.0, 1.0);
  out.uv = uv;
  out.classIndex = cell.classIndex;
  out.selected = select(0u, 1u, camera.selected == instance);
  return out;
}

fn colour(classIndex: u32) -> vec3f {
  switch classIndex {
    case 0u: { return vec3f(0.13, 0.20, 0.25); } // source row absent
    case 1u: { return vec3f(0.20, 0.30, 0.38); } // explicit zero
    case 2u: { return vec3f(0.20, 0.39, 0.43); } // 1–2
    case 3u: { return vec3f(0.22, 0.57, 0.52); } // 3–10
    case 4u: { return vec3f(0.50, 0.72, 0.43); } // 11–30
    case 5u: { return vec3f(0.92, 0.70, 0.31); } // 31–100
    case 6u: { return vec3f(0.91, 0.36, 0.30); } // 101+
    case 7u: { return vec3f(0.69, 0.46, 0.77); } // suppressed
    default: { return vec3f(0.48, 0.52, 0.56); } // unavailable
  }
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  var fill = colour(in.classIndex);
  let edge = min(min(in.uv.x, 1.0 - in.uv.x), min(in.uv.y, 1.0 - in.uv.y));
  if (edge < 0.035) { fill = mix(fill, vec3f(0.04, 0.08, 0.11), 0.42); }
  if (in.classIndex == 7u && fract((in.uv.x + in.uv.y) * 9.0) < 0.26) { fill = mix(fill, vec3f(0.88, 0.70, 0.95), 0.22); }
  if (in.selected != 0u && edge < 0.13) { fill = vec3f(1.0, 0.92, 0.49); }
  return vec4f(fill, 1.0);
}
`;

export interface CameraState { lon: number; lat: number; zoom: number }
export interface RendererHandle {
  device: GPUDevice;
  gpu: string;
  cells: CensusCell[];
  camera: CameraState;
  draw: (timestamps?: { begin: GPUComputePassTimestampWrites; end: GPUComputePassTimestampWrites }, offscreen?: boolean) => void;
  resize: () => void;
  readProjected: () => Promise<ArrayBuffer>;
  readScreen: () => Promise<Uint8Array>;
  pick: (x: number, y: number) => number;
  screenPoint: (index: number) => readonly [number, number];
  select: (index: number) => void;
  setView: (camera: CameraState) => void;
  scale: () => number;
  size: () => readonly [number, number];
  cellsBuffer: GPUBuffer;
}

declare global { interface Window { __mfsEmit?: (payload: string) => void } }

const toStatus = (status: CensusCell['status']): number => ({ 'no-row': 0, zero: 1, count: 2, suppressed: 3, unavailable: 4 })[status];

export async function mount(canvas: HTMLCanvasElement, cells: CensusCell[], bounds: [number, number, number, number]): Promise<RendererHandle> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('このブラウザーでは WebGPU アダプターを利用できません');
  const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
  device.addEventListener('uncapturederror', (event) => {
    const message = `WebGPU validation error: ${event.error.message}`;
    console.error(message);
    window.__mfsEmit?.(JSON.stringify({ error: message }));
  });
  device.lost.then((e) => console.error('WebGPU device lost:', e.message));
  const gpu = `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctx) throw new Error('WebGPU canvas context を作成できません');
  const context: GPUCanvasContext = ctx;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque', usage: RENDER_ATTACHMENT | TEXTURE_COPY_SRC });

  const packed = new Float32Array(cells.length * 8);
  const packedWords = new Uint32Array(packed.buffer);
  cells.forEach((cell, i) => {
    const p = i * 8;
    packed.set([cell.bounds.west, cell.bounds.south, cell.bounds.east, cell.bounds.north, cell.value ?? 0], p);
    packedWords[p + 5] = toStatus(cell.status); packedWords[p + 6] = i;
  });
  const cellsBuffer = device.createBuffer({ size: packed.byteLength, usage: STORAGE, mappedAtCreation: true });
  new Float32Array(cellsBuffer.getMappedRange()).set(packed);
  cellsBuffer.unmap();
  const projectedBuffer = device.createBuffer({ size: cells.length * 32, usage: STORAGE | COPY_SRC });
  const cameraBuffer = device.createBuffer({ size: 32, usage: UNIFORM | COPY_DST });
  const computeModule = device.createShaderModule({ code: COMPUTE });
  const computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'project_and_classify' } });
  const renderModule = device.createShaderModule({ code: RENDER });
  const renderPipeline = device.createRenderPipeline({
    layout: 'auto', vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const computeGroup = device.createBindGroup({ layout: computePipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: cameraBuffer } }, { binding: 1, resource: { buffer: cellsBuffer } }, { binding: 2, resource: { buffer: projectedBuffer } },
  ] });
  const renderGroup = device.createBindGroup({ layout: renderPipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: cameraBuffer } }, { binding: 1, resource: { buffer: projectedBuffer } },
  ] });

  let width = 0, height = 0, selected = 0xffffffff;
  const [west, south, east, north] = bounds;
  const centerLat = (south + north) / 2;
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  let baseScale = 1, camera = { lon: (west + east) / 2, lat: centerLat, zoom: 1 };
  let offscreen: GPUTexture | null = null;
  function resize() {
    width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    offscreen?.destroy();
    offscreen = device.createTexture({ size: [width, height], format, usage: RENDER_ATTACHMENT | TEXTURE_COPY_SRC });
    baseScale = Math.min(width / ((east - west) * cosLat), height / (north - south)) * 0.94;
  }
  function encodeFrame(timestamps?: { begin: GPUComputePassTimestampWrites; end: GPUComputePassTimestampWrites }, toOffscreen = false, readback?: { buffer: GPUBuffer; bytesPerRow: number }) {
    if (!width || !height) resize();
    const cameraBytes = new ArrayBuffer(32);
    const f = new Float32Array(cameraBytes), u = new Uint32Array(cameraBytes);
    f[0] = camera.lon; f[1] = camera.lat; f[2] = width; f[3] = height; f[4] = baseScale * camera.zoom; f[5] = cosLat;
    u[6] = cells.length; u[7] = selected;
    device.queue.writeBuffer(cameraBuffer, 0, cameraBytes);
    const encoder = device.createCommandEncoder();
    const cp = encoder.beginComputePass(timestamps ? { timestampWrites: timestamps.begin } : undefined);
    cp.setPipeline(computePipeline); cp.setBindGroup(0, computeGroup); cp.dispatchWorkgroups(Math.ceil(cells.length / 64)); cp.end();
    const target = toOffscreen ? offscreen! : context.getCurrentTexture();
    const rp = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.055, 0.09, 0.12, 1] }],
      timestampWrites: timestamps?.end,
    });
    rp.setPipeline(renderPipeline); rp.setBindGroup(0, renderGroup); rp.draw(6, cells.length); rp.end();
    if (readback) encoder.copyTextureToBuffer({ texture: target }, { buffer: readback.buffer, bytesPerRow: readback.bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
  }
  function draw(timestamps?: { begin: GPUComputePassTimestampWrites; end: GPUComputePassTimestampWrites }, toOffscreen = false) {
    encodeFrame(timestamps, toOffscreen);
  }
  function setView(next: CameraState) { camera = { ...next }; }
  function pick(x: number, y: number): number {
    const scale = baseScale * camera.zoom;
    const lon = camera.lon + (x - width / 2) / (scale * cosLat);
    const lat = camera.lat - (y - height / 2) / scale;
    for (let i = cells.length - 1; i >= 0; i--) {
      const b = cells[i].bounds;
      if (lon >= b.west && lon < b.east && lat >= b.south && lat < b.north) return i;
    }
    return -1;
  }
  function screenPoint(index: number): readonly [number, number] {
    const b = cells[index]?.bounds;
    if (!b) return [-1, -1];
    const lon = (b.west + b.east) / 2, lat = (b.south + b.north) / 2, scale = baseScale * camera.zoom;
    return [width / 2 + (lon - camera.lon) * cosLat * scale, height / 2 - (lat - camera.lat) * scale];
  }
  function select(index: number) { selected = index < 0 ? 0xffffffff : index; }
  async function readBuffer(source: GPUBuffer, bytes: number): Promise<ArrayBuffer> {
    const read = device.createBuffer({ size: bytes, usage: 0x8 | MAP_READ });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, read, 0, bytes); device.queue.submit([encoder.finish()]);
    await read.mapAsync(MAP_READ); const result = read.getMappedRange().slice(0); read.destroy(); return result;
  }
  async function readProjected(): Promise<ArrayBuffer> {
    return readBuffer(projectedBuffer, cells.length * 32);
  }
  async function readScreen(): Promise<Uint8Array> {
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const read = device.createBuffer({ size: bytesPerRow * height, usage: 0x8 | MAP_READ });
    encodeFrame(undefined, false, { buffer: read, bytesPerRow }); await device.queue.onSubmittedWorkDone();
    await read.mapAsync(MAP_READ);
    const raw = new Uint8Array(read.getMappedRange()), output = new Uint8Array(width * height * 4), bgra = format === 'bgra8unorm';
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const s = y * bytesPerRow + x * 4, d = (y * width + x) * 4;
      output[d] = raw[s + (bgra ? 2 : 0)]; output[d + 1] = raw[s + 1]; output[d + 2] = raw[s + (bgra ? 0 : 2)]; output[d + 3] = raw[s + 3];
    }
    read.unmap(); read.destroy(); return output;
  }

  resize();
  const cameraCenter: CameraState = { ...camera };
  const handle: RendererHandle = {
    device, gpu, cells, camera, draw, resize, readProjected, readScreen, pick, screenPoint, select, setView,
    scale: () => baseScale * camera.zoom, size: () => [width, height], cellsBuffer,
  };
  // Keep the public camera object stable for the benchmark while camera replacement is supported.
  Object.defineProperty(handle, 'camera', { get: () => camera });
  setView(cameraCenter);
  return handle;
}

export function sourceRecordCells(value: unknown): { bounds: [number, number, number, number]; cells: CensusCell[] } {
  if (!value || typeof value !== 'object') throw new Error('Baked census file is not an object');
  const record = value as { area?: { bounds?: { west: number; south: number; east: number; north: number } }; cells?: CensusCell[] };
  if (!record.area?.bounds || !Array.isArray(record.cells)) throw new Error('Baked census file has no area bounds or cells');
  const b = record.area.bounds;
  return { bounds: [b.west, b.south, b.east, b.north], cells: record.cells };
}

export function meshBounds(code: string) { return decodeQuarterMesh(code); }
