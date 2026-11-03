// WebGPU 3D Terrain Renderer (Mt. Fuji) with Directional Sun Lighting and Reversed-Z.
import {
  parseTerrHeader,
  decodeChunk,
  elevationColor,
  generateGridIndices,
  getL3ChunkOrder,
  CS,
  S,
  HEADER_BYTES,
  ENTRY_BYTES,
} from './terrain.ts';

export interface Camera {
  yaw: number;        // degrees (0..360)
  pitch: number;      // degrees (10..85)
  dist: number;       // camera distance in meters
  tx: number;         // target X in meters
  ty: number;         // target Y in meters
  tz: number;         // target Z in meters
  width?: number;
  height?: number;
}

// WebGPU numeric usage constants
const VERTEX = 0x20;
const INDEX = 0x10;
const UNIFORM = 0x40;
const COPY_DST = 0x08;
const COPY_SRC = 0x04;
const MAP_READ = 0x01;
const RENDER_ATTACHMENT = 0x10;
const STAGE_VERTEX = 0x1;
const STAGE_FRAGMENT = 0x2;

const WGSL = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  sunDir: vec3<f32>,
  ambient: f32,
  eye: vec3<f32>,
  pad: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec4<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.clipPos = u.viewProj * vec4<f32>(in.position, 1.0);
  out.worldPos = in.position;
  out.normal = in.normal;
  out.color = in.color;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let norm = normalize(in.normal);
  let sun = normalize(u.sunDir);
  let diff = max(0.0, dot(norm, sun));

  // Lambertian diffuse + ambient
  let light = u.ambient + 0.85 * diff;
  var rgb = in.color.rgb * light;

  // Soft atmospheric perspective towards sky blue
  let dist = distance(in.worldPos, u.eye);
  let sky = vec3<f32>(0.72, 0.81, 0.90);
  let fogFactor = clamp(1.0 - exp(-dist * 0.000018), 0.0, 0.65);
  rgb = mix(rgb, sky, fogFactor);

  return vec4<f32>(rgb, 1.0);
}
`;

export class WebGPUTerrainRenderer {
  public device: GPUDevice;
  public context: GPUCanvasContext;
  private canvasFormat: GPUTextureFormat;

  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;

  private depthTexture: GPUTexture | null = null;
  private depthTextureView: GPUTextureView | null = null;

  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private indexCount: number = 0;
  private isLoaded: boolean = false;

  constructor(device: GPUDevice, context: GPUCanvasContext) {
    this.device = device;
    this.context = context;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: 'opaque',
      usage: RENDER_ATTACHMENT | COPY_SRC,
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 96, // mat4x4 (64B) + vec3 (12B) + f32 (4B) + vec3 (12B) + f32 (4B)
      usage: UNIFORM | COPY_DST,
    });

    const shaderModule = this.device.createShaderModule({ code: WGSL });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: STAGE_VERTEX | STAGE_FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            // Vertex layout: pos(12B) + normal(12B) + color(16B) = 40B
            arrayStride: 40,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.canvasFormat }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'greater', // Reversed-Z
      },
    });
  }

  hasData(): boolean {
    return this.isLoaded && this.indexCount > 0;
  }

  private ensureDepthTexture(width: number, height: number): void {
    if (this.depthTexture && this.depthTexture.width === width && this.depthTexture.height === height) {
      return;
    }
    if (this.depthTexture) this.depthTexture.destroy();

    this.depthTexture = this.device.createTexture({
      size: [width, height, 1],
      format: 'depth24plus',
      usage: RENDER_ATTACHMENT,
    });
    this.depthTextureView = this.depthTexture.createView();
  }

  loadTerrain(u8: Uint8Array): void {
    const header = parseTerrHeader(u8);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    // Read Level 3 (the coarse full-area 3x3 chunks)
    // In file order, L3 chunks come first, arranged in Morton code order
    const l3Side = 3;
    const l3Chunks = l3Side * l3Side; // 9 chunks
    const l3Order = getL3ChunkOrder();
    const cellSpacing = header.cellSpacing;
    const chunkSpacing = cellSpacing * (1 << 3); // Spacing at L3 = 8 * cellSpacing (~124.6m)

    // Full grid dimensions for 3x3 chunks, each having CS=128 cells
    const fullCols = l3Side * CS;
    const fullRows = l3Side * CS;
    const fullVerticesW = fullCols + 1;
    const fullVerticesH = fullRows + 1;
    const totalVertices = fullVerticesW * fullVerticesH;

    // Height array across the full area
    const fullHeights = new Float32Array(totalVertices);

    let offset = HEADER_BYTES + ENTRY_BYTES * header.chunkCount;
    const chunkDecoded = new Uint16Array(S * S);

    for (let c = 0; c < l3Chunks; c++) {
      const entryOffset = HEADER_BYTES + ENTRY_BYTES * c;
      const len = dv.getUint16(entryOffset, true);
      const chunkBytes = u8.subarray(offset, offset + len);
      offset += len;

      decodeChunk(chunkBytes, chunkDecoded);

      // Morton order gives chunk row ci and col cj
      const [ci, cj] = l3Order[c];

      // Copy inner CS x CS samples into fullHeights
      // For level 3, the quantization multiplier q = 0.25 * 2^3 = 2.0 metres per unit
      for (let r = 0; r <= CS; r++) {
        for (let col = 0; col <= CS; col++) {
          const sample = chunkDecoded[(r + 1) * S + (col + 1)] * 2.0;
          const gi = ci * CS + r;
          const gj = cj * CS + col;
          fullHeights[gi * fullVerticesW + gj] = sample;
        }
      }
    }

    // Build mesh vertex attributes: [x, y, z, nx, ny, nz, r, g, b, a] * totalVertices
    const vertexData = new Float32Array(totalVertices * 10);
    const halfN0 = 1536; // L0 center pixel

    for (let r = 0; r < fullVerticesH; r++) {
      for (let c = 0; c < fullVerticesW; c++) {
        const idx = r * fullVerticesW + c;
        const h = fullHeights[idx];

        // L0 pixel from NW corner: 8 px per L3 step
        const px = c * 8;
        const py = r * 8;
        const wx = (px - halfN0) * cellSpacing;
        const wy = (halfN0 - py) * cellSpacing;
        const wz = h;

        // Normal calculation via central differences
        // c increases East (+X), r increases South (-Y)
        const hL = c > 0 ? fullHeights[r * fullVerticesW + (c - 1)] : h;
        const hR = c < fullCols ? fullHeights[r * fullVerticesW + (c + 1)] : h;
        const hNorth = r > 0 ? fullHeights[(r - 1) * fullVerticesW + c] : h;
        const hSouth = r < fullRows ? fullHeights[(r + 1) * fullVerticesW + c] : h;

        const dzdx = (hR - hL) / (2 * chunkSpacing);
        const dzdy = (hNorth - hSouth) / (2 * chunkSpacing);
        const len = Math.hypot(-dzdx, -dzdy, 1.0) || 1.0;
        const nx = -dzdx / len;
        const ny = -dzdy / len;
        const nz = 1.0 / len;

        const color = elevationColor(h);

        const vOffset = idx * 10;
        vertexData[vOffset] = wx;
        vertexData[vOffset + 1] = wy;
        vertexData[vOffset + 2] = wz;
        vertexData[vOffset + 3] = nx;
        vertexData[vOffset + 4] = ny;
        vertexData[vOffset + 5] = nz;
        vertexData[vOffset + 6] = color[0];
        vertexData[vOffset + 7] = color[1];
        vertexData[vOffset + 8] = color[2];
        vertexData[vOffset + 9] = color[3];
      }
    }

    // Create GPU Vertex Buffer
    if (this.vertexBuffer) this.vertexBuffer.destroy();
    this.vertexBuffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: VERTEX | COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData);

    // Create Grid Index Buffer
    const indices = generateGridIndices(fullCols, fullRows);
    this.indexCount = indices.length;

    if (this.indexBuffer) this.indexBuffer.destroy();
    this.indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: INDEX | COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, indices);

    this.isLoaded = true;
  }

  private buildViewProj(cam: Camera): { vp: Float32Array; eye: [number, number, number] } {
    const width = cam.width || 1280;
    const height = cam.height || 800;
    const aspect = width / height;
    const fov = (40 * Math.PI) / 180;
    const tanHalf = Math.tan(fov / 2);
    const near = 100.0;
    const far = cam.dist + 150000.0;

    // Reversed-Z projection matrix
    const proj = new Float32Array(16);
    proj[0] = 1.0 / (aspect * tanHalf);
    proj[5] = 1.0 / tanHalf;
    proj[10] = near / (far - near);
    proj[11] = -1.0;
    proj[14] = (near * far) / (far - near);

    // Camera orbit eye position
    const yaw = (cam.yaw * Math.PI) / 180;
    const pitch = (cam.pitch * Math.PI) / 180;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);

    const eyeX = cam.tx + cam.dist * cp * sy;
    const eyeY = cam.ty - cam.dist * cp * cy;
    const eyeZ = cam.tz + cam.dist * sp;

    // Look-at view matrix
    const fx = cam.tx - eyeX, fy = cam.ty - eyeY, fz = cam.tz - eyeZ;
    const flen = Math.hypot(fx, fy, fz) || 1;
    const fwdX = fx / flen, fwdY = fy / flen, fwdZ = fz / flen;

    const rlen = Math.hypot(fwdY, -fwdX) || 1;
    const rX = fwdY / rlen, rY = -fwdX / rlen, rZ = 0;

    const uX = rY * fwdZ - rZ * fwdY;
    const uY = rZ * fwdX - rX * fwdZ;
    const uZ = rX * fwdY - rY * fwdX;

    const view = new Float32Array(16);
    view[0] = rX;  view[4] = rY;  view[8] = rZ;   view[12] = -(rX * eyeX + rY * eyeY + rZ * eyeZ);
    view[1] = uX;  view[5] = uY;  view[9] = uZ;   view[13] = -(uX * eyeX + uY * eyeY + uZ * eyeZ);
    view[2] = -fwdX; view[6] = -fwdY; view[10] = -fwdZ; view[14] = fwdX * eyeX + fwdY * eyeY + fwdZ * eyeZ;
    view[3] = 0;   view[7] = 0;   view[11] = 0;   view[15] = 1;

    // viewProj = proj * view
    const vp = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += proj[k * 4 + i] * view[j * 4 + k];
        vp[j * 4 + i] = sum;
      }
    }
    return { vp, eye: [eyeX, eyeY, eyeZ] };
  }

  render(cam: Camera): void {
    if (!this.isLoaded || !this.vertexBuffer || !this.indexBuffer) return;

    const canvas = this.context.canvas as HTMLCanvasElement;
    const width = cam.width ?? canvas.width;
    const height = cam.height ?? canvas.height;
    if (width === 0 || height === 0) return;

    this.ensureDepthTexture(width, height);
    if (!this.depthTextureView) return;

    const { vp, eye } = this.buildViewProj(cam);

    // Sun light direction (NW at 40 degrees, matching 17-fuji-terrain-3d)
    const sunX = -0.5417, sunY = 0.5417, sunZ = 0.6428;
    const sLen = Math.hypot(sunX, sunY, sunZ);

    const uniformData = new Float32Array(24);
    uniformData.set(vp, 0); // 16 floats (0..15)
    uniformData[16] = sunX / sLen;
    uniformData[17] = sunY / sLen;
    uniformData[18] = sunZ / sLen;
    uniformData[19] = 0.35; // ambient light intensity
    uniformData[20] = eye[0];
    uniformData[21] = eye[1];
    uniformData[22] = eye[2];
    uniformData[23] = 0.0;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.72, g: 0.81, b: 0.90, a: 1.0 }, // Sky blue
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTextureView,
        depthClearValue: 0.0, // Reversed-Z
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(this.indexCount);
    pass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  async readScreen(cam: Camera): Promise<Uint8Array> {
    this.render(cam);
    const canvas = this.context.canvas as HTMLCanvasElement;
    const w = cam.width ?? canvas.width;
    const h = cam.height ?? canvas.height;
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const readBuffer = this.device.createBuffer({
      size: bytesPerRow * h,
      usage: COPY_DST | MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.context.getCurrentTexture() },
      { buffer: readBuffer, bytesPerRow },
      [w, h, 1]
    );
    this.device.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(MAP_READ);
    const raw = new Uint8Array(readBuffer.getMappedRange());
    const out = new Uint8Array(w * h * 4);
    const isBgra = this.canvasFormat === 'bgra8unorm';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcIdx = y * bytesPerRow + x * 4;
        const dstIdx = (y * w + x) * 4;
        out[dstIdx] = raw[srcIdx + (isBgra ? 2 : 0)];
        out[dstIdx + 1] = raw[srcIdx + 1];
        out[dstIdx + 2] = raw[srcIdx + (isBgra ? 0 : 2)];
        out[dstIdx + 3] = raw[srcIdx + 3];
      }
    }
    readBuffer.destroy();
    return out;
  }
}
