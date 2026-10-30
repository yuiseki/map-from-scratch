// examples/webgpu/001-gpu-driven-culling/map.ts

// WebGPU usage and stage bit flags
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

export interface CullingMap {
  canvas: HTMLCanvasElement;
  buildingCount: number;
  gpu: string;
  render: () => void;
  orbitBy: (dyaw: number, dpitch: number) => void;
  zoomBy: (delta: number) => void;
  getVisibleCount: () => Promise<number>;
  readPixel: (x: number, y: number) => Promise<Uint8Array>;
}

// 4x4 Matrix and Frustum utilities
function mat4Perspective(fovRad: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = (2 * far * near) * nf;
  return out;
}

function mat4LookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
  let [ex, ey, ez] = eye;
  let [tx, ty, tz] = target;
  let [ux, uy, uz] = up;

  let z0 = ex - tx, z1 = ey - ty, z2 = ez - tz;
  let len = 1 / Math.hypot(z0, z1, z2);
  z0 *= len; z1 *= len; z2 *= len;

  let x0 = uy * z2 - uz * z1, x1 = uz * z0 - ux * z2, x2 = ux * z1 - uy * z0;
  len = 1 / Math.hypot(x0, x1, x2);
  x0 *= len; x1 *= len; x2 *= len;

  let y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;

  const out = new Float32Array(16);
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * ex + x1 * ey + x2 * ez);
  out[13] = -(y0 * ex + y1 * ey + y2 * ez);
  out[14] = -(z0 * ex + z1 * ey + z2 * ez);
  out[15] = 1;
  return out;
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
    out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
    out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
    out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
  return out;
}

// Extract 6 frustum planes: [A, B, C, D] where Ax + By + Cz + D >= 0 is inside
function extractFrustumPlanes(vp: Float32Array): Float32Array {
  const planes = new Float32Array(24);
  const m = vp;

  // Left
  planes[0]  = m[3] + m[0];
  planes[1]  = m[7] + m[4];
  planes[2]  = m[11] + m[8];
  planes[3]  = m[15] + m[12];

  // Right
  planes[4]  = m[3] - m[0];
  planes[5]  = m[7] - m[4];
  planes[6]  = m[11] - m[8];
  planes[7]  = m[15] - m[12];

  // Bottom
  planes[8]  = m[3] + m[1];
  planes[9]  = m[7] + m[5];
  planes[10] = m[11] + m[9];
  planes[11] = m[15] + m[13];

  // Top
  planes[12] = m[3] - m[1];
  planes[13] = m[7] - m[5];
  planes[14] = m[11] - m[9];
  planes[15] = m[15] - m[13];

  // Near
  planes[16] = m[2];
  planes[17] = m[6];
  planes[18] = m[10];
  planes[19] = m[14];

  // Far
  planes[20] = m[3] - m[2];
  planes[21] = m[7] - m[6];
  planes[22] = m[11] - m[10];
  planes[23] = m[15] - m[14];

  // Normalize all planes
  for (let i = 0; i < 6; i++) {
    const off = i * 4;
    const len = 1.0 / Math.hypot(planes[off], planes[off + 1], planes[off + 2]);
    planes[off] *= len;
    planes[off + 1] *= len;
    planes[off + 2] *= len;
    planes[off + 3] *= len;
  }
  return planes;
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<CullingMap> {
  if (!navigator.gpu) throw new Error('WebGPU not supported on this browser/platform');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter found');
  const gpuDesc = (adapter as any).info?.description || (adapter as any).info?.architecture || 'WebGPU SwiftShader';
  const device = await adapter.requestDevice();

  device.lost.then((info) => {
    console.error('WebGPU device was lost:', info);
  });

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
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }
  createColorTexture(canvas.width || 1024, canvas.height || 768);

  // Load baked data
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`Failed to load buildings binary: ${res.status}`);
  const ab = await res.arrayBuffer();
  const dv = new DataView(ab);

  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'WGCL' || dv.getUint16(4, true) !== 2) throw new Error(`Invalid magic: ${magic}`);

  const buildingCount = dv.getUint16(6, true);
  const vertexCount = dv.getUint16(8, true);
  const indexCount = dv.getUint16(10, true);

  let offset = 32;
  // The file has [x, y, height, size] in decimetres; the GPU struct is
  // [x, y, z, height, size, radius, colorType, pad] in metres.
  const packed = new Int16Array(ab, offset, buildingCount * 4);
  const instanceBufferData = new Float32Array(buildingCount * 8);
  for (let i = 0; i < buildingCount; i++) {
    const h = packed[i * 4 + 2] / 10, s = packed[i * 4 + 3] / 10;
    instanceBufferData.set([packed[i * 4] / 10, packed[i * 4 + 1] / 10, 0, h, s,
      Math.sqrt(s * s * 0.5 + h * h * 0.25), h > 100 ? 2 : h > 40 ? 1 : 0, 0], i * 8);
  }
  offset += buildingCount * 8;

  const vertexBytes = vertexCount * 6 * 4;
  const vertexBufferData = new Float32Array(ab, offset, vertexCount * 6);
  offset += vertexBytes;

  const indexBufferData = new Uint16Array(ab, offset, indexCount);

  // GPU Buffers
  const vertexBuffer = device.createBuffer({
    size: vertexBufferData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexBufferData);

  const indexBuffer = device.createBuffer({
    size: indexBufferData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indexBufferData);

  const instanceBuffer = device.createBuffer({
    size: instanceBufferData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(instanceBuffer, 0, instanceBufferData);

  // Indirect buffer: 5 uint32s = 20 bytes
  // [indexCount: 36, instanceCount: 0, firstIndex: 0, baseVertex: 0, firstInstance: 0]
  const indirectBuffer = device.createBuffer({
    size: 20,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  const culledIndexBuffer = device.createBuffer({
    size: buildingCount * 4,
    usage: GPUBufferUsage.STORAGE,
  });

  // Camera uniform: viewProj (16 floats) + frustum planes (6 * 4 = 24 floats) = 40 floats (160 bytes -> pad to 256)
  const uniformBuffer = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // 1. Compute Pipeline for Frustum Culling
  const computeShader = device.createShaderModule({
    code: `
      struct Camera {
        viewProj: mat4x4f,
        frustum: array<vec4f, 6>,
      };
      @group(0) @binding(0) var<uniform> camera: Camera;

      struct Building {
        pos: vec3f,
        height: f32,
        size: f32,
        radius: f32,
        colorType: f32,
        padding: f32,
      };
      @group(0) @binding(1) var<storage, read> instances: array<Building>;

      struct IndirectArgs {
        indexCount: u32,
        instanceCount: atomic<u32>,
        firstIndex: u32,
        baseVertex: u32,
        firstInstance: u32,
      };
      @group(0) @binding(2) var<storage, read_write> indirectArgs: IndirectArgs;
      @group(0) @binding(3) var<storage, read_write> culledIndices: array<u32>;

      @compute @workgroup_size(64)
      fn computeMain(@builtin(global_invocation_id) globalId: vec3u) {
        let idx = globalId.x;
        if (idx >= ${buildingCount}u) { return; }

        let b = instances[idx];
        let center = vec4f(b.pos.x, b.pos.y, b.pos.z + b.height * 0.5, 1.0);
        let r = b.radius;

        // Test against 6 frustum planes
        for (var i = 0u; i < 6u; i = i + 1u) {
          if (dot(camera.frustum[i], center) < -r) {
            return; // Outside frustum
          }
        }

        // Inside frustum: atomic allocate slot in culled list
        let slot = atomicAdd(&indirectArgs.instanceCount, 1u);
        culledIndices[slot] = idx;
      }
    `,
  });

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
    compute: { module: computeShader, entryPoint: 'computeMain' },
  });

  const computeBindGroup = device.createBindGroup({
    layout: computeBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: instanceBuffer } },
      { binding: 2, resource: { buffer: indirectBuffer } },
      { binding: 3, resource: { buffer: culledIndexBuffer } },
    ],
  });

  // 2. Render Pipeline for Indirect Instanced Mesh Draw
  const renderShader = device.createShaderModule({
    code: `
      struct Camera {
        viewProj: mat4x4f,
        frustum: array<vec4f, 6>,
      };
      @group(0) @binding(0) var<uniform> camera: Camera;

      struct Building {
        pos: vec3f,
        height: f32,
        size: f32,
        radius: f32,
        colorType: f32,
        padding: f32,
      };
      @group(0) @binding(1) var<storage, read> instances: array<Building>;
      @group(0) @binding(2) var<storage, read> culledIndices: array<u32>;

      struct VertexInput {
        @location(0) position: vec3f,
        @location(1) normal: vec3f,
      };

      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) normal: vec3f,
        @location(1) color: vec3f,
      };

      @vertex
      fn vsMain(
        input: VertexInput,
        @builtin(instance_index) instIdx: u32
      ) -> VertexOutput {
        let buildingIdx = culledIndices[instIdx];
        let b = instances[buildingIdx];

        let worldPos = vec3f(
          input.position.x * b.size + b.pos.x,
          input.position.y * b.size + b.pos.y,
          input.position.z * b.height + b.pos.z
        );

        var baseColor = vec3f(0.35, 0.42, 0.55); // low-rise
        if (b.colorType > 1.5) {
          baseColor = vec3f(0.85, 0.40, 0.25); // high-rise
        } else if (b.colorType > 0.5) {
          baseColor = vec3f(0.25, 0.65, 0.85); // mid-rise
        }

        var output: VertexOutput;
        output.position = camera.viewProj * vec4f(worldPos, 1.0);
        output.normal = input.normal;
        output.color = baseColor;
        return output;
      }

      @fragment
      fn fsMain(input: VertexOutput) -> @location(0) vec4f {
        let lightDir = normalize(vec3f(0.4, -0.6, 0.8));
        let diff = max(0.0, dot(input.normal, lightDir)) * 0.65 + 0.35;
        return vec4f(input.color * diff, 1.0);
      }
    `,
  });

  const renderBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: instanceBuffer } },
      { binding: 2, resource: { buffer: culledIndexBuffer } },
    ],
  });

  let depthTexture: GPUTexture | null = null;

  function createDepthTexture(w: number, h: number) {
    if (depthTexture) depthTexture.destroy();
    depthTexture = device.createTexture({
      size: [w, h],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  const renderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
    vertex: {
      module: renderShader,
      entryPoint: 'vsMain',
      buffers: [
        {
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
            { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
          ],
        },
      ],
    },
    fragment: {
      module: renderShader,
      entryPoint: 'fsMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back',
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus',
    },
  });

  // Camera state
  let yaw = 0.8;
  let pitch = 0.55;
  let distance = 1600;

  function updateCameraUniforms(w: number, h: number) {
    const aspect = w / h;
    const proj = mat4Perspective(Math.PI / 4, aspect, 10, 10000);

    const eyeX = distance * Math.cos(pitch) * Math.sin(yaw);
    const eyeY = distance * Math.cos(pitch) * Math.cos(yaw);
    const eyeZ = distance * Math.sin(pitch);

    const view = mat4LookAt([eyeX, eyeY, eyeZ], [0, 0, 50], [0, 0, 1]);
    const vp = mat4Multiply(proj, view);
    const frustumPlanes = extractFrustumPlanes(vp);

    // Uniform layout: viewProj (16 floats = 64B) + frustum (24 floats = 96B) = 160B
    const uniformData = new Float32Array(40);
    uniformData.set(vp, 0);
    uniformData.set(frustumPlanes, 16);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
  }

  // Initial setup for indirect buffer: indexCount=36, instanceCount=0
  const initIndirectData = new Uint32Array([36, 0, 0, 0, 0]);

  function render() {
    const w = canvas.width || 1024;
    const h = canvas.height || 768;
    if (!depthTexture || depthTexture.width !== w || depthTexture.height !== h) {
      createDepthTexture(w, h);
    }

    updateCameraUniforms(w, h);

    // Reset indirectBuffer instanceCount to 0 before compute
    device.queue.writeBuffer(indirectBuffer, 0, initIndirectData);

    const commandEncoder = device.createCommandEncoder();

    // 1. Compute Pass: GPU Frustum Culling
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(buildingCount / 64));
    computePass.end();

    // 2. Render Pass: drawIndexedIndirect
    const view = webgpuCtx ? webgpuCtx.getCurrentTexture().createView() : colorTexture.createView();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.08, g: 0.10, b: 0.16, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthTexture!.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.setIndexBuffer(indexBuffer, 'uint16');
    renderPass.drawIndexedIndirect(indirectBuffer, 0);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
  }

  // Interaction handlers
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    yaw += dx * 0.005;
    pitch = Math.max(0.1, Math.min(1.4, pitch + dy * 0.005));
    lastX = e.clientX;
    lastY = e.clientY;
    render();
  });

  const stopDrag = (e: PointerEvent) => {
    if (dragging) {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    distance = Math.max(300, Math.min(4000, distance + e.deltaY * 1.5));
    render();
  }, { passive: false });

  // Initial draw
  render();

  return {
    canvas,
    buildingCount,
    gpu: gpuDesc,
    render,
    orbitBy(dyaw: number, dpitch: number) {
      yaw += dyaw;
      pitch = Math.max(0.1, Math.min(1.4, pitch + dpitch));
      render();
    },
    zoomBy(delta: number) {
      distance = Math.max(300, Math.min(4000, distance + delta));
      render();
    },
    async getVisibleCount(): Promise<number> {
      const readBuffer = device.createBuffer({
        size: 20,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const commandEncoder = device.createCommandEncoder();
      commandEncoder.copyBufferToBuffer(indirectBuffer, 0, readBuffer, 0, 20);
      device.queue.submit([commandEncoder.finish()]);

      await readBuffer.mapAsync(GPUMapMode.READ);
      const copy = new Uint32Array(readBuffer.getMappedRange());
      const visibleCount = copy[1]; // instanceCount
      readBuffer.unmap();
      readBuffer.destroy();
      return visibleCount;
    },
    async readPixel(x: number, y: number): Promise<Uint8Array> {
      render();
      const texture = webgpuCtx ? webgpuCtx.getCurrentTexture() : colorTexture;
      const readBuffer = device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const commandEncoder = device.createCommandEncoder();
      commandEncoder.copyTextureToBuffer(
        { texture, origin: { x: Math.max(0, Math.min(canvas.width - 1, Math.round(x))), y: Math.max(0, Math.min(canvas.height - 1, Math.round(y))) } },
        { buffer: readBuffer, bytesPerRow: 256 },
        { width: 1, height: 1 }
      );
      device.queue.submit([commandEncoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      const pixel = new Uint8Array(readBuffer.getMappedRange().slice(0, 4));
      readBuffer.unmap();
      readBuffer.destroy();
      return pixel;
    }
  };
}
