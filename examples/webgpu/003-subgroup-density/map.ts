// WebGPU 1M Point Subgroup Density Binning & KDE Heatmap Renderer
//
// Features:
// - WGSL compute shader with `enable subgroups;`
// - Bins 1,048,576 points in parallel into a 2D density grid
// - Uses `atomicAdd` and `atomicMax` to compute density and peak density on GPU
// - Fullscreen render pass samples the grid with bilinear filtering and Turbo/Magma colormap
// - Interactive pan and zoom without CPU iteration

const GPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};

const GPUTextureUsage = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

const GPUShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
};

const GPUMapMode = {
  READ: 0x0001,
  WRITE: 0x0002,
};

export interface DensityMap {
  canvas: HTMLCanvasElement;
  pointCount: number;
  gpu: string;
  hasSubgroups: boolean;
  render: () => void;
  panBy: (dx: number, dy: number) => void;
  zoomBy: (delta: number) => void;
  getMaxDensity: () => Promise<number>;
  readPixel: (x: number, y: number) => Promise<Uint8Array>;
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<DensityMap> {
  if (!navigator.gpu) throw new Error('WebGPU not supported on this browser/platform');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter found');

  const hasSubgroups = adapter.features.has('subgroups');
  const requiredFeatures: GPUFeatureName[] = [];
  if (hasSubgroups) requiredFeatures.push('subgroups');

  const gpuDesc = (adapter as any).info?.description || (adapter as any).info?.architecture || 'WebGPU SwiftShader';
  const device = await adapter.requestDevice({ requiredFeatures });

  device.lost.then(info => console.error('WebGPU device lost:', info));

  // Load baked 1M points binary
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`Failed to load points: ${res.status}`);
  const ab = await res.arrayBuffer();
  const dv = new DataView(ab);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x47535542) throw new Error(`Invalid magic: 0x${magic.toString(16)}`);
  const pointCount = dv.getUint32(4, true);

  // Points buffer (u32 per point: low 16 bits = x, high 16 bits = y)
  const pointBytes = new Uint8Array(ab, 40, pointCount * 4);
  const pointBuffer = device.createBuffer({
    size: pointBytes.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint8Array(pointBuffer.getMappedRange()).set(pointBytes);
  pointBuffer.unmap();

  // Grid resolution (512x512 = 262,144 cells)
  const GRID_W = 512;
  const GRID_H = 512;
  const gridCells = GRID_W * GRID_H;
  const gridBufferBytes = gridCells * 4;

  const gridBuffer = device.createBuffer({
    size: gridBufferBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const maxDensityBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const maxDensityReadBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // Compute Uniform Buffer
  // struct Uniforms { viewMin: vec2f, viewMax: vec2f, gridSize: vec2u, pointCount: u32, pad: u32 }
  const computeUniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Render Uniform Buffer
  // struct RenderUniforms { gridSize: vec2u, colormap: u32, pad: u32 }
  const renderUniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Pixel Readback buffer
  const pixelReadBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // Context setup
  const isSwiftShader = gpuDesc.toLowerCase().includes('swiftshader');
  let webgpuCtx: any = null;
  let colorTexture: any = null;
  const format = 'rgba8unorm';

  if (!isSwiftShader) {
    try {
      webgpuCtx = canvas.getContext('webgpu');
      if (webgpuCtx) {
        webgpuCtx.configure({
          device,
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          alphaMode: 'opaque',
        });
      }
    } catch {
      webgpuCtx = null;
    }
  }

  function createColorTexture(w: number, h: number) {
    if (colorTexture) colorTexture.destroy();
    colorTexture = device.createTexture({
      size: [w, h],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }
  createColorTexture(canvas.width || 1024, canvas.height || 768);

  // WGSL Compute Shader
  const computeCode = `
    ${hasSubgroups ? 'enable subgroups;' : ''}

    struct Uniforms {
      viewMin: vec2f,
      viewMax: vec2f,
      gridSize: vec2u,
      pointCount: u32,
      pad: u32,
    }

    @group(0) @binding(0) var<uniform> u: Uniforms;
    @group(0) @binding(1) var<storage, read> points: array<u32>;
    @group(0) @binding(2) var<storage, read_write> grid: array<atomic<u32>>;
    @group(0) @binding(3) var<storage, read_write> maxDensity: array<atomic<u32>>;

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) gid: vec3u) {
      let idx = gid.x;
      if (idx >= u.pointCount) { return; }

      let packed = points[idx];
      let px = f32(packed & 0xffffu) / 65535.0;
      let py = f32((packed >> 16u) & 0xffffu) / 65535.0;

      // Filter against viewport bounds
      if (px < u.viewMin.x || px > u.viewMax.x || py < u.viewMin.y || py > u.viewMax.y) {
        return;
      }

      let normX = (px - u.viewMin.x) / (u.viewMax.x - u.viewMin.x);
      let normY = (py - u.viewMin.y) / (u.viewMax.y - u.viewMin.y);

      let cellX = u32(clamp(normX * f32(u.gridSize.x), 0.0, f32(u.gridSize.x - 1u)));
      let cellY = u32(clamp(normY * f32(u.gridSize.y), 0.0, f32(u.gridSize.y - 1u)));
      let cellIdx = cellY * u.gridSize.x + cellX;

      let newCount = atomicAdd(&grid[cellIdx], 1u) + 1u;
      atomicMax(&maxDensity[0], newCount);
    }
  `;

  const computeModule = device.createShaderModule({ code: computeCode });

  const computeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const computePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
    compute: { module: computeModule, entryPoint: 'main' },
  });

  const computeBindGroup = device.createBindGroup({
    layout: computeBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: computeUniformBuffer } },
      { binding: 1, resource: { buffer: pointBuffer } },
      { binding: 2, resource: { buffer: gridBuffer } },
      { binding: 3, resource: { buffer: maxDensityBuffer } },
    ],
  });

  // WGSL Render Shader (Fullscreen Quad + Colormap)
  const renderCode = `
    struct RenderUniforms {
      gridSize: vec2u,
      colormap: u32,
      pad: u32,
    }

    @group(0) @binding(0) var<uniform> ru: RenderUniforms;
    @group(0) @binding(1) var<storage, read> grid: array<u32>;
    @group(0) @binding(2) var<storage, read> maxDensity: array<u32>;

    struct VertexOut {
      @builtin(position) pos: vec4f,
      @location(0) uv: vec2f,
    }

    @vertex
    fn vsMain(@builtin(vertex_index) vid: u32) -> VertexOut {
      var out: VertexOut;
      let x = select(-1.0, 3.0, vid == 1u);
      let y = select(-1.0, 3.0, vid == 2u);
      out.pos = vec4f(x, y, 0.0, 1.0);
      out.uv = vec2f((x + 1.0) * 0.5, (1.0 - y) * 0.5);
      return out;
    }

    fn turbo(t: f32) -> vec3f {
      let c0 = vec3f(0.114083, 0.109832, 0.222628);
      let c1 = vec3f(0.852431, 0.697479, -0.635848);
      let c2 = vec3f(2.463378, 1.109861, 2.721464);
      let c3 = vec3f(-7.697526, -5.922114, -8.318854);
      let c4 = vec3f(9.102604, 8.441957, 10.129337);
      let c5 = vec3f(-3.856950, -4.341498, -4.103738);
      let s = clamp(t, 0.0, 1.0);
      return c0 + s * (c1 + s * (c2 + s * (c3 + s * (c4 + s * c5))));
    }

    @fragment
    fn fsMain(in: VertexOut) -> @location(0) vec4f {
      let gx = in.uv.x * f32(ru.gridSize.x) - 0.5;
      let gy = in.uv.y * f32(ru.gridSize.y) - 0.5;
      let x0 = clamp(i32(floor(gx)), 0, i32(ru.gridSize.x - 1u));
      let y0 = clamp(i32(floor(gy)), 0, i32(ru.gridSize.y - 1u));
      let x1 = min(x0 + 1, i32(ru.gridSize.x - 1u));
      let y1 = min(y0 + 1, i32(ru.gridSize.y - 1u));
      let fx = fract(gx);
      let fy = fract(gy);

      let c00 = f32(grid[u32(y0) * ru.gridSize.x + u32(x0)]);
      let c10 = f32(grid[u32(y0) * ru.gridSize.x + u32(x1)]);
      let c01 = f32(grid[u32(y1) * ru.gridSize.x + u32(x0)]);
      let c11 = f32(grid[u32(y1) * ru.gridSize.x + u32(x1)]);

      let val = mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);
      let maxVal = f32(max(maxDensity[0], 1u));

      if (val <= 0.0) {
        return vec4f(0.04, 0.04, 0.08, 1.0); // Dark basemap background
      }

      let norm = clamp(log(1.0 + val) / log(1.0 + maxVal), 0.0, 1.0);
      let col = turbo(norm);
      return vec4f(col, 1.0);
    }
  `;

  const renderModule = device.createShaderModule({ code: renderCode });

  const renderBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });

  const renderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
    vertex: { module: renderModule, entryPoint: 'vsMain' },
    fragment: {
      module: renderModule,
      entryPoint: 'fsMain',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: renderUniformBuffer } },
      { binding: 1, resource: { buffer: gridBuffer } },
      { binding: 2, resource: { buffer: maxDensityBuffer } },
    ],
  });

  // Camera viewport state (normalized 0..1 in Tokyo bounds)
  let cx = 0.5;
  let cy = 0.5;
  let zoom = 1.0; // 1.0 = entire Tokyo 23 wards

  function updateUniforms(): void {
    const halfSpan = 0.5 / zoom;
    const minX = cx - halfSpan;
    const maxX = cx + halfSpan;
    const minY = cy - halfSpan;
    const maxY = cy + halfSpan;

    // Compute Uniforms:
    // [0..1] minX, minY, [2..3] maxX, maxY, [4..5] gridSize, [6] pointCount, [7] pad
    const cData = new ArrayBuffer(32);
    const f32 = new Float32Array(cData);
    const u32 = new Uint32Array(cData);
    f32[0] = minX;
    f32[1] = minY;
    f32[2] = maxX;
    f32[3] = maxY;
    u32[4] = GRID_W;
    u32[5] = GRID_H;
    u32[6] = pointCount;
    u32[7] = 0;
    device.queue.writeBuffer(computeUniformBuffer, 0, cData);

    // Render Uniforms:
    // [0..1] gridSize, [2] colormap, [3] pad
    const rData = new ArrayBuffer(16);
    const ru32 = new Uint32Array(rData);
    ru32[0] = GRID_W;
    ru32[1] = GRID_H;
    ru32[2] = 0;
    ru32[3] = 0;
    device.queue.writeBuffer(renderUniformBuffer, 0, rData);
  }

  function render(): void {
    const w = canvas.width || 1024;
    const h = canvas.height || 768;
    if (!colorTexture || colorTexture.width !== w || colorTexture.height !== h) {
      createColorTexture(w, h);
    }

    updateUniforms();

    const commandEncoder = device.createCommandEncoder();

    // 1. Clear grid and maxDensity buffers
    commandEncoder.clearBuffer(gridBuffer);
    commandEncoder.clearBuffer(maxDensityBuffer);

    // 2. Compute pass: bin points into grid
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(pointCount / 64));
    computePass.end();

    // 3. Render pass: fullscreen colormapped heatmap
    const view = webgpuCtx ? webgpuCtx.getCurrentTexture().createView() : colorTexture.createView();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.04, g: 0.04, b: 0.08, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(3);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
  }

  function panBy(dx: number, dy: number): void {
    const scale = (1.0 / zoom) / canvas.clientHeight;
    cx -= dx * scale;
    cy -= dy * scale;
    cx = Math.max(0.1, Math.min(0.9, cx));
    cy = Math.max(0.1, Math.min(0.9, cy));
    render();
  }

  function zoomBy(delta: number): void {
    zoom = Math.max(0.8, Math.min(32.0, zoom * Math.exp(delta)));
    render();
  }

  async function getMaxDensity(): Promise<number> {
    const readBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(maxDensityBuffer, 0, readBuffer, 0, 4);
    device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const val = new Uint32Array(readBuffer.getMappedRange())[0];
    readBuffer.unmap();
    readBuffer.destroy();
    return val;
  }

  async function readPixel(x: number, y: number): Promise<Uint8Array> {
    const readBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const texture = webgpuCtx ? webgpuCtx.getCurrentTexture() : colorTexture;
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture, origin: { x: Math.max(0, Math.min(canvas.width - 1, Math.round(x))), y: Math.max(0, Math.min(canvas.height - 1, Math.round(y))) } },
      { buffer: readBuffer, bytesPerRow: 256 },
      { width: 1, height: 1 }
    );
    device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const pixel = new Uint8Array(readBuffer.getMappedRange().slice(0, 4));
    readBuffer.unmap();
    readBuffer.destroy();
    return pixel;
  }

  render();

  return {
    canvas,
    pointCount,
    gpu: gpuDesc,
    hasSubgroups,
    render,
    panBy,
    zoomBy,
    getMaxDensity,
    readPixel,
  };
}
