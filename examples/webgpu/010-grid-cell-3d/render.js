import { createUnitCubeMesh, gridToWorld, treeDensityColor } from './grid.js';
const VERTEX = 0x20, UNIFORM = 0x40, COPY_DST = 0x8, MAP_READ = 0x1;
const RENDER_ATTACHMENT = 0x10, TEX_COPY_SRC = 0x01;
const SAMPLES = 4;
const WGSL = `
struct Uniforms {
  viewProj: mat4x4f,
  lightDir: vec3f,
  elevationScale: f32,
  coverage: f32,
  cellSize: f32,
  time: f32,
  pad0: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexIn {
  @location(0) pos: vec3f,      // unit cube [0..1]
  @location(1) normal: vec3f,   // unit normal
}

struct InstanceIn {
  @location(2) worldXY: vec2f,  // cell origin (meters)
  @location(3) height: f32,     // base column height
  @location(4) color: vec4f,    // base color RGBA
}

struct VertexOut {
  @builtin(position) clipPos: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vs(v: VertexIn, inst: InstanceIn) -> VertexOut {
  var out: VertexOut;
  let span = u.cellSize * u.coverage;
  let margin = u.cellSize * (1.0 - u.coverage) * 0.5;

  let x = inst.worldXY.x + margin + v.pos.x * span;
  let y = inst.worldXY.y + margin + v.pos.y * span;
  let z = v.pos.z * inst.height * u.elevationScale;

  let world = vec3f(x, y, z);
  out.clipPos = u.viewProj * vec4f(world, 1.0);

  // Directional diffuse + ambient lighting
  let diff = max(0.0, dot(v.normal, u.lightDir));
  let ambient = 0.35;
  let lighting = ambient + diff * 0.65;
  out.color = inst.color.rgb * lighting;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}
`;
export async function createRenderer(canvas) {
    const adapter = await navigator.gpu?.requestAdapter({
        powerPreference: 'high-performance'
    });
    if (!adapter) throw new Error('WebGPU が使えません');
    const device = await adapter.requestDevice();
    device.lost.then((e)=>console.error('WebGPU device lost:', e.message));
    const gpu = `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU の canvas が使えません');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format,
        alphaMode: 'opaque',
        usage: RENDER_ATTACHMENT | TEX_COPY_SRC
    });
    const unitCubeData = createUnitCubeMesh();
    const unitCubeBuffer = device.createBuffer({
        size: unitCubeData.byteLength,
        usage: VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(unitCubeBuffer.getMappedRange()).set(unitCubeData);
    unitCubeBuffer.unmap();
    const cubeVertexCount = 30;
    const module = device.createShaderModule({
        code: WGSL
    });
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module,
            entryPoint: 'vs',
            buffers: [
                {
                    arrayStride: 24,
                    stepMode: 'vertex',
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x3'
                        },
                        {
                            shaderLocation: 1,
                            offset: 12,
                            format: 'float32x3'
                        }
                    ]
                },
                {
                    arrayStride: 32,
                    stepMode: 'instance',
                    attributes: [
                        {
                            shaderLocation: 2,
                            offset: 0,
                            format: 'float32x2'
                        },
                        {
                            shaderLocation: 3,
                            offset: 8,
                            format: 'float32'
                        },
                        {
                            shaderLocation: 4,
                            offset: 16,
                            format: 'float32x4'
                        }
                    ]
                }
            ]
        },
        fragment: {
            module,
            entryPoint: 'fs',
            targets: [
                {
                    format
                }
            ]
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'none'
        },
        depthStencil: {
            format: 'depth32float',
            depthWriteEnabled: true,
            depthCompare: 'greater'
        },
        multisample: {
            count: SAMPLES
        }
    });
    const uniformBuffer = device.createBuffer({
        size: 96,
        usage: UNIFORM | COPY_DST
    });
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer
                }
            }
        ]
    });
    let instanceBuffer = null;
    let instanceCount = 0;
    let currentCellSize = 256;
    function uploadCells(cells, cellSize) {
        if (instanceBuffer) instanceBuffer.destroy();
        instanceCount = cells.length;
        currentCellSize = cellSize;
        if (instanceCount === 0) return 0;
        let maxCount = 1;
        for (const c of cells)if (c.count > maxCount) maxCount = c.count;
        const data = new Float32Array(instanceCount * 8);
        for(let i = 0; i < instanceCount; i++){
            const c = cells[i];
            const [wx, wy] = gridToWorld(c.ix, c.iy, cellSize);
            const height = Math.max(15, Math.log10(c.count + 1) / Math.log10(maxCount + 1) * 1200);
            const [r, g, b, a] = treeDensityColor(c.count, maxCount);
            const base = i * 8;
            data[base] = wx;
            data[base + 1] = wy;
            data[base + 2] = height;
            data[base + 3] = 0;
            data[base + 4] = r;
            data[base + 5] = g;
            data[base + 6] = b;
            data[base + 7] = a;
        }
        instanceBuffer = device.createBuffer({
            size: data.byteLength,
            usage: VERTEX,
            mappedAtCreation: true
        });
        new Float32Array(instanceBuffer.getMappedRange()).set(data);
        instanceBuffer.unmap();
        return instanceCount;
    }
    let w = 0, h = 0;
    let msaaTexture, depthTexture, offscreenTexture;
    function resize(width, height) {
        if (width === w && height === h) return;
        canvas.width = w = width;
        canvas.height = h = height;
        for (const t of [
            msaaTexture,
            depthTexture,
            offscreenTexture
        ])t?.destroy();
        msaaTexture = device.createTexture({
            size: [
                w,
                h
            ],
            format,
            sampleCount: SAMPLES,
            usage: RENDER_ATTACHMENT
        });
        depthTexture = device.createTexture({
            size: [
                w,
                h
            ],
            format: 'depth32float',
            sampleCount: SAMPLES,
            usage: RENDER_ATTACHMENT
        });
        offscreenTexture = device.createTexture({
            size: [
                w,
                h
            ],
            format,
            usage: RENDER_ATTACHMENT | TEX_COPY_SRC
        });
    }
    function buildViewProj(cam) {
        const aspect = cam.width / cam.height;
        const fov = 45 * Math.PI / 180;
        const tanHalf = Math.tan(fov / 2);
        const near = 10.0, far = 100000.0;
        const proj = new Float32Array(16);
        proj[0] = 1 / (aspect * tanHalf);
        proj[5] = 1 / tanHalf;
        proj[10] = near / (far - near);
        proj[11] = -1.0;
        proj[14] = near * far / (far - near);
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
        view[0] = rX;
        view[4] = rY;
        view[8] = rZ;
        view[12] = -(rX * eyeX + rY * eyeY + rZ * eyeZ);
        view[1] = uX;
        view[5] = uY;
        view[9] = uZ;
        view[13] = -(uX * eyeX + uY * eyeY + uZ * eyeZ);
        view[2] = -fwdX;
        view[6] = -fwdY;
        view[10] = -fwdZ;
        view[14] = fwdX * eyeX + fwdY * eyeY + fwdZ * eyeZ;
        view[3] = 0;
        view[7] = 0;
        view[11] = 0;
        view[15] = 1;
        const vp = new Float32Array(16);
        for(let i = 0; i < 4; i++){
            for(let j = 0; j < 4; j++){
                let sum = 0;
                for(let k = 0; k < 4; k++)sum += proj[k * 4 + i] * view[j * 4 + k];
                vp[j * 4 + i] = sum;
            }
        }
        return vp;
    }
    function draw(cam, toOffscreen = false) {
        if (!instanceBuffer || instanceCount === 0) return;
        const dpr = Math.min(2, devicePixelRatio || 1);
        resize(Math.max(1, Math.round(cam.width * dpr)), Math.max(1, Math.round(cam.height * dpr)));
        const viewProj = buildViewProj(cam);
        const lX = 0.5, lY = -0.7, lZ = 0.85;
        const lLen = Math.hypot(lX, lY, lZ);
        const uData = new Float32Array(24);
        uData.set(viewProj, 0);
        uData[16] = lX / lLen;
        uData[17] = lY / lLen;
        uData[18] = lZ / lLen;
        uData[19] = cam.elevationScale;
        uData[20] = cam.coverage;
        uData[21] = currentCellSize;
        uData[22] = performance.now() * 0.001;
        device.queue.writeBuffer(uniformBuffer, 0, uData);
        const targetTexture = toOffscreen ? offscreenTexture : context.getCurrentTexture();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: msaaTexture.createView(),
                    resolveTarget: targetTexture.createView(),
                    loadOp: 'clear',
                    storeOp: 'discard',
                    clearValue: [
                        0.06,
                        0.10,
                        0.14,
                        1
                    ]
                }
            ],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 0.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'discard'
            }
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, unitCubeBuffer);
        pass.setVertexBuffer(1, instanceBuffer);
        pass.draw(cubeVertexCount, instanceCount);
        pass.end();
        device.queue.submit([
            encoder.finish()
        ]);
    }
    async function readScreen(cam) {
        draw(cam, true);
        const row = Math.ceil(w * 4 / 256) * 256;
        const read = device.createBuffer({
            size: row * h,
            usage: COPY_DST | MAP_READ
        });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({
            texture: offscreenTexture
        }, {
            buffer: read,
            bytesPerRow: row
        }, [
            w,
            h
        ]);
        device.queue.submit([
            encoder.finish()
        ]);
        await read.mapAsync(MAP_READ);
        const raw = new Uint8Array(read.getMappedRange()), out = new Uint8Array(w * h * 4);
        const bgra = format === 'bgra8unorm';
        for(let y = 0; y < h; y++){
            for(let x = 0; x < w; x++){
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
        uploadCells,
        draw,
        readScreen,
        size: ()=>[
                w,
                h
            ]
    };
}
