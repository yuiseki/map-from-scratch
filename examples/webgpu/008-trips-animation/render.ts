// WebGPU Manhattan Taxi Trips Animator.
// Renders 3D OSM buildings and taxi trajectories with trail fading animation,
// additive neon glow blending and reversed-Z depth.
import { decodeBuildingVertices, decodeTripSegments } from './render-data.ts';

export interface Camera {
  x: number;          // center X in normalized Mercator [0, 1]
  y: number;          // center Y in normalized Mercator [0, 1]
  zoom: number;       // zoom level (approx 12..17)
  pitch: number;      // pitch angle (degrees)
  bearing: number;    // bearing/yaw angle (degrees)
  width: number;
  height: number;
  time: number;       // current playback time (seconds, 0..1800)
  trail: number;      // trail length in seconds (10..300)
  trailWidth: number; // width in device pixels (1.0..6.0)
}

export interface TripsData {
  buffer: ArrayBuffer;
  count: number;
  segments: number;
  objects: number;
  bounds: [number, number, number, number];
}

export interface BuildingsData {
  buffer: ArrayBuffer;
  count: number;
  indices: Uint16Array;
  objects: number;
  bounds: [number, number, number, number];
}

const VERTEX = 0x20, UNIFORM = 0x40, INDEX = 0x10, COPY_DST = 0x8, MAP_READ = 0x1;
const RENDER_ATTACHMENT = 0x10, TEX_COPY_SRC = 0x01;
const SAMPLES = 4;

const BUILDING_WGSL = /* wgsl */ `
struct Uniforms {
  bmin: vec2f,
  bspan: vec2f,
  center: vec2f,
  view: vec2f,
  worldPx: f32,
  metersPerWorld: f32,
  pitch: f32,
  bearing: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexIn {
  @location(0) xy: vec2f,     // 16-bit normalized [0, 65535]
  @location(1) height: f32,   // meters * 10
  @location(2) shade: f32,    // 0..1
}

struct VertexOut {
  @builtin(position) clipPos: vec4f,
  @location(0) shade: f32,
}

@vertex
fn vs(in: VertexIn) -> VertexOut {
  var out: VertexOut;
  let world = u.bmin + (in.xy / 65535.0) * u.bspan;
  let delta = (world - u.center) * u.worldPx;
  let c = cos(u.bearing);
  let s = sin(u.bearing);
  let rotated = vec2f(c * delta.x - s * delta.y, s * delta.x + c * delta.y);

  let h = (in.height * 0.1) / u.metersPerWorld * u.worldPx;
  let cp = cos(u.pitch);
  let sp = sin(u.pitch);
  let y = rotated.y * cp - h * sp;
  let depth = rotated.y * sp + h * cp;

  // Reversed Z in [0, 1]
  let zNorm = clamp(0.5 - depth / (u.view.y * 3.5), 0.01, 0.99);

  out.clipPos = vec4f(rotated.x / (u.view.x * 0.5), -y / (u.view.y * 0.5), zNorm, 1.0);
  out.shade = in.shade;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let baseColor = vec3f(0.18, 0.24, 0.32);
  let rgb = baseColor * in.shade;
  return vec4f(rgb, 1.0);
}
`;

const TRIP_WGSL = /* wgsl */ `
struct Uniforms {
  center: vec2f,
  view: vec2f,
  worldPx: f32,
  pitch: f32,
  bearing: f32,
  time: f32,
  trail: f32,
  width: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

struct SegmentIn {
  @location(0) p0: vec3u, // 24-bit quantized x, y, time (t0 in 0.1s)
  @location(1) p1: vec3u, // 24-bit quantized x, y, time (t1 in 0.1s)
  @location(2) attrs: vec2u, // vendor (0=yellow, 1=green), gap (1=end of trip)
}

struct VertexOut {
  @builtin(position) clipPos: vec4f,
  @location(0) age: f32,
  @location(1) vendor: f32,
}

fn decode24(val: u32) -> f32 {
  return f32(val) / 16777215.0;
}

fn screenPos(world: vec2f) -> vec2f {
  let delta = (world - u.center) * u.worldPx;
  let c = cos(u.bearing);
  let s = sin(u.bearing);
  let rotated = vec2f(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
  return vec2f(rotated.x, rotated.y * cos(u.pitch));
}

@vertex
fn vs(@builtin(vertex_index) vertIdx: u32, in: SegmentIn) -> VertexOut {
  var out: VertexOut;
  let t0 = f32(in.p0.z) * 0.1;
  let t1 = f32(in.p1.z) * 0.1;

  if (in.attrs.y > 0u || t1 < u.time - u.trail || t0 > u.time) {
    out.clipPos = vec4f(0.0, 0.0, -1.0, 1.0);
    out.age = 1.0;
    out.vendor = f32(in.attrs.x);
    return out;
  }

  let span = max(0.001, t1 - t0);
  let lo = clamp((u.time - u.trail - t0) / span, 0.0, 1.0);
  let hi = clamp((u.time - t0) / span, 0.0, 1.0);

  let p0 = vec2f(decode24(in.p0.x), decode24(in.p0.y));
  let p1 = vec2f(decode24(in.p1.x), decode24(in.p1.y));

  let a = screenPos(mix(p0, p1, lo));
  let b = screenPos(mix(p0, p1, hi));

  let delta = b - a;
  let len = length(delta);
  let normal = select(vec2f(0.0, 1.0), vec2f(-delta.y, delta.x) / len, len > 0.001);

  let i = vertIdx % 6u;
  let isEnd = (i == 2u || i == 4u || i == 5u);
  let side = select(-1.0, 1.0, i == 1u || i == 2u || i == 4u);

  let centerPt = select(a, b, isEnd);
  let pos = centerPt + normal * (side * u.width * 0.5);

  let depthY = select(a.y, b.y, isEnd);
  // Reversed-Z depth with slight bias (-0.0002) so trails draw in front of street ground
  let zNorm = clamp(0.5 - (depthY * tan(u.pitch)) / (u.view.y * 3.5) + 0.0002, 0.01, 0.99);

  out.clipPos = vec4f(pos.x / (u.view.x * 0.5), -pos.y / (u.view.y * 0.5), zNorm, 1.0);
  let curT = mix(t0, t1, select(lo, hi, isEnd));
  out.age = clamp((u.time - curT) / max(1.0, u.trail), 0.0, 1.0);
  out.vendor = f32(in.attrs.x);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  // Yellow Cab: bright amber/gold | Green Cab: bright neon emerald
  let col = select(vec3f(1.0, 0.72, 0.15), vec3f(0.15, 0.95, 0.65), in.vendor > 0.5);
  let intensity = pow(1.0 - in.age, 1.5) * 0.92;
  return vec4f(col * intensity, intensity);
}
`;

export async function createRenderer(canvas: HTMLCanvasElement) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU が使えません');
  const device = await adapter.requestDevice();
  device.lost.then(e => console.error('WebGPU device lost:', e.message));
  const gpu = `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) throw new Error('WebGPU の canvas が使えません');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque', usage: RENDER_ATTACHMENT | TEX_COPY_SRC });

  // 1. Building Pipeline
  const buildingModule = device.createShaderModule({ code: BUILDING_WGSL });
  const buildingPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: buildingModule, entryPoint: 'vs',
      buffers: [{
        arrayStride: 16, // pos(8B) + height(4B) + shade(4B)
        stepMode: 'vertex',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32' },
          { shaderLocation: 2, offset: 12, format: 'float32' },
        ],
      }],
    },
    fragment: { module: buildingModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: SAMPLES },
  });

  // 2. Trip Trajectory Pipeline (Additive Alpha Blending for Neon Glow)
  const tripModule = device.createShaderModule({ code: TRIP_WGSL });
  const tripPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: tripModule, entryPoint: 'vs',
      buffers: [{
        arrayStride: 32, // p0(12B: x, y, t0) + p1(12B: x, y, t1) + meta(8B: vendor, gap)
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'uint32x3' },
          { shaderLocation: 1, offset: 12, format: 'uint32x3' },
          { shaderLocation: 2, offset: 24, format: 'uint32x2' },
        ],
      }],
    },
    fragment: {
      module: tripModule, entryPoint: 'fs',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' },
    multisample: { count: SAMPLES },
  });

  const buildingUniforms = device.createBuffer({ size: 64, usage: UNIFORM | COPY_DST });
  const tripUniforms = device.createBuffer({ size: 64, usage: UNIFORM | COPY_DST });

  const buildingBindGroup = device.createBindGroup({
    layout: buildingPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: buildingUniforms } }],
  });
  const tripBindGroup = device.createBindGroup({
    layout: tripPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: tripUniforms } }],
  });

  let buildingVertexBuffer: GPUBuffer | null = null;
  let buildingIndexBuffer: GPUBuffer | null = null;
  let buildingIndexCount = 0;
  let buildingBounds: [number, number, number, number] = [0, 0, 1, 1];

  let tripSegmentBuffer: GPUBuffer | null = null;
  let tripSegmentsCount = 0;

  function uploadBuildings(data: BuildingsData) {
    if (buildingVertexBuffer) buildingVertexBuffer.destroy();
    if (buildingIndexBuffer) buildingIndexBuffer.destroy();

    buildingBounds = data.bounds;
    buildingIndexCount = data.indices.length;

    // Convert raw 8B building vertices: [u16 x, u16 y, u16 height, u8 shade, u8 pad]
    const converted = decodeBuildingVertices(data);

    buildingVertexBuffer = device.createBuffer({
      size: converted.byteLength,
      usage: VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(buildingVertexBuffer.getMappedRange()).set(converted);
    buildingVertexBuffer.unmap();

    // 16-bit indices (must align to 4 bytes for WebGPU buffer size)
    const paddedIndexBytes = Math.ceil((data.indices.byteLength) / 4) * 4;
    buildingIndexBuffer = device.createBuffer({
      size: paddedIndexBytes,
      usage: INDEX,
      mappedAtCreation: true,
    });
    new Uint16Array(buildingIndexBuffer.getMappedRange()).set(data.indices);
    buildingIndexBuffer.unmap();
  }

  function uploadTrips(data: TripsData) {
    if (tripSegmentBuffer) tripSegmentBuffer.destroy();

    tripSegmentsCount = data.count - 1;
    const segments = decodeTripSegments(data);

    tripSegmentBuffer = device.createBuffer({
      size: segments.byteLength,
      usage: VERTEX,
      mappedAtCreation: true,
    });
    new Uint32Array(tripSegmentBuffer.getMappedRange()).set(segments);
    tripSegmentBuffer.unmap();
  }

  let w = 0, h = 0;
  let msaa: GPUTexture, depth: GPUTexture, offscreen: GPUTexture;

  function resize(width: number, height: number) {
    if (width === w && height === h) return;
    canvas.width = w = width; canvas.height = h = height;
    for (const t of [msaa, depth, offscreen]) t?.destroy();
    msaa = device.createTexture({ size: [w, h], format, sampleCount: SAMPLES, usage: RENDER_ATTACHMENT });
    depth = device.createTexture({ size: [w, h], format: 'depth32float', sampleCount: SAMPLES, usage: RENDER_ATTACHMENT });
    offscreen = device.createTexture({ size: [w, h], format, usage: RENDER_ATTACHMENT | TEX_COPY_SRC });
  }

  function draw(cam: Camera, toOffscreen = false) {
    if (!buildingVertexBuffer || !tripSegmentBuffer) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    resize(Math.max(1, Math.round(cam.width * dpr)), Math.max(1, Math.round(cam.height * dpr)));

    const worldPx = 512 * Math.pow(2, cam.zoom);
    const metersPerWorld = 40075016.686 * Math.cos(40.72 * Math.PI / 180);

    // 1. Write Building Uniforms
    const bData = new Float32Array(16);
    bData[0] = buildingBounds[0]; bData[1] = buildingBounds[1];
    bData[2] = buildingBounds[2] - buildingBounds[0]; bData[3] = buildingBounds[3] - buildingBounds[1];
    bData[4] = cam.x; bData[5] = cam.y;
    bData[6] = cam.width * dpr; bData[7] = cam.height * dpr;
    bData[8] = worldPx; bData[9] = metersPerWorld;
    bData[10] = cam.pitch * Math.PI / 180; bData[11] = cam.bearing * Math.PI / 180;
    device.queue.writeBuffer(buildingUniforms, 0, bData);

    // 2. Write Trip Uniforms
    const tData = new Float32Array(16);
    tData[0] = cam.x; tData[1] = cam.y;
    tData[2] = cam.width * dpr; tData[3] = cam.height * dpr;
    tData[4] = worldPx;
    tData[5] = cam.pitch * Math.PI / 180;
    tData[6] = cam.bearing * Math.PI / 180;
    tData[7] = cam.time;
    tData[8] = cam.trail;
    tData[9] = cam.trailWidth * dpr;
    device.queue.writeBuffer(tripUniforms, 0, tData);

    const target = toOffscreen ? offscreen : context!.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msaa.createView(),
        resolveTarget: target.createView(),
        loadOp: 'clear',
        storeOp: 'discard',
        clearValue: [0.035, 0.055, 0.08, 1], // deep night sky
      }],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 0.0, // reversed-Z
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    // Pass 1: Render 3D Buildings
    pass.setPipeline(buildingPipeline);
    pass.setBindGroup(0, buildingBindGroup);
    pass.setVertexBuffer(0, buildingVertexBuffer);
    pass.setIndexBuffer(buildingIndexBuffer!, 'uint16');
    pass.drawIndexed(buildingIndexCount);

    // Pass 2: Render Taxi Trails (Additive blending with depth test)
    pass.setPipeline(tripPipeline);
    pass.setBindGroup(0, tripBindGroup);
    pass.setVertexBuffer(0, tripSegmentBuffer);
    pass.draw(6, tripSegmentsCount);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  async function readScreen(cam: Camera): Promise<Uint8Array> {
    draw(cam, true);
    const row = Math.ceil((w * 4) / 256) * 256;
    const read = device.createBuffer({ size: row * h, usage: COPY_DST | MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: offscreen }, { buffer: read, bytesPerRow: row }, [w, h]);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(MAP_READ);
    const raw = new Uint8Array(read.getMappedRange()), out = new Uint8Array(w * h * 4);
    const bgra = format === 'bgra8unorm';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = y * row + x * 4, d = (y * w + x) * 4;
        out[d] = raw[s + (bgra ? 2 : 0)];
        out[d + 1] = raw[s + 1];
        out[d + 2] = raw[s + (bgra ? 0 : 2)];
        out[d + 3] = raw[s + 3];
      }
    }
    read.destroy();
    return out;
  }

  return {
    device,
    gpu,
    uploadBuildings,
    uploadTrips,
    draw,
    readScreen,
    size: () => [w, h] as [number, number],
  };
}
