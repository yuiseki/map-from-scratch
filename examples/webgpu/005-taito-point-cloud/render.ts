// 23-taito-point-cloud's renderer, in WebGPU. WebGPU has no point size: a
// point-list primitive is always 1 px. Each point is therefore an instance of
// a 4-vertex triangle strip, sized in the vertex shader by the formula 23
// gives gl_PointSize and cut to a disc in the fragment shader (deck.gl's
// ScatterplotLayer moved from a 16-sided fan to such a quad: "about 3x
// faster", point-rendering-and-clustering). The camera, the clear colour and
// the size formula are 23's, so the two differ only in the API.
//
// Changed from 23 because WebGPU allows or needs it:
// - one interleaved 16-byte vertex per point (float32x3 position, unorm8x4
//   colour): WebGPU has no 3-byte vertex format, 23 used 12 + 3 bytes in two
//   buffers;
// - reversed-Z into depth32float (float-precision): near 0.5 m, far 10 km;
// - 4x MSAA resolved into the canvas, as 23's antialias: true.
import type { Cloud } from '../../23-taito-point-cloud/decode.ts';
import { packCloudVertices } from './render-data.ts';

// TypeScript's DOM types have the GPU* interfaces but not the constant
// objects, so the flags are spelled out.
const VERTEX = 0x20, UNIFORM = 0x40, COPY_DST = 0x8, MAP_READ = 0x1;
const RENDER_ATTACHMENT = 0x10, TEX_COPY_SRC = 0x01;
const SAMPLES = 4;

const WGSL = /* wgsl */ `
struct U { eye: vec3f, tanX: f32, forward: vec3f, tanY: f32, right: vec3f, near: f32, up: vec3f, far: f32, viewport: vec2f, size: f32 }
@group(0) @binding(0) var<uniform> u: U;
struct V { @builtin(position) pos: vec4f, @location(0) corner: vec2f, @location(1) color: vec3f }

@vertex
fn vs(@builtin(vertex_index) i: u32, @location(0) p: vec3f, @location(1) c: vec4f) -> V {
  let d = p - u.eye;
  let depth = dot(d, u.forward);
  let corner = vec2f(f32(i & 1u), f32(i >> 1u)) * 2.0 - 1.0;
  // 23's gl_PointSize, a diameter in device pixels.
  let px = clamp(u.size * 220.0 / max(depth, 1.0), 1.2, 8.0);
  var v: V;
  // Reversed Z: depth = near gives 1, far gives 0.
  v.pos = vec4f(dot(d, u.right) / u.tanX + corner.x * px / u.viewport.x * depth,
                dot(d, u.up) / u.tanY + corner.y * px / u.viewport.y * depth,
                u.near * (u.far - depth) / (u.far - u.near), depth);
  v.corner = corner;
  v.color = c.rgb;
  return v;
}

@fragment
fn fs(v: V) -> @location(0) vec4f {
  if (dot(v.corner, v.corner) > 1.0) { discard; }
  return vec4f(v.color, 1.0);
}
`;

export interface Camera { x: number; y: number; distance: number; yaw: number; pitch: number; width: number; height: number; size: number }
export interface Mesh { buffer: GPUBuffer; count: number; bytes: number }
// Where the bench wants the frame's GPU timestamps.
export interface Timestamps { begin: GPUComputePassTimestampWrites; end: GPUComputePassTimestampWrites }

export async function createRenderer(canvas: HTMLCanvasElement) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU が使えません');
  // Only the bench reads timestamps, but the feature costs nothing unused.
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
  });
  device.lost.then((e) => console.error('WebGPU device lost:', e.message));
  const gpu = `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) throw new Error('WebGPU の canvas が使えません');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque', usage: RENDER_ATTACHMENT | TEX_COPY_SRC });

  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module, entryPoint: 'vs',
      buffers: [{ arrayStride: 16, stepMode: 'instance', attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'unorm8x4' }] }],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-strip' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: SAMPLES },
  });
  const uniforms = device.createBuffer({ size: 80, usage: UNIFORM | COPY_DST });
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] });
  const data = new Float32Array(20);

  function upload(cloud: Cloud): Mesh {
    const bytes = Math.max(1, cloud.count) * 16;
    const buffer = device.createBuffer({ size: bytes, usage: VERTEX, mappedAtCreation: true });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(packCloudVertices(cloud)));
    buffer.unmap();
    return { buffer, count: cloud.count, bytes };
  }
  function remove(mesh: Mesh) { mesh.buffer.destroy(); }

  // Per canvas size: the multisampled colour and depth targets and the
  // offscreen resolve target the bench draws timed frames into.
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

  function encode(camera: Camera, meshes: Mesh[], target: GPUTexture, ts?: Timestamps): GPUCommandEncoder {
    const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
    const hc = Math.cos(pitch), v = Math.sin(pitch), tanY = Math.tan(Math.PI / 6);
    const dpr = Math.min(2, devicePixelRatio || 1);
    data.set([
      camera.x + Math.sin(yaw) * hc * camera.distance, camera.y - Math.cos(yaw) * hc * camera.distance, 50 + v * camera.distance, tanY * w / h,
      -Math.sin(yaw) * hc, Math.cos(yaw) * hc, -v, tanY,
      Math.cos(yaw), Math.sin(yaw), 0, Math.max(0.5, camera.distance / 2000),
      -Math.sin(yaw) * v, Math.cos(yaw) * v, hc, Math.max(10000, camera.distance * 8),
      w, h, camera.size * dpr, 0,
    ]);
    device.queue.writeBuffer(uniforms, 0, data);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: msaa.createView(), resolveTarget: target.createView(), loadOp: 'clear', storeOp: 'discard', clearValue: [0.055, 0.085, 0.11, 1] }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      timestampWrites: ts && { querySet: ts.begin.querySet, beginningOfPassWriteIndex: ts.begin.beginningOfPassWriteIndex, endOfPassWriteIndex: ts.end.endOfPassWriteIndex },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    for (const mesh of meshes) { pass.setVertexBuffer(0, mesh.buffer); pass.draw(4, mesh.count); }
    pass.end();
    return encoder;
  }

  function draw(camera: Camera, meshes: Mesh[], ts?: Timestamps, toOffscreen = false) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    resize(Math.max(1, Math.round(camera.width * dpr)), Math.max(1, Math.round(camera.height * dpr)));
    device.queue.submit([encode(camera, meshes, toOffscreen ? offscreen : context!.getCurrentTexture(), ts).finish()]);
  }

  // Draws onto the canvas and copies it back in the same task (a presented
  // canvas texture reads back as zeros): RGBA rows, top first.
  async function readScreen(camera: Camera, meshes: Mesh[]): Promise<Uint8Array> {
    draw(camera, meshes);
    const row = Math.ceil((w * 4) / 256) * 256;
    const read = device.createBuffer({ size: row * h, usage: COPY_DST | MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: context!.getCurrentTexture() }, { buffer: read, bytesPerRow: row }, [w, h]);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(MAP_READ);
    const raw = new Uint8Array(read.getMappedRange()), out = new Uint8Array(w * h * 4), bgra = format === 'bgra8unorm';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = y * row + x * 4, d = (y * w + x) * 4;
      out[d] = raw[s + (bgra ? 2 : 0)]; out[d + 1] = raw[s + 1]; out[d + 2] = raw[s + (bgra ? 0 : 2)]; out[d + 3] = raw[s + 3];
    }
    read.destroy();
    return out;
  }

  return { device, gpu, upload, remove, draw, readScreen, size: () => [w, h] as [number, number] };
}
