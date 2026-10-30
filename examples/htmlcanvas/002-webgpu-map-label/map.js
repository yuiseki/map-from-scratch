import { openArchive } from './pmtiles.js';
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
    QUERY_RESOLVE: 0x0200
};
const GPUTextureUsage = {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10
};
const GPUShaderStage = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4
};
const GPUMapMode = {
    READ: 0x0001,
    WRITE: 0x0002
};
export async function mount(canvas, canvasHtml, dataUrl) {
    const ctxHtml = canvasHtml.getContext('2d');
    if (!ctxHtml) throw new Error('Failed to get 2D context for HTML canvas');
    const hasDrawElementImage = typeof ctxHtml.drawElementImage === 'function';
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(`Failed to load landmarks: ${res.status}`);
    const landmarks = await res.json();
    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this browser/environment');
    }
    const adapter = await navigator.gpu.requestAdapter() || await navigator.gpu.requestAdapter({
        forceFallbackAdapter: true
    });
    if (!adapter) throw new Error('No WebGPU adapter found');
    const adapterInfo = adapter.info ?? {};
    const gpuName = `${adapterInfo.vendor ?? ''} ${adapterInfo.architecture ?? ''} ${adapterInfo.device ?? ''} ${adapterInfo.description ?? ''}`.trim() || 'Generic WebGPU Device';
    const isSwiftShader = gpuName.toLowerCase().includes('swiftshader') || (adapterInfo.vendor ?? '').toLowerCase().includes('google');
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', (e)=>{
        console.error('WebGPU uncapturederror:', e.error?.message);
    });
    let webgpuCtx = null;
    let onscreen2dCtx = null;
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    if (isSwiftShader) {
        onscreen2dCtx = canvas.getContext('2d');
    } else {
        webgpuCtx = canvas.getContext('webgpu');
        if (webgpuCtx) {
            webgpuCtx.configure({
                device,
                format: presentationFormat,
                alphaMode: 'premultiplied',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
            });
        }
    }
    let centerMx = 0.888208;
    let centerMy = 0.393782;
    let zoom = 12.0;
    function getScale() {
        return Math.pow(2, zoom) * 256;
    }
    const atlasWidth = 1024;
    const atlasHeight = 256;
    const labelCardWidth = 150;
    const labelCardHeight = 60;
    const labelTexture = device.createTexture({
        size: [
            atlasWidth,
            atlasHeight,
            1
        ],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    const labelSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear'
    });
    let textureUploadCount = 0;
    let renderCount = 0;
    async function updateLabelTextureAtlas() {
        if (typeof canvasHtml.requestPaint === 'function') {
            await new Promise((resolve)=>{
                canvasHtml.addEventListener('paint', ()=>resolve(), {
                    once: true
                });
                canvasHtml.requestPaint();
            });
        } else {
            await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
        }
        ctxHtml.clearRect(0, 0, atlasWidth, atlasHeight);
        for(let i = 0; i < landmarks.length; i++){
            const el = document.getElementById(`label-${i}`);
            if (!el) continue;
            const slotX = i % 6 * 165 + 10;
            const slotY = 10;
            if (hasDrawElementImage) {
                ctxHtml.drawElementImage(el, slotX, slotY);
            } else {
                ctxHtml.fillStyle = '#ffffff';
                ctxHtml.fillRect(slotX, slotY, labelCardWidth, labelCardHeight);
                ctxHtml.fillStyle = '#0f172a';
                ctxHtml.font = 'bold 12px sans-serif';
                ctxHtml.fillText(landmarks[i].name, slotX + 8, slotY + 28);
            }
        }
        device.queue.copyExternalImageToTexture({
            source: canvasHtml
        }, {
            texture: labelTexture
        }, [
            atlasWidth,
            atlasHeight
        ]);
        textureUploadCount++;
    }
    const tileAtlasWidth = 4096;
    const tileAtlasHeight = 4096;
    const atlasCols = 8;
    const maxTiles = atlasCols * atlasCols;
    const tileTexture = device.createTexture({
        size: [
            tileAtlasWidth,
            tileAtlasHeight,
            1
        ],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    const tileSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear'
    });
    const tileSlots = new Map();
    const tilePending = new Set();
    const tileLastUsed = new Map();
    let archive = null;
    async function uploadTile(key, image) {
        let slot;
        if (tileSlots.has(key)) {
            slot = tileSlots.get(key);
        } else {
            if (tileSlots.size < maxTiles) {
                slot = tileSlots.size;
            } else {
                let victim = '';
                let oldest = Infinity;
                for (const k of tileSlots.keys()){
                    const used = tileLastUsed.get(k) ?? -1;
                    if (used < oldest && used < renderCount) {
                        oldest = used;
                        victim = k;
                    }
                }
                if (!victim) {
                    image.close();
                    return;
                }
                slot = tileSlots.get(victim);
                tileSlots.delete(victim);
                tileLastUsed.delete(victim);
            }
            tileSlots.set(key, slot);
        }
        const col = slot % atlasCols;
        const row = Math.floor(slot / atlasCols);
        device.queue.copyExternalImageToTexture({
            source: image
        }, {
            texture: tileTexture,
            origin: [
                col * 512,
                row * 512,
                0
            ]
        }, [
            512,
            512
        ]);
        image.close();
        await render();
    }
    function requestTile(z, x, y) {
        if (!archive) return;
        const key = `${z}/${x}/${y}`;
        if (tileSlots.has(key) || tilePending.has(key) || tilePending.size >= 8) return;
        tilePending.add(key);
        archive.tile(z, x, y).then((bytes)=>bytes ? createImageBitmap(new Blob([
                Uint8Array.from(bytes)
            ], {
                type: 'image/jpeg'
            })) : null).then((image)=>{
            if (image) return uploadTile(key, image);
        }).catch((err)=>{
            console.warn('Seamlessphoto tile request error:', err);
        }).finally(()=>{
            tilePending.delete(key);
        });
    }
    const cameraUniformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    function updateCameraUniform() {
        const scale = getScale();
        const data = new Float32Array([
            centerMx,
            centerMy,
            scale,
            0,
            canvas.width,
            canvas.height,
            0,
            0
        ]);
        device.queue.writeBuffer(cameraUniformBuffer, 0, data);
    }
    const instanceBufferSize = landmarks.length * 32;
    const instanceBuffer = device.createBuffer({
        size: instanceBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    function updateInstancesData() {
        const data = new Float32Array(landmarks.length * 8);
        for(let i = 0; i < landmarks.length; i++){
            const lm = landmarks[i];
            const slotX = i % 6 * 165 + 10;
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
    const tileInstanceBufferSize = maxTiles * 32;
    const tileInstanceBuffer = device.createBuffer({
        size: tileInstanceBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
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
      @group(0) @binding(4) var tileSampler: sampler;
      @group(0) @binding(5) var tileTexture: texture_2d<f32>;
      @group(0) @binding(6) var<storage, read> tileInstances: array<Instance>;

      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) uv: vec2f,
      };

      // Draw aerial map raster tiles
      @vertex
      fn vs_tiles(
        @builtin(vertex_index) vIdx: u32,
        @builtin(instance_index) instIdx: u32
      ) -> VertexOutput {
        let inst = tileInstances[instIdx];
        var qPos = vec2f(0.0);
        var uvBase = vec2f(0.0);
        switch (vIdx) {
          case 0u: { qPos = vec2f(0.0, 0.0); uvBase = vec2f(0.0, 0.0); }
          case 1u: { qPos = vec2f(1.0, 0.0); uvBase = vec2f(1.0, 0.0); }
          case 2u: { qPos = vec2f(1.0, 1.0); uvBase = vec2f(1.0, 1.0); }
          case 3u: { qPos = vec2f(0.0, 0.0); uvBase = vec2f(0.0, 0.0); }
          case 4u: { qPos = vec2f(1.0, 1.0); uvBase = vec2f(1.0, 1.0); }
          default: { qPos = vec2f(0.0, 1.0); uvBase = vec2f(0.0, 1.0); }
        }

        let mercatorPos = inst.pos + qPos * inst.size;
        let screenPx = (mercatorPos - camera.center) * camera.scale;

        let ndcX = (screenPx.x / (camera.viewport.x * 0.5));
        let ndcY = -(screenPx.y / (camera.viewport.y * 0.5));

        var out: VertexOutput;
        out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
        out.uv = mix(inst.uvRect.xy, inst.uvRect.zw, uvBase);
        return out;
      }

      @fragment
      fn fs_tiles(in: VertexOutput) -> @location(0) vec4f {
        return textureSample(tileTexture, tileSampler, in.uv);
      }

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
    `
    });
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: 'uniform'
                }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {
                    type: 'filtering'
                }
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'float'
                }
            },
            {
                binding: 3,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: 'read-only-storage'
                }
            },
            {
                binding: 4,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {
                    type: 'filtering'
                }
            },
            {
                binding: 5,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'float'
                }
            },
            {
                binding: 6,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: 'read-only-storage'
                }
            }
        ]
    });
    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: cameraUniformBuffer
                }
            },
            {
                binding: 1,
                resource: labelSampler
            },
            {
                binding: 2,
                resource: labelTexture.createView()
            },
            {
                binding: 3,
                resource: {
                    buffer: instanceBuffer
                }
            },
            {
                binding: 4,
                resource: tileSampler
            },
            {
                binding: 5,
                resource: tileTexture.createView()
            },
            {
                binding: 6,
                resource: {
                    buffer: tileInstanceBuffer
                }
            }
        ]
    });
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [
            bindGroupLayout
        ]
    });
    const tilePipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_tiles'
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_tiles',
            targets: [
                {
                    format: isSwiftShader ? 'rgba8unorm' : presentationFormat
                }
            ]
        },
        primitive: {
            topology: 'triangle-list'
        }
    });
    const labelPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_labels'
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
                            operation: 'add'
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        }
                    }
                }
            ]
        },
        primitive: {
            topology: 'triangle-list'
        }
    });
    const pinPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_pins'
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
                            operation: 'add'
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        }
                    }
                }
            ]
        },
        primitive: {
            topology: 'triangle-list'
        }
    });
    let offscreenTexture = null;
    function ensureOffscreenTexture() {
        if (!offscreenTexture || offscreenTexture.width !== canvas.width || offscreenTexture.height !== canvas.height) {
            if (offscreenTexture) offscreenTexture.destroy();
            offscreenTexture = device.createTexture({
                size: [
                    canvas.width,
                    canvas.height,
                    1
                ],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
            });
        }
        return offscreenTexture;
    }
    async function render() {
        renderCount++;
        updateCameraUniform();
        let visibleTileCount = 0;
        const tileData = new Float32Array(maxTiles * 8);
        if (archive) {
            const tileZ = Math.min(17, Math.max(1, Math.round(zoom) - 1));
            const n = 2 ** tileZ;
            const tileSize = 1 / n;
            const scale = getScale();
            const halfW = canvas.width / 2 / scale;
            const halfH = canvas.height / 2 / scale;
            const minMx = centerMx - halfW;
            const maxMx = centerMx + halfW;
            const minMy = centerMy - halfH;
            const maxMy = centerMy + halfH;
            const x0 = Math.max(0, Math.floor(minMx * n));
            const x1 = Math.min(n - 1, Math.floor(maxMx * n));
            const y0 = Math.max(0, Math.floor(minMy * n));
            const y1 = Math.min(n - 1, Math.floor(maxMy * n));
            for(let ty = y0; ty <= y1 && visibleTileCount < maxTiles; ty++){
                for(let tx = x0; tx <= x1 && visibleTileCount < maxTiles; tx++){
                    const key = `${tileZ}/${tx}/${ty}`;
                    if (tileSlots.has(key)) {
                        const slot = tileSlots.get(key);
                        tileLastUsed.set(key, renderCount);
                        const col = slot % atlasCols;
                        const row = Math.floor(slot / atlasCols);
                        const u0 = col / atlasCols;
                        const v0 = row / atlasCols;
                        const u1 = u0 + 1 / atlasCols;
                        const v1 = v0 + 1 / atlasCols;
                        const offset = visibleTileCount * 8;
                        tileData[offset + 0] = tx * tileSize;
                        tileData[offset + 1] = ty * tileSize;
                        tileData[offset + 2] = tileSize;
                        tileData[offset + 3] = tileSize;
                        tileData[offset + 4] = u0;
                        tileData[offset + 5] = v0;
                        tileData[offset + 6] = u1;
                        tileData[offset + 7] = v1;
                        visibleTileCount++;
                    } else if (!tilePending.has(key)) {
                        requestTile(tileZ, tx, ty);
                    }
                }
            }
        }
        device.queue.writeBuffer(tileInstanceBuffer, 0, tileData);
        const commandEncoder = device.createCommandEncoder();
        let targetView;
        let targetTexture = null;
        if (isSwiftShader) {
            targetTexture = ensureOffscreenTexture();
            targetView = targetTexture.createView();
        } else {
            if (!webgpuCtx) return;
            targetView = webgpuCtx.getCurrentTexture().createView();
        }
        const pass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: targetView,
                    clearValue: {
                        r: 0.04,
                        g: 0.07,
                        b: 0.13,
                        a: 1.0
                    },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setBindGroup(0, bindGroup);
        if (visibleTileCount > 0) {
            pass.setPipeline(tilePipeline);
            pass.draw(6, visibleTileCount, 0, 0);
        }
        pass.setPipeline(pinPipeline);
        pass.draw(6, landmarks.length, 0, 0);
        pass.setPipeline(labelPipeline);
        pass.draw(6, landmarks.length, 0, 0);
        pass.end();
        if (isSwiftShader && onscreen2dCtx && targetTexture) {
            const w = canvas.width;
            const h = canvas.height;
            const bytesPerRow = Math.ceil(w * 4 / 256) * 256;
            const readBuffer = device.createBuffer({
                size: bytesPerRow * h,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
            });
            commandEncoder.copyTextureToBuffer({
                texture: targetTexture
            }, {
                buffer: readBuffer,
                bytesPerRow,
                rowsPerImage: h
            }, [
                w,
                h,
                1
            ]);
            device.queue.submit([
                commandEncoder.finish()
            ]);
            await readBuffer.mapAsync(GPUMapMode.READ);
            const mapped = new Uint8Array(readBuffer.getMappedRange());
            const imgData = onscreen2dCtx.createImageData(w, h);
            for(let y = 0; y < h; y++){
                imgData.data.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
            }
            readBuffer.unmap();
            readBuffer.destroy();
            onscreen2dCtx.putImageData(imgData, 0, 0);
        } else {
            device.queue.submit([
                commandEncoder.finish()
            ]);
        }
    }
    async function panBy(dx, dy) {
        const scale = getScale();
        centerMx -= dx / scale;
        centerMy -= dy / scale;
        await render();
    }
    async function zoomBy(delta) {
        zoom = Math.max(9, Math.min(18, zoom + delta));
        await render();
    }
    function getLabelScreenPos(index) {
        const lm = landmarks[index];
        const scale = getScale();
        const screenX = canvas.width / 2 + (lm.mx - centerMx) * scale;
        const screenY = canvas.height / 2 + (lm.my - centerMy) * scale;
        const px = Math.round(screenX - labelCardWidth / 2);
        const py = Math.round(screenY - labelCardHeight - 12);
        return {
            x: px,
            y: py,
            width: labelCardWidth,
            height: labelCardHeight
        };
    }
    async function updateLabelContent(index, title, badge, rating) {
        landmarks[index].name = title;
        landmarks[index].category = badge;
        landmarks[index].rating = rating;
        const el = document.getElementById(`label-${index}`);
        if (el) {
            const titleEl = el.querySelector('.label-title');
            const badgeEl = el.querySelector('.label-badge');
            const ratingEl = el.querySelector('.label-rating');
            if (titleEl) titleEl.textContent = title;
            if (badgeEl) badgeEl.textContent = badge;
            if (ratingEl) ratingEl.textContent = rating;
        }
        await updateLabelTextureAtlas();
        await render();
    }
    async function readPixel(x, y) {
        const rx = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
        const ry = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
        if (isSwiftShader && onscreen2dCtx) {
            const data = onscreen2dCtx.getImageData(rx, ry, 1, 1).data;
            return new Uint8Array(data);
        }
        await render();
        const texture = webgpuCtx ? webgpuCtx.getCurrentTexture() : ensureOffscreenTexture();
        const readBuffer = device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        const commandEncoder = device.createCommandEncoder();
        commandEncoder.copyTextureToBuffer({
            texture,
            origin: [
                rx,
                ry,
                0
            ]
        }, {
            buffer: readBuffer,
            bytesPerRow: 256
        }, [
            1,
            1,
            1
        ]);
        device.queue.submit([
            commandEncoder.finish()
        ]);
        await readBuffer.mapAsync(GPUMapMode.READ);
        const mapped = new Uint8Array(readBuffer.getMappedRange());
        const pixel = new Uint8Array(mapped.slice(0, 4));
        readBuffer.unmap();
        readBuffer.destroy();
        if (texture.format === 'bgra8unorm') [pixel[0], pixel[2]] = [
            pixel[2],
            pixel[0]
        ];
        return pixel;
    }
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    canvas.addEventListener('pointerdown', (e)=>{
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e)=>{
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const scale = getScale();
        centerMx -= dx / scale;
        centerMy -= dy / scale;
        render();
    });
    const stopDrag = (e)=>{
        if (isDragging) {
            isDragging = false;
            try {
                canvas.releasePointerCapture(e.pointerId);
            } catch  {}
        }
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const ox = (e.clientX - rect.left) * canvas.width / rect.width - canvas.width / 2;
        const oy = (e.clientY - rect.top) * canvas.height / rect.height - canvas.height / 2;
        const before = getScale();
        zoom = Math.max(9, Math.min(18, zoom + (e.deltaY < 0 ? 0.2 : -0.2)));
        const after = getScale();
        centerMx += ox / before - ox / after;
        centerMy += oy / before - oy / after;
        render();
    }, {
        passive: false
    });
    async function waitForTile(timeoutMs = 6000) {
        const start = performance.now();
        while(performance.now() - start < timeoutMs){
            if (tileSlots.size > 0) return true;
            await new Promise((r)=>setTimeout(r, 60));
        }
        return false;
    }
    function hasAerialTiles() {
        return tileSlots.size > 0;
    }
    await updateLabelTextureAtlas();
    try {
        archive = await openArchive();
        const tileZ = Math.round(zoom);
        const n = 2 ** tileZ;
        const cx = Math.floor(centerMx * n);
        const cy = Math.floor(centerMy * n);
        requestTile(tileZ, cx, cy);
    } catch (err) {
        console.warn('Seamlessphoto PMTiles error:', err);
    }
    await render();
    return {
        canvas,
        landmarks,
        gpuName,
        hasDrawElementImage,
        get textureUploadCount () {
            return textureUploadCount;
        },
        get renderCount () {
            return renderCount;
        },
        render,
        panBy,
        zoomBy,
        updateLabelContent,
        getLabelScreenPos,
        readPixel,
        waitForTile,
        hasAerialTiles
    };
}
