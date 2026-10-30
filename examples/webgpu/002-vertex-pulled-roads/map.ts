// examples/webgpu/002-vertex-pulled-roads/map.ts

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

export interface RoadMap {
  canvas: HTMLCanvasElement;
  roadCount: number;
  nodeCount: number;
  segmentCount: number;
  uploadCount: number;
  gpu: string;
  render: () => void;
  panBy: (dx: number, dy: number) => void;
  zoomBy: (delta: number) => void;
  readPixel: (x: number, y: number) => Promise<Uint8Array>;
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<RoadMap> {
  if (!navigator.gpu) throw new Error('WebGPU not supported on this browser/platform');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter found');
  const gpuDesc = (adapter as any).info?.description || (adapter as any).info?.architecture || 'WebGPU SwiftShader';
  const device = await adapter.requestDevice();

  device.lost.then(info => console.error('WebGPU device lost:', info));

  // Load baked roads binary
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`Failed to load roads: ${res.status}`);
  const ab = await res.arrayBuffer();
  const dv = new DataView(ab);

  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'VPRD') throw new Error(`Invalid magic: ${magic}`);

  const roadCount = dv.getUint32(6, true);
  const nodeCount = dv.getUint32(10, true);
  const segmentCount = dv.getUint32(14, true);

  const nodeBytes = nodeCount * 8;
  const nodeData = new Uint32Array(ab, 32, nodeCount * 2);

  let uploadCount = 0;

  // Single static Storage Buffer holding all road nodes
  const nodeBuffer = device.createBuffer({
    size: nodeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(nodeBuffer, 0, nodeData);
  uploadCount++;

  // Camera Uniform Buffer (64 bytes)
  // center: vec2f (8B), scale: f32 (4B), aspect: f32 (4B), halfScreen: vec2f (8B), padding (40B)
  const uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // The backing store follows the element's CSS size: a fixed 1024x768
  // stretched over the window made the map 1.7 times too wide at 1920x843.
  const fit = (): void => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round((canvas.clientWidth || 1024) * dpr);
    canvas.height = Math.round((canvas.clientHeight || 768) * dpr);
  };
  fit();
  window.addEventListener('resize', () => { fit(); render(); });

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

  // Programmable Vertex Pulling WGSL Shader
  const shaderModule = device.createShaderModule({
    code: `
      struct Camera {
        center: vec2f,
        scale: f32,
        aspect: f32,
        halfScreen: vec2f,
      };
      @group(0) @binding(0) var<uniform> camera: Camera;

      struct PackedNode {
        xy: u32,
        metaRoad: u32,
      };
      @group(0) @binding(1) var<storage, read> nodes: array<PackedNode>;

      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) color: vec3f,
      };

      struct Node {
        pos: vec2f,
        cls: u32,
        endpoint: u32,
        roadId: u32,
      };

      fn fetchNode(idx: u32) -> Node {
        let p = nodes[idx];
        let qx = f32(p.xy & 0xffffu) / 65535.0;
        let qy = f32((p.xy >> 16u) & 0xffffu) / 65535.0;
        let nodeMeta = p.metaRoad & 0xffffu;
        let cls = nodeMeta & 0x3u;
        let endpoint = (nodeMeta >> 2u) & 0x3u;
        let roadId = (p.metaRoad >> 16u) & 0xffffu;
        return Node(vec2f(qx, qy), cls, endpoint, roadId);
      }

      @vertex
      fn vsMain(@builtin(vertex_index) vIdx: u32) -> VertexOutput {
        var output: VertexOutput;

        // Each segment has 6 vertices (2 triangles = 1 quad)
        let segIdx = vIdx / 6u;
        let quadCorner = vIdx % 6u;

        let nodeAIdx = segIdx;
        let nodeBIdx = segIdx + 1u;

        if (nodeBIdx >= ${nodeCount}u) {
          output.position = vec4f(0.0, 0.0, 0.0, 0.0);
          return output;
        }

        let nodeA = fetchNode(nodeAIdx);
        let nodeB = fetchNode(nodeBIdx);

        // If nodeA is an END of a road (endpoint == 2 or 3), or roads differ: drop segment
        if (nodeA.endpoint == 2u || nodeA.endpoint == 3u || nodeA.roadId != nodeB.roadId) {
          output.position = vec4f(0.0, 0.0, 0.0, 0.0);
          return output;
        }

        // Convert world coords [0, 1] to screen pixel space
        let screenA = vec2f(
          ((nodeA.pos.x - camera.center.x) * camera.scale / camera.aspect) * camera.halfScreen.x,
          -((nodeA.pos.y - camera.center.y) * camera.scale) * camera.halfScreen.y
        );
        let screenB = vec2f(
          ((nodeB.pos.x - camera.center.x) * camera.scale / camera.aspect) * camera.halfScreen.x,
          -((nodeB.pos.y - camera.center.y) * camera.scale) * camera.halfScreen.y
        );

        let delta = screenB - screenA;
        let segLen = length(delta);
        let dir = select(vec2f(1.0, 0.0), delta / segLen, segLen > 0.001);
        let norm = vec2f(-dir.y, dir.x);

        // Determine road width in screen pixels based on class and zoom
        var widthPx = 2.0;
        var roadColor = vec3f(0.80, 0.84, 0.88); // primary: slate white

        if (nodeA.cls == 0u) {
          widthPx = 4.5;
          roadColor = vec3f(0.98, 0.45, 0.09); // motorway: orange
        } else if (nodeA.cls == 1u) {
          widthPx = 3.0;
          roadColor = vec3f(0.98, 0.75, 0.14); // trunk: gold
        }

        let halfW = widthPx * 0.5;

        // Join / Cap calculation at A
        var normA = norm;
        if (nodeA.endpoint == 1u) {
          // Start cap: extend backward along dir
          // handled by shifting corner
        } else if (nodeAIdx > 0u) {
          let nodePrev = fetchNode(nodeAIdx - 1u);
          if (nodePrev.roadId == nodeA.roadId) {
            let screenPrev = vec2f(
              ((nodePrev.pos.x - camera.center.x) * camera.scale / camera.aspect) * camera.halfScreen.x,
              -((nodePrev.pos.y - camera.center.y) * camera.scale) * camera.halfScreen.y
            );
            let dP = screenA - screenPrev;
            let lenP = length(dP);
            if (lenP > 0.001) {
              let dirPrev = dP / lenP;
              let miter = normalize(norm + vec2f(-dirPrev.y, dirPrev.x));
              let miterScale = min(1.8, 1.0 / max(0.3, dot(miter, norm)));
              normA = miter * miterScale;
            }
          }
        }

        // Join / Cap calculation at B
        var normB = norm;
        if (nodeB.endpoint == 2u) {
          // End cap: extend forward along dir
        } else if (nodeBIdx + 1u < ${nodeCount}u) {
          let nodeNext = fetchNode(nodeBIdx + 1u);
          if (nodeNext.roadId == nodeB.roadId) {
            let screenNext = vec2f(
              ((nodeNext.pos.x - camera.center.x) * camera.scale / camera.aspect) * camera.halfScreen.x,
              -((nodeNext.pos.y - camera.center.y) * camera.scale) * camera.halfScreen.y
            );
            let dN = screenNext - screenB;
            let lenN = length(dN);
            if (lenN > 0.001) {
              let dirNext = dN / lenN;
              let miter = normalize(norm + vec2f(-dirNext.y, dirNext.x));
              let miterScale = min(1.8, 1.0 / max(0.3, dot(miter, norm)));
              normB = miter * miterScale;
            }
          }
        }

        // Extrude 4 corners of quad
        // Quad mapping: [0, 1, 2, 2, 1, 3]
        // 0: A - halfW * normA
        // 1: A + halfW * normA
        // 2: B - halfW * normB
        // 3: B + halfW * normB
        var pt = screenA;
        var side = 1.0;

        if (quadCorner == 0u) {
          pt = screenA - normA * halfW;
        } else if (quadCorner == 1u || quadCorner == 4u) {
          pt = screenA + normA * halfW;
        } else if (quadCorner == 2u || quadCorner == 3u) {
          pt = screenB - normB * halfW;
        } else {
          pt = screenB + normB * halfW;
        }

        // Add square caps on end vertices if needed
        if (nodeA.endpoint == 1u && (quadCorner == 0u || quadCorner == 1u || quadCorner == 4u)) {
          pt = pt - dir * halfW;
        }
        if (nodeB.endpoint == 2u && (quadCorner == 2u || quadCorner == 3u || quadCorner == 5u)) {
          pt = pt + dir * halfW;
        }

        // Convert back to NDC [-1, 1]
        let ndcX = pt.x / camera.halfScreen.x;
        let ndcY = pt.y / camera.halfScreen.y;

        output.position = vec4f(ndcX, ndcY, 0.0, 1.0);
        output.color = roadColor;
        return output;
      }

      @fragment
      fn fsMain(input: VertexOutput) -> @location(0) vec4f {
        return vec4f(input.color, 1.0);
      }
    `,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: nodeBuffer } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shaderModule,
      entryPoint: 'vsMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fsMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  // Camera state (Tokyo center: lon 139.75, lat 35.68 -> ~0.55 in normalized box)
  let cx = 0.52;
  let cy = 0.48;
  let scale = 2.4;

  function updateUniforms(w: number, h: number) {
    const aspect = w / h;
    const halfW = w / 2;
    const halfH = h / 2;

    const data = new Float32Array([
      cx, cy,
      scale, aspect,
      halfW, halfH,
      0, 0, // padding
    ]);
    device.queue.writeBuffer(uniformBuffer, 0, data);
  }

  function render() {
    const w = canvas.width || 1024;
    const h = canvas.height || 768;
    if (!colorTexture || colorTexture.width !== w || colorTexture.height !== h) {
      createColorTexture(w, h);
    }

    updateUniforms(w, h);

    const commandEncoder = device.createCommandEncoder();
    const view = webgpuCtx ? webgpuCtx.getCurrentTexture().createView() : colorTexture.createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.04, g: 0.06, b: 0.11, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, bindGroup);
    // Draw all segments with 6 vertices per segment across all contiguous nodes: zero vertex buffer needed!
    renderPass.draw((nodeCount - 1) * 6, 1, 0, 0);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
  }

  // Pointer interactions
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
    panBy(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  const stopDrag = (e: PointerEvent) => {
    if (dragging) {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  // Pan by CSS px. Data y grows south and screen y down, so dragging down
  // moves cy north (it moved the map up, against the pointer).
  function panBy(dx: number, dy: number): void {
    const k = 2 / ((canvas.clientHeight || 768) * scale);
    cx -= dx * k;
    cy -= dy * k;
    render();
  }

  // Zoom keeping the ground under (x, y) in CSS px still.
  function zoomAt(factor: number, x: number, y: number): void {
    const ox = x - (canvas.clientWidth || 1024) / 2, oy = y - (canvas.clientHeight || 768) / 2;
    const h = canvas.clientHeight || 768;
    const before = scale;
    scale = Math.max(0.5, Math.min(20.0, scale * factor));
    cx += (ox * 2) / h * (1 / before - 1 / scale);
    cy += (oy * 2) / h * (1 / before - 1 / scale);
    render();
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.deltaY > 0 ? 0.9 : 1.1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Initial render
  render();

  return {
    canvas,
    roadCount,
    nodeCount,
    segmentCount,
    get uploadCount() {
      return uploadCount;
    },
    gpu: gpuDesc,
    render,
    panBy,
    zoomBy(delta: number) {
      scale = Math.max(0.5, Math.min(20.0, scale + delta));
      render();
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
    },
  };
}
