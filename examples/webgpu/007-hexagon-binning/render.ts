// WebGPU Real-time Hexagon Binning & 3D Extruded Columns.
// Bins 140,029 points in parallel on GPU compute, and renders 3D hexagon columns
// without any CPU-side re-aggregation.

export interface Camera {
  x: number;          // center X in Mercator meters
  y: number;          // center Y in Mercator meters
  distance: number;   // view distance in meters
  pitch: number;      // pitch angle (degrees)
  yaw: number;        // yaw angle (degrees)
  width: number;
  height: number;
  radius: number;     // hexagon radius in meters (500 .. 4000)
  elevationScale: number; // height scaling multiplier
  coverage: number;   // hexagon width factor (0.5 .. 1.0)
  upperPercentile: number; // upper percentile clamp (50 .. 100)
}

export interface PointDataset {
  points: Float32Array; // [x0, y0, x1, y1, ...] in Mercator meters
  count: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const VERTEX = 0x20, UNIFORM = 0x40, STORAGE = 0x80, COPY_DST = 0x8, COPY_SRC = 0x4, MAP_READ = 0x1;
const RENDER_ATTACHMENT = 0x10, TEX_COPY_SRC = 0x01;
const SAMPLES = 4;

// Flat-topped hexagon unit geometry (54 vertices = 18 triangles: 6 top + 12 sides)
function createUnitHexMesh(): Float32Array {
  const n = 6;
  const topFan = n * 3;
  const sideQuads = n * 6;
  const totalVertices = topFan + sideQuads;
  const stride = 6; // pos: vec3f, normal: vec3f
  const data = new Float32Array(totalVertices * stride);

  const angles = new Float32Array(n);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 60) * Math.PI / 180;
    angles[i] = a;
    pts.push([Math.cos(a), Math.sin(a)]);
  }

  let offset = 0;
  const pushV = (x: number, y: number, zRatio: number, nx: number, ny: number, nz: number) => {
    const idx = offset * stride;
    data[idx] = x; data[idx + 1] = y; data[idx + 2] = zRatio;
    data[idx + 3] = nx; data[idx + 4] = ny; data[idx + 5] = nz;
    offset++;
  };

  // Top surface
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    pushV(0, 0, 1.0, 0, 0, 1);
    pushV(pts[i][0], pts[i][1], 1.0, 0, 0, 1);
    pushV(pts[next][0], pts[next][1], 1.0, 0, 0, 1);
  }

  // Side walls
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const p1 = pts[i], p2 = pts[next];
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, ny = -dx / len;

    pushV(p1[0], p1[1], 0.0, nx, ny, 0);
    pushV(p2[0], p2[1], 0.0, nx, ny, 0);
    pushV(p2[0], p2[1], 1.0, nx, ny, 0);

    pushV(p1[0], p1[1], 0.0, nx, ny, 0);
    pushV(p2[0], p2[1], 1.0, nx, ny, 0);
    pushV(p1[0], p1[1], 1.0, nx, ny, 0);
  }

  return data;
}

const COMPUTE_WGSL = /* wgsl */ `
struct ComputeUniforms {
  pointCount: u32,
  gridWidth: u32,
  gridHeight: u32,
  radius: f32,
  originX: f32,
  originY: f32,
  pad0: f32,
  pad1: f32,
}
@group(0) @binding(0) var<uniform> u: ComputeUniforms;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;

// Hexagonal axial coordinates (flat-topped hexes)
// Width between centers = 1.5 * R, Height between centers = sqrt(3) * R
fn worldToHex(pos: vec2f, r: f32) -> vec2i {
  let q = (2.0 / 3.0 * pos.x) / r;
  let s_coord = (-1.0 / 3.0 * pos.x + sqrt(3.0) / 3.0 * pos.y) / r;
  let s_val = -q - s_coord;

  var rx = round(q);
  var ry = round(s_coord);
  var rz = round(s_val);

  let x_diff = abs(rx - q);
  let y_diff = abs(ry - s_coord);
  let z_diff = abs(rz - s_val);

  if (x_diff > y_diff && x_diff > z_diff) {
    rx = -ry - rz;
  } else if (y_diff > z_diff) {
    ry = -rx - rz;
  }
  return vec2i(i32(rx), i32(ry));
}

@compute @workgroup_size(256)
fn clearCells(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  let totalCells = u.gridWidth * u.gridHeight;
  if (idx < totalCells) {
    atomicStore(&cellCounts[idx], 0u);
  }
}

@compute @workgroup_size(256)
fn binPoints(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= u.pointCount) { return; }

  let pt = points[idx];
  let localPos = vec2f(pt.x - u.originX, pt.y - u.originY);
  let hex = worldToHex(localPos, u.radius);

  let col = hex.x;
  let row = hex.y;
  if (col >= 0 && col < i32(u.gridWidth) && row >= 0 && row < i32(u.gridHeight)) {
    let cellIdx = u32(row) * u.gridWidth + u32(col);
    atomicAdd(&cellCounts[cellIdx], 1u);
  }
}
`;

const RENDER_WGSL = /* wgsl */ `
struct RenderUniforms {
  viewProj: mat4x4f,
  lightDir: vec3f,
  radius: f32,
  gridOrigin: vec2f,
  gridWidth: u32,
  maxCount: f32,
  elevationScale: f32,
  coverage: f32,
  pad0: f32,
  pad1: f32,
}
@group(0) @binding(0) var<uniform> u: RenderUniforms;
@group(0) @binding(1) var<storage, read> cellCounts: array<u32>;

struct VertexIn {
  @location(0) localPos: vec3f, // unit hex x, y in [-1, 1], z in [0, 1]
  @location(1) normal: vec3f,
}

struct VertexOut {
  @builtin(position) clipPos: vec4f,
  @location(0) normal: vec3f,
  @location(1) color: vec3f,
}

// 6-stop deck.gl style heat colors
fn countToColor(t: f32) -> vec3f {
  let c = clamp(t, 0.0, 1.0);
  if (c < 0.2) {
    let s = c / 0.2;
    return mix(vec3f(0.1, 0.2, 0.4), vec3f(0.12, 0.5, 0.55), s);
  } else if (c < 0.4) {
    let s = (c - 0.2) / 0.2;
    return mix(vec3f(0.12, 0.5, 0.55), vec3f(0.2, 0.75, 0.4), s);
  } else if (c < 0.6) {
    let s = (c - 0.4) / 0.2;
    return mix(vec3f(0.2, 0.75, 0.4), vec3f(0.9, 0.85, 0.2), s);
  } else if (c < 0.8) {
    let s = (c - 0.6) / 0.2;
    return mix(vec3f(0.9, 0.85, 0.2), vec3f(0.95, 0.45, 0.1), s);
  } else {
    let s = (c - 0.8) / 0.2;
    return mix(vec3f(0.95, 0.45, 0.1), vec3f(0.9, 0.1, 0.25), s);
  }
}

fn hexToWorld(q: f32, r: f32, rad: f32) -> vec2f {
  let x = rad * (1.5 * q);
  let y = rad * (sqrt(3.0) / 2.0 * q + sqrt(3.0) * r);
  return vec2f(x, y);
}

@vertex
fn vs(in: VertexIn, @builtin(instance_index) instId: u32) -> VertexOut {
  var out: VertexOut;
  let count = cellCounts[instId];
  if (count == 0u) {
    // Degenerate vertex behind far clip plane
    out.clipPos = vec4f(0.0, 0.0, -1.0, 1.0);
    return out;
  }

  let col = f32(instId % u.gridWidth);
  let row = f32(instId / u.gridWidth);
  let center = u.gridOrigin + hexToWorld(col, row, u.radius);

  let ratio = clamp(f32(count) / max(u.maxCount, 1.0), 0.0, 1.0);
  // Extrude height based on count
  let height = (pow(ratio, 0.7) * 45000.0 + 800.0) * u.elevationScale;

  let xy = center + in.localPos.xy * (u.radius * u.coverage);
  let z = in.localPos.z * height;

  out.clipPos = u.viewProj * vec4f(xy.x, xy.y, z, 1.0);
  out.normal = in.normal;
  out.color = countToColor(ratio);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let N = normalize(in.normal);
  let L = normalize(u.lightDir);
  let diff = max(dot(N, L), 0.0);
  let ambient = select(0.42, 0.65, in.normal.z > 0.7);
  let light = clamp(ambient + diff * 0.58, 0.25, 1.0);
  return vec4f(in.color * light, 1.0);
}
`;

export async function createRenderer(canvas: HTMLCanvasElement) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU が使えません');
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
  });
  device.lost.then(e => console.error('WebGPU device lost:', e.message));
  const gpu = `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) throw new Error('WebGPU の canvas が使えません');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque', usage: RENDER_ATTACHMENT | TEX_COPY_SRC });

  // 1. Compute Pipelines
  const computeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: 0x4, buffer: { type: 'uniform' } },
      { binding: 1, visibility: 0x4, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: 0x4, buffer: { type: 'storage' } },
    ],
  });
  const computePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [computeBindGroupLayout],
  });

  const computeModule = device.createShaderModule({ code: COMPUTE_WGSL });
  const clearPipeline = device.createComputePipeline({
    layout: computePipelineLayout,
    compute: { module: computeModule, entryPoint: 'clearCells' },
  });
  const binPipeline = device.createComputePipeline({
    layout: computePipelineLayout,
    compute: { module: computeModule, entryPoint: 'binPoints' },
  });

  // 2. Render Pipeline
  const hexUnitMesh = createUnitHexMesh();
  const hexUnitBuffer = device.createBuffer({
    size: hexUnitMesh.byteLength,
    usage: VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(hexUnitBuffer.getMappedRange()).set(hexUnitMesh);
  hexUnitBuffer.unmap();

  const renderModule = device.createShaderModule({ code: RENDER_WGSL });
  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: renderModule, entryPoint: 'vs',
      buffers: [{
        arrayStride: 24, // pos: 3f, normal: 3f
        stepMode: 'vertex',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ],
      }],
    },
    fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: SAMPLES },
  });

  const computeUniformBuffer = device.createBuffer({ size: 32, usage: UNIFORM | COPY_DST });
  const renderUniformBuffer = device.createBuffer({ size: 128, usage: UNIFORM | COPY_DST });

  let pointBuffer: GPUBuffer | null = null;
  let cellCountBuffer: GPUBuffer | null = null;
  let cellCountReadBuffer: GPUBuffer | null = null;
  let computeBindGroup: GPUBindGroup | null = null;
  let renderBindGroup: GPUBindGroup | null = null;

  let currentPointCount = 0;
  let currentGridW = 0, currentGridH = 0;
  let currentOriginX = 0, currentOriginY = 0;
  let lastRadius = 0;
  let activeCellsCount = 0;
  let maxCellCount = 1;

  function uploadPoints(dataset: PointDataset) {
    if (pointBuffer) pointBuffer.destroy();
    currentPointCount = dataset.count;
    pointBuffer = device.createBuffer({
      size: dataset.points.byteLength,
      usage: STORAGE | COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(pointBuffer.getMappedRange()).set(dataset.points);
    pointBuffer.unmap();
  }

  // Allocate grid storage buffer based on bounds and radius
  function updateGridBuffers(bounds: { minX: number; minY: number; maxX: number; maxY: number }, radius: number) {
    const margin = radius * 4;
    const originX = bounds.minX - margin;
    const originY = bounds.minY - margin;
    const spanX = (bounds.maxX - bounds.minX) + margin * 2;
    const spanY = (bounds.maxY - bounds.minY) + margin * 2;

    const gridW = Math.max(10, Math.ceil(spanX / (radius * 1.5)) + 4);
    const gridH = Math.max(10, Math.ceil(spanY / (radius * Math.sqrt(3))) + 4);
    const totalCells = gridW * gridH;

    if (totalCells !== currentGridW * currentGridH || !cellCountBuffer) {
      if (cellCountBuffer) cellCountBuffer.destroy();
      if (cellCountReadBuffer) cellCountReadBuffer.destroy();

      cellCountBuffer = device.createBuffer({
        size: totalCells * 4,
        usage: STORAGE | COPY_SRC | COPY_DST,
      });
      cellCountReadBuffer = device.createBuffer({
        size: totalCells * 4,
        usage: COPY_DST | MAP_READ,
      });

      currentGridW = gridW;
      currentGridH = gridH;

      // Recreate bind groups
      computeBindGroup = device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: computeUniformBuffer } },
          { binding: 1, resource: { buffer: pointBuffer! } },
          { binding: 2, resource: { buffer: cellCountBuffer } },
        ],
      });

      renderBindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: renderUniformBuffer } },
          { binding: 1, resource: { buffer: cellCountBuffer } },
        ],
      });
    }

    currentOriginX = originX;
    currentOriginY = originY;
    lastRadius = radius;
  }

  // Execute Compute Pass: clear cells & bin points
  function runBinning(radius: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    if (!pointBuffer || currentPointCount === 0) return;
    updateGridBuffers(bounds, radius);

    const cData = new ArrayBuffer(32);
    const u32 = new Uint32Array(cData);
    const f32 = new Float32Array(cData);
    u32[0] = currentPointCount;
    u32[1] = currentGridW;
    u32[2] = currentGridH;
    f32[3] = radius;
    f32[4] = currentOriginX;
    f32[5] = currentOriginY;
    device.queue.writeBuffer(computeUniformBuffer, 0, cData);

    const totalCells = currentGridW * currentGridH;
    const encoder = device.createCommandEncoder();

    // 1. Clear Pass
    const passClear = encoder.beginComputePass();
    passClear.setPipeline(clearPipeline);
    passClear.setBindGroup(0, computeBindGroup!);
    passClear.dispatchWorkgroups(Math.ceil(totalCells / 256));
    passClear.end();

    // 2. Binning Pass
    const passBin = encoder.beginComputePass();
    passBin.setPipeline(binPipeline);
    passBin.setBindGroup(0, computeBindGroup!);
    passBin.dispatchWorkgroups(Math.ceil(currentPointCount / 256));
    passBin.end();

    device.queue.submit([encoder.finish()]);
  }

  // Read back cell counts to compute percentiles & active cell count (optional / async)
  async function computeCellStats(upperPercentile: number): Promise<{ active: number; max: number; totalCount: number }> {
    if (!cellCountBuffer || !cellCountReadBuffer) return { active: 0, max: 1, totalCount: 0 };
    const totalCells = currentGridW * currentGridH;
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(cellCountBuffer, 0, cellCountReadBuffer, 0, totalCells * 4);
    device.queue.submit([encoder.finish()]);

    await cellCountReadBuffer.mapAsync(MAP_READ);
    const counts = new Uint32Array(cellCountReadBuffer.getMappedRange());

    const activeList: number[] = [];
    let sum = 0;
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i];
      if (c > 0) {
        activeList.push(c);
        sum += c;
      }
    }
    cellCountReadBuffer.unmap();

    activeCellsCount = activeList.length;
    if (activeList.length === 0) {
      maxCellCount = 1;
      return { active: 0, max: 1, totalCount: sum };
    }

    activeList.sort((a, b) => a - b);
    const pIdx = Math.min(activeList.length - 1, Math.floor((upperPercentile / 100) * (activeList.length - 1)));
    maxCellCount = Math.max(1, activeList[pIdx]);

    return { active: activeCellsCount, max: maxCellCount, totalCount: sum };
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

  function buildViewProj(cam: Camera): Float32Array {
    const aspect = cam.width / cam.height;
    const fovY = 40 * Math.PI / 180;
    const tanHalf = Math.tan(fovY / 2);

    const near = 100.0;
    const far = 5000000.0; // 5000 km

    const proj = new Float32Array(16);
    proj[0] = 1 / (aspect * tanHalf);
    proj[5] = 1 / tanHalf;
    // Reversed-Z: at near gives 1.0, at far gives 0.0 (WebGPU NDC [0, 1])
    proj[10] = near / (far - near);
    proj[11] = -1.0;
    proj[14] = (near * far) / (far - near);

    const yaw = cam.yaw * Math.PI / 180;
    const pitch = cam.pitch * Math.PI / 180;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);

    const eyeX = cam.x + cam.distance * cp * sy;
    const eyeY = cam.y - cam.distance * cp * cy;
    const eyeZ = cam.distance * sp;

    const fx = cam.x - eyeX, fy = cam.y - eyeY, fz = -eyeZ;
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

    const viewProj = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += proj[k * 4 + i] * view[j * 4 + k];
        viewProj[j * 4 + i] = sum;
      }
    }
    return viewProj;
  }

  function draw(cam: Camera, toOffscreen = false) {
    if (!cellCountBuffer || !renderBindGroup) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    resize(Math.max(1, Math.round(cam.width * dpr)), Math.max(1, Math.round(cam.height * dpr)));

    const viewProj = buildViewProj(cam);
    const rData = new ArrayBuffer(128);
    new Float32Array(rData, 0, 16).set(viewProj);

    const f32 = new Float32Array(rData);
    const u32 = new Uint32Array(rData);

    const lx = 0.5, ly = -0.7, lz = 0.85;
    const llen = Math.hypot(lx, ly, lz);
    f32[16] = lx / llen; f32[17] = ly / llen; f32[18] = lz / llen;
    f32[19] = cam.radius;
    f32[20] = currentOriginX; f32[21] = currentOriginY;
    u32[22] = currentGridW;
    f32[23] = maxCellCount;
    f32[24] = cam.elevationScale;
    f32[25] = cam.coverage;

    device.queue.writeBuffer(renderUniformBuffer, 0, rData);

    const targetTexture = toOffscreen ? offscreen : context!.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msaa.createView(),
        resolveTarget: targetTexture.createView(),
        loadOp: 'clear',
        storeOp: 'discard',
        clearValue: [0.055, 0.085, 0.125, 1],
      }],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 0.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, renderBindGroup);
    pass.setVertexBuffer(0, hexUnitBuffer);
    // Draw 54 vertices per instance, with totalCells instances
    const totalCells = currentGridW * currentGridH;
    pass.draw(54, totalCells);
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
    uploadPoints,
    runBinning,
    computeCellStats,
    draw,
    readScreen,
    size: () => [w, h] as [number, number],
  };
}
