import { projectMercator } from './arc.js';
const VERTEX = 0x20, UNIFORM = 0x40, COPY_DST = 0x8, MAP_READ = 0x1;
const RENDER_ATTACHMENT = 0x10, TEX_COPY_SRC = 0x01;
const SAMPLES = 4;
const ARC_SEGMENTS = 48;
const ARC_WGSL = `
struct Uniforms {
  viewProj: mat4x4f,
  eye: vec3f,
  heightScale: f32,
  width: f32,
  time: f32,
  pad0: f32,
  pad1: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexIn {
  @location(0) stripCoord: vec2f, // x = t in [0, 1], y = side in [-1, 1]
}

struct InstanceIn {
  @location(1) src: vec2f,        // [x, y] in [-1, 1]
  @location(2) dst: vec2f,        // [x, y] in [-1, 1]
  @location(3) color0: vec4f,     // start color RGBA
  @location(4) color1: vec4f,     // end color RGBA
}

struct VertexOut {
  @builtin(position) clipPos: vec4f,
  @location(0) color: vec4f,
  @location(1) t: f32,
}

@vertex
fn vs(v: VertexIn, inst: InstanceIn) -> VertexOut {
  var out: VertexOut;
  let t = v.stripCoord.x;
  let side = v.stripCoord.y;

  let delta = inst.dst - inst.src;
  let dist = length(delta);
  let dir = select(vec2f(1.0, 0.0), delta / dist, dist > 0.00001);

  // Parabolic elevation arch: peak at midpoint t = 0.5
  let maxH = clamp(dist * 0.35 * u.heightScale, 0.008, 0.35);
  let z = 4.0 * maxH * t * (1.0 - t);
  let centerPos = vec3f(inst.src + delta * t, z);

  // Tangent along curve in 3D
  let dzdt = 4.0 * maxH * (1.0 - 2.0 * t);
  let tangent = normalize(vec3f(delta, dzdt));

  // View vector from vertex to camera eye
  let toEye = normalize(u.eye - centerPos);

  // Ribbon normal perpendicular to tangent and facing camera (camera-facing billboard ribbon)
  var ribbonNorm = cross(tangent, toEye);
  let normLen = length(ribbonNorm);
  if (normLen > 0.001) {
    ribbonNorm = ribbonNorm / normLen;
  } else {
    ribbonNorm = vec3f(-dir.y, dir.x, 0.0);
  }

  let halfWidth = side * (u.width * 0.0014);
  let world = centerPos + ribbonNorm * halfWidth;

  out.clipPos = u.viewProj * vec4f(world, 1.0);
  out.color = mix(inst.color0, inst.color1, t);
  out.t = t;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  return in.color;
}
`;
const LAND_WGSL = `
struct Uniforms {
  viewProj: mat4x4f,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs(@location(0) pos: vec2f) -> @builtin(position) vec4f {
  // Land rests on Z = -0.0005 to prevent z-fighting with arc bases
  return u.viewProj * vec4f(pos.x, pos.y, -0.0005, 1.0);
}

@fragment
fn fs() -> @location(0) vec4f {
  return vec4f(0.28, 0.38, 0.52, 0.9); // clear distinct coastline
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
    const stripVertices = [];
    for(let i = 0; i <= ARC_SEGMENTS; i++){
        const t = i / ARC_SEGMENTS;
        stripVertices.push(t, -1.0);
        stripVertices.push(t, 1.0);
    }
    const stripBuffer = device.createBuffer({
        size: stripVertices.length * 4,
        usage: VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(stripBuffer.getMappedRange()).set(stripVertices);
    stripBuffer.unmap();
    const stripVertexCount = stripVertices.length / 2;
    const arcModule = device.createShaderModule({
        code: ARC_WGSL
    });
    const arcPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: arcModule,
            entryPoint: 'vs',
            buffers: [
                {
                    arrayStride: 8,
                    stepMode: 'vertex',
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x2'
                        }
                    ]
                },
                {
                    arrayStride: 48,
                    stepMode: 'instance',
                    attributes: [
                        {
                            shaderLocation: 1,
                            offset: 0,
                            format: 'float32x2'
                        },
                        {
                            shaderLocation: 2,
                            offset: 8,
                            format: 'float32x2'
                        },
                        {
                            shaderLocation: 3,
                            offset: 16,
                            format: 'float32x4'
                        },
                        {
                            shaderLocation: 4,
                            offset: 32,
                            format: 'float32x4'
                        }
                    ]
                }
            ]
        },
        fragment: {
            module: arcModule,
            entryPoint: 'fs',
            targets: [
                {
                    format,
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one',
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
            topology: 'triangle-strip'
        },
        depthStencil: {
            format: 'depth32float',
            depthWriteEnabled: false,
            depthCompare: 'greater-equal'
        },
        multisample: {
            count: SAMPLES
        }
    });
    const landModule = device.createShaderModule({
        code: LAND_WGSL
    });
    const landPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: landModule,
            entryPoint: 'vs',
            buffers: [
                {
                    arrayStride: 8,
                    stepMode: 'vertex',
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x2'
                        }
                    ]
                }
            ]
        },
        fragment: {
            module: landModule,
            entryPoint: 'fs',
            targets: [
                {
                    format
                }
            ]
        },
        primitive: {
            topology: 'line-strip'
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
    const arcUniformBuffer = device.createBuffer({
        size: 96,
        usage: UNIFORM | COPY_DST
    });
    const arcBindGroup = device.createBindGroup({
        layout: arcPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: arcUniformBuffer
                }
            }
        ]
    });
    const landUniformBuffer = device.createBuffer({
        size: 64,
        usage: UNIFORM | COPY_DST
    });
    const landBindGroup = device.createBindGroup({
        layout: landPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: landUniformBuffer
                }
            }
        ]
    });
    let arcInstanceBuffer = null;
    let arcInstanceCount = 0;
    let landBuffer = null;
    let landRanges = [];
    function uploadArcs(flows, centroids) {
        if (arcInstanceBuffer) arcInstanceBuffer.destroy();
        arcInstanceCount = flows.length;
        if (arcInstanceCount === 0) return 0;
        const data = new Float32Array(arcInstanceCount * 12);
        for(let i = 0; i < arcInstanceCount; i++){
            const f = flows[i];
            const sxM = centroids[f.s * 2], syM = centroids[f.s * 2 + 1];
            const txM = centroids[f.t * 2], tyM = centroids[f.t * 2 + 1];
            const sx = sxM * 2 - 1, sy = (1 - syM) * 2 - 1;
            const tx = txM * 2 - 1, ty = (1 - tyM) * 2 - 1;
            const base = i * 12;
            data[base] = sx;
            data[base + 1] = sy;
            data[base + 2] = tx;
            data[base + 3] = ty;
            data[base + 4] = 0.08;
            data[base + 5] = 0.75;
            data[base + 6] = 1.0;
            data[base + 7] = 0.85;
            data[base + 8] = 1.0;
            data[base + 9] = 0.22;
            data[base + 10] = 0.48;
            data[base + 11] = 0.85;
        }
        arcInstanceBuffer = device.createBuffer({
            size: data.byteLength,
            usage: VERTEX,
            mappedAtCreation: true
        });
        new Float32Array(arcInstanceBuffer.getMappedRange()).set(data);
        arcInstanceBuffer.unmap();
        return arcInstanceCount;
    }
    function uploadLand(landRings) {
        if (landBuffer) landBuffer.destroy();
        landRanges = [];
        let totalPoints = 0;
        for (const r of landRings)totalPoints += r.length / 2;
        const data = new Float32Array(totalPoints * 2);
        let offset = 0;
        for (const r of landRings){
            const n = r.length / 2;
            landRanges.push({
                start: offset,
                count: n
            });
            for(let i = 0; i < n; i++){
                const mx = r[i * 2], my = r[i * 2 + 1];
                data[(offset + i) * 2] = mx * 2 - 1;
                data[(offset + i) * 2 + 1] = (1 - my) * 2 - 1;
            }
            offset += n;
        }
        landBuffer = device.createBuffer({
            size: data.byteLength,
            usage: VERTEX,
            mappedAtCreation: true
        });
        new Float32Array(landBuffer.getMappedRange()).set(data);
        landBuffer.unmap();
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
        const near = 0.01, far = 100.0;
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
        return {
            vp,
            eye: [
                eyeX,
                eyeY,
                eyeZ
            ]
        };
    }
    function draw(cam, toOffscreen = false) {
        const dpr = Math.min(2, devicePixelRatio || 1);
        resize(Math.max(1, Math.round(cam.width * dpr)), Math.max(1, Math.round(cam.height * dpr)));
        const { vp: viewProj, eye } = buildViewProj(cam);
        const arcData = new Float32Array(24);
        arcData.set(viewProj, 0);
        arcData[16] = eye[0];
        arcData[17] = eye[1];
        arcData[18] = eye[2];
        arcData[19] = cam.heightScale;
        arcData[20] = cam.lineWidth * dpr;
        arcData[21] = performance.now() * 0.001;
        device.queue.writeBuffer(arcUniformBuffer, 0, arcData);
        device.queue.writeBuffer(landUniformBuffer, 0, viewProj);
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
                        0.04,
                        0.07,
                        0.12,
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
        if (landBuffer && landRanges.length > 0) {
            pass.setPipeline(landPipeline);
            pass.setBindGroup(0, landBindGroup);
            pass.setVertexBuffer(0, landBuffer);
            for (const r of landRanges)pass.draw(r.count, 1, r.start);
        }
        if (arcInstanceBuffer && arcInstanceCount > 0) {
            pass.setPipeline(arcPipeline);
            pass.setBindGroup(0, arcBindGroup);
            pass.setVertexBuffer(0, stripBuffer);
            pass.setVertexBuffer(1, arcInstanceBuffer);
            pass.draw(stripVertexCount, arcInstanceCount);
        }
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
        uploadArcs,
        uploadLand,
        draw,
        readScreen,
        size: ()=>[
                w,
                h
            ]
    };
}
