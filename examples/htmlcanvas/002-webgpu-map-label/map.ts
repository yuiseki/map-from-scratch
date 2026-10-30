// WebGPU Map Label Renderer via HTML-in-Canvas
//
// Demonstrates rendering rich HTML elements (with CSS badges, Japanese typography, shadows)
// into a WebGPU texture atlas using WICG HTML-in-Canvas (drawElementImage).
// The WebGPU render pass composites the map and instanced label quads.
// During pan and zoom, only camera uniforms update on the GPU; no HTML re-layout or texture
// uploads occur per frame.

export interface MapLabelItem {
  id: string;
  name: string;
  category: string;
  rating: string;
  badgeColor: string;
  lon: number;
  lat: number;
  mx: number;
  my: number;
}

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

export interface WebGpuLabelMap {
  canvas: HTMLCanvasElement;
  landmarks: MapLabelItem[];
  gpuName: string;
  hasDrawElementImage: boolean;
  textureUploadCount: number;
  renderCount: number;
  render: () => Promise<void>;
  panBy: (dx: number, dy: number) => Promise<void>;
  zoomBy: (delta: number) => Promise<void>;
  updateLabelContent: (index: number, title: string, badge: string, rating: string) => Promise<void>;
  getLabelScreenPos: (index: number) => { x: number; y: number; width: number; height: number };
  readPixel: (x: number, y: number) => Promise<Uint8Array>;
}

export async function mount(
  canvas: HTMLCanvasElement,
  canvasHtml: HTMLCanvasElement,
  dataUrl: string,
): Promise<WebGpuLabelMap> {
  const ctxHtml = canvasHtml.getContext('2d') as any;
  if (!ctxHtml) throw new Error('Failed to get 2D context for HTML canvas');

  const hasDrawElementImage = typeof ctxHtml.drawElementImage === 'function';

  // Load landmarks data
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`Failed to load landmarks: ${res.status}`);
  const landmarks: MapLabelItem[] = await res.json();

  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser/environment');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter found');

  const adapterInfo = (adapter as any).info ?? {};
  const gpuName = `${adapterInfo.vendor ?? ''} ${adapterInfo.architecture ?? ''} ${adapterInfo.device ?? ''} ${adapterInfo.description ?? ''}`.trim() || 'Generic WebGPU Device';

  const isSwiftShader = gpuName.toLowerCase().includes('swiftshader') ||
                        (adapterInfo.vendor ?? '').toLowerCase().includes('google');

  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (e: any) => {
    console.error('WebGPU uncapturederror:', e.error?.message);
  });

  // WebGPU Context setup
  let webgpuCtx: GPUCanvasContext | null = null;
  let onscreen2dCtx: CanvasRenderingContext2D | null = null;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  if (isSwiftShader) {
    // In headless SwiftShader, swapchain binding causes SharedImageStub error in Chromium.
    // Use Canvas 2D for onscreen presentation of offscreen WebGPU readback.
    onscreen2dCtx = canvas.getContext('2d');
  } else {
    webgpuCtx = canvas.getContext('webgpu') as GPUCanvasContext;
    if (webgpuCtx) {
      webgpuCtx.configure({
        device,
        format: presentationFormat,
        alphaMode: 'premultiplied',
        // COPY_SRC for readPixel: without it the copy failed validation and
        // every pixel read back as 0.
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }
  }

  // Camera state (Tokyo center: lon 139.755, lat 35.680)
  let centerMx = 0.888208;
  let centerMy = 0.393782;
  let zoom = 12.0;

  function getScale(): number {
    return Math.pow(2, zoom) * 256;
  }

  // Label Atlas Texture (1024x256)
  const atlasWidth = 1024;
  const atlasHeight = 256;
  const labelCardWidth = 150;
  const labelCardHeight = 60;

  const labelTexture = device.createTexture({
    size: [atlasWidth, atlasHeight, 1],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const labelSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  let textureUploadCount = 0;
  let renderCount = 0;

  // Render HTML elements into canvasHtml and upload to WebGPU texture atlas
  async function updateLabelTextureAtlas(): Promise<void> {
    // Trigger layout and paint record update
    if (typeof (canvasHtml as any).requestPaint === 'function') {
      await new Promise<void>((resolve) => {
        canvasHtml.addEventListener('paint', () => resolve(), { once: true });
        (canvasHtml as any).requestPaint();
      });
    } else {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    }

    // Clear atlas
    ctxHtml.clearRect(0, 0, atlasWidth, atlasHeight);

    // Draw each HTML label card element at its slot
    for (let i = 0; i < landmarks.length; i++) {
      const el = document.getElementById(`label-${i}`);
      if (!el) continue;
      const slotX = (i % 6) * 165 + 10;
      const slotY = 10;

      if (hasDrawElementImage) {
        ctxHtml.drawElementImage(el, slotX, slotY);
      } else {
        // Fallback drawing if drawElementImage is absent
        ctxHtml.fillStyle = '#ffffff';
        ctxHtml.fillRect(slotX, slotY, labelCardWidth, labelCardHeight);
        ctxHtml.fillStyle = '#0f172a';
        ctxHtml.font = 'bold 12px sans-serif';
        ctxHtml.fillText(landmarks[i].name, slotX + 8, slotY + 28);
      }
    }

    // Upload canvasHtml image to WebGPU texture
    device.queue.copyExternalImageToTexture(
      { source: canvasHtml },
      { texture: labelTexture },
      [atlasWidth, atlasHeight],
    );
    textureUploadCount++;
  }

  // Camera uniform buffer
  // struct Camera { center: vec2f, scale: f32, pad: f32, viewport: vec2f, pad2: vec2f } (32 bytes)
  const cameraUniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  function updateCameraUniform(): void {
    const scale = getScale();
    const data = new Float32Array([
      centerMx,
      centerMy,
      scale,
      0, // pad
      canvas.width,
      canvas.height,
      0, // pad
      0, // pad
    ]);
    device.queue.writeBuffer(cameraUniformBuffer, 0, data);
  }

  // Label Instance storage buffer
  // struct Instance { pos: vec2f, size: vec2f, uvRect: vec4f } (32 bytes per instance)
  const instanceBufferSize = landmarks.length * 32;
  const instanceBuffer = device.createBuffer({
    size: instanceBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  function updateInstancesData(): void {
    const data = new Float32Array(landmarks.length * 8);
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      const slotX = (i % 6) * 165 + 10;
      const slotY = 10;
      const u0 = slotX / atlasWidth;
      const v0 = slotY / atlasHeight;
      const u1 = (slotX + labelCardWidth) / atlasWidth;
      const v1 = (slotY + labelCardHeight) / atlasHeight;

      const offset = i * 8;
      data[offset + 0] = lm.mx;
      data[offset + 1] = lm.my;
      data[offset + 2] = labelCardWidth;
      data[offset + 3] = labelCardHeight;
      data[offset + 4] = u0;
      data[offset + 5] = v0;
      data[offset + 6] = u1;
      data[offset + 7] = v1;
    }
    device.queue.writeBuffer(instanceBuffer, 0, data);
  }

  updateInstancesData();

  // WGSL Shader for Basemap & Pins & Labels
  const shaderModule = device.createShaderModule({
    code: `
      struct Camera {
        center: vec2f,
        scale: f32,
        pad: f32,
        viewport: vec2f,
        pad2: vec2f,
      };

      @group(0) @binding(0) var<uniform> camera: Camera;
      @group(0) @binding(1) var labelSampler: sampler;
      @group(0) @binding(2) var labelTexture: texture_2d<f32>;

      struct Instance {
        pos: vec2f,
        size: vec2f,
        uvRect: vec4f,
      };
      @group(0) @binding(3) var<storage, read> instances: array<Instance>;

      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) uv: vec2f,
      };

      // Draw instanced labels (6 vertices per quad, instanced)
      @vertex
      fn vs_labels(
        @builtin(vertex_index) vIdx: u32,
        @builtin(instance_index) instIdx: u32
      ) -> VertexOutput {
        let inst = instances[instIdx];

        var qPos = vec2f(0.0);
        var uvBase = vec2f(0.0);
        switch (vIdx) {
          case 0u: { qPos = vec2f(-0.5, 0.0); uvBase = vec2f(0.0, 1.0); }
          case 1u: { qPos = vec2f( 0.5, 0.0); uvBase = vec2f(1.0, 1.0); }
          case 2u: { qPos = vec2f( 0.5, 1.0); uvBase = vec2f(1.0, 0.0); }
          case 3u: { qPos = vec2f(-0.5, 0.0); uvBase = vec2f(0.0, 1.0); }
          case 4u: { qPos = vec2f( 0.5, 1.0); uvBase = vec2f(1.0, 0.0); }
          default: { qPos = vec2f(-0.5, 1.0); uvBase = vec2f(0.0, 0.0); }
        }

        let anchorScreenPx = (inst.pos - camera.center) * camera.scale;
        let offsetPx = vec2f(0.0, -12.0);
        let screenPx = anchorScreenPx + vec2f(qPos.x * inst.size.x, -qPos.y * inst.size.y) + offsetPx;

        let ndcX = (screenPx.x / (camera.viewport.x * 0.5));
        let ndcY = -(screenPx.y / (camera.viewport.y * 0.5));

        var out: VertexOutput;
        out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
        out.uv = vec2f(
          mix(inst.uvRect.x, inst.uvRect.z, uvBase.x),
          mix(inst.uvRect.y, inst.uvRect.w, uvBase.y)
        );
        return out;
      }

      // Draw anchor pin dots under labels
      @vertex
      fn vs_pins(
        @builtin(vertex_index) vIdx: u32,
        @builtin(instance_index) instIdx: u32
      ) -> VertexOutput {
        let inst = instances[instIdx];
        var qPos = vec2f(0.0);
        switch (vIdx) {
          case 0u: { qPos = vec2f(-1.0, -1.0); }
          case 1u: { qPos = vec2f( 1.0, -1.0); }
          case 2u: { qPos = vec2f( 1.0,  1.0); }
          case 3u: { qPos = vec2f(-1.0, -1.0); }
          case 4u: { qPos = vec2f( 1.0,  1.0); }
          default: { qPos = vec2f(-1.0,  1.0); }
        }

        let anchorScreenPx = (inst.pos - camera.center) * camera.scale;
        let pinSizePx = 6.0;
        let screenPx = anchorScreenPx + qPos * pinSizePx;

        let ndcX = (screenPx.x / (camera.viewport.x * 0.5));
        let ndcY = -(screenPx.y / (camera.viewport.y * 0.5));

        var out: VertexOutput;
        out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
        out.uv = qPos;
        return out;
      }

      @fragment
      fn fs_pins(in: VertexOutput) -> @location(0) vec4f {
        let dist = length(in.uv);
        if (dist > 1.0) {
          discard;
        }
        let border = smoothstep(0.7, 1.0, dist);
        return mix(vec4f(0.22, 0.74, 0.97, 1.0), vec4f(0.05, 0.35, 0.6, 1.0), border);
      }

      @fragment
      fn fs_labels(in: VertexOutput) -> @location(0) vec4f {
        let texColor = textureSample(labelTexture, labelSampler, in.uv);
        if (texColor.a < 0.05) {
          discard;
        }
        return texColor;
      }
    `,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: cameraUniformBuffer } },
      { binding: 1, resource: labelSampler },
      { binding: 2, resource: labelTexture.createView() },
      { binding: 3, resource: { buffer: instanceBuffer } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const labelPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_labels',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_labels',
      targets: [
        {
          format: isSwiftShader ? 'rgba8unorm' : presentationFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  const pinPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_pins',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_pins',
      targets: [
        {
          format: isSwiftShader ? 'rgba8unorm' : presentationFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  // Offscreen render target for SwiftShader
  let offscreenTexture: GPUTexture | null = null;
  function ensureOffscreenTexture(): GPUTexture {
    if (!offscreenTexture || offscreenTexture.width !== canvas.width || offscreenTexture.height !== canvas.height) {
      if (offscreenTexture) offscreenTexture.destroy();
      offscreenTexture = device.createTexture({
        size: [canvas.width, canvas.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }
    return offscreenTexture;
  }

  function getLabelScreenPos(index: number): { x: number; y: number; width: number; height: number } {
    const lm = landmarks[index];
    const scale = getScale();
    const anchorX = canvas.width / 2 + (lm.mx - centerMx) * scale;
    const anchorY = canvas.height / 2 + (lm.my - centerMy) * scale;

    const left = anchorX - labelCardWidth / 2;
    const top = anchorY - labelCardHeight - 12;
    return { x: left, y: top, width: labelCardWidth, height: labelCardHeight };
  }

  async function render(): Promise<void> {
    renderCount++;
    updateCameraUniform();

    const commandEncoder = device.createCommandEncoder();

    let renderView: GPUTextureView;
    let targetTexture: GPUTexture | null = null;

    if (isSwiftShader) {
      targetTexture = ensureOffscreenTexture();
      renderView = targetTexture.createView();
    } else {
      renderView = webgpuCtx!.getCurrentTexture().createView();
    }

    // Basemap background color #0b1120
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: renderView,
          clearValue: { r: 11 / 255, g: 17 / 255, b: 32 / 255, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setBindGroup(0, bindGroup);

    // 1. Draw pins under labels
    pass.setPipeline(pinPipeline);
    pass.draw(6, landmarks.length, 0, 0);

    // 2. Draw instanced HTML labels
    pass.setPipeline(labelPipeline);
    pass.draw(6, landmarks.length, 0, 0);

    pass.end();

    // In SwiftShader, transfer pixels to onscreen Canvas 2D for visual feedback and screenshot
    if (isSwiftShader && onscreen2dCtx && targetTexture) {
      const w = canvas.width;
      const h = canvas.height;
      const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
      const readBuffer = device.createBuffer({
        size: bytesPerRow * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      commandEncoder.copyTextureToBuffer(
        { texture: targetTexture },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: h },
        [w, h, 1],
      );
      device.queue.submit([commandEncoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readBuffer.getMappedRange());
      const imgData = onscreen2dCtx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        imgData.data.set(
          mapped.subarray(y * bytesPerRow, y * bytesPerRow + w * 4),
          y * w * 4,
        );
      }
      readBuffer.unmap();
      readBuffer.destroy();
      onscreen2dCtx.putImageData(imgData, 0, 0);
    } else {
      device.queue.submit([commandEncoder.finish()]);
    }
  }

  async function panBy(dx: number, dy: number): Promise<void> {
    const scale = getScale();
    centerMx -= dx / scale;
    centerMy -= dy / scale;
    await render();
  }

  async function zoomBy(delta: number): Promise<void> {
    zoom = Math.max(9, Math.min(18, zoom + delta));
    await render();
  }

  async function updateLabelContent(
    index: number,
    title: string,
    badge: string,
    rating: string,
  ): Promise<void> {
    const card = document.getElementById(`label-${index}`);
    if (!card) return;
    const badgeEl = card.querySelector('.label-badge');
    const ratingEl = card.querySelector('.label-rating');
    const titleEl = card.querySelector('.label-title');
    if (badgeEl) badgeEl.textContent = badge;
    if (ratingEl) ratingEl.textContent = rating;
    if (titleEl) titleEl.textContent = title;

    landmarks[index].name = title;
    landmarks[index].category = badge;
    landmarks[index].rating = rating;

    await updateLabelTextureAtlas();
    await render();
  }

  async function readPixel(x: number, y: number): Promise<Uint8Array> {
    const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));

    device.pushErrorScope('validation');
    updateCameraUniform();
    const texture = isSwiftShader ? ensureOffscreenTexture() : (webgpuCtx ? webgpuCtx.getCurrentTexture() : ensureOffscreenTexture());
    const commandEncoder = device.createCommandEncoder();

    // Render pass and copy in the same command buffer before presentation
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: { r: 11 / 255, g: 17 / 255, b: 32 / 255, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(pinPipeline);
    pass.draw(6, landmarks.length, 0, 0);
    pass.setPipeline(labelPipeline);
    pass.draw(6, landmarks.length, 0, 0);
    pass.end();

    const readBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    commandEncoder.copyTextureToBuffer(
      { texture, origin: { x: px, y: py } },
      { buffer: readBuffer, bytesPerRow: 256, rowsPerImage: 1 },
      [1, 1, 1],
    );

    device.queue.submit([commandEncoder.finish()]);
    const err = await device.popErrorScope();
    if (err) {
      console.error('READPIXEL GPU ERROR:', err.message);
    }
    await readBuffer.mapAsync(GPUMapMode.READ);
    const pixel = new Uint8Array(readBuffer.getMappedRange().slice(0, 4));
    readBuffer.unmap();
    readBuffer.destroy();
    // The preferred canvas format is bgra8unorm on macOS: return RGBA.
    if (texture.format === 'bgra8unorm') [pixel[0], pixel[2]] = [pixel[2], pixel[0]];
    return pixel;
  }

  // Initial Atlas generation
  await updateLabelTextureAtlas();
  await render();

  // Pointer event listeners
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', async (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    await panBy(dx, dy);
  });

  canvas.addEventListener('pointerup', () => {
    isDragging = false;
  });

  canvas.addEventListener('wheel', async (e) => {
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.2;
    await zoomBy(delta);
  }, { passive: false });

  return {
    canvas,
    landmarks,
    gpuName,
    hasDrawElementImage,
    get textureUploadCount() { return textureUploadCount; },
    get renderCount() { return renderCount; },
    render,
    panBy,
    zoomBy,
    updateLabelContent,
    getLabelScreenPos,
    readPixel,
  };
}
