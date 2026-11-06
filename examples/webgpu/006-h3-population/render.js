const VERTEX = 0x20, UNIFORM = 0x40, COPY_DST = 0x8, MAP_READ = 0x1;
const RENDER_ATTACHMENT = 0x10, TEX_COPY_SRC = 0x01;
const SAMPLES = 4;
const WGSL = `
struct Uniforms {
  viewProj: mat4x4f,
  lightDir: vec3f,
  heightScale: f32,
  cameraPos: vec3f,
  time: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexInput {
  @location(0) pos: vec3f,      // x, y in [-1, 1], z_ratio (0.0 or 1.0)
  @location(1) normal: vec3f,   // nx, ny, nz
  @location(2) height: f32,     // max height
  @location(3) color: vec4f,    // unorm8x4 unpack
}

struct VertexOutput {
  @builtin(position) clipPos: vec4f,
  @location(0) normal: vec3f,
  @location(1) color: vec3f,
  @location(2) worldPos: vec3f,
}

@vertex
fn vs(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let z = in.pos.z * in.height * u.heightScale;
  let world = vec3f(in.pos.x, in.pos.y, z);
  out.clipPos = u.viewProj * vec4f(world, 1.0);
  out.normal = in.normal;
  out.color = in.color.rgb;
  out.worldPos = world;
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let N = normalize(in.normal);
  let L = normalize(u.lightDir);
  // Top surfaces (N.z > 0.8) get bright crisp light; sides get soft diffuse + ambient
  let diff = max(dot(N, L), 0.0);
  let ambient = select(0.38, 0.55, in.normal.z > 0.7);
  let light = clamp(ambient + diff * 0.62, 0.2, 1.0);
  let rgb = in.color * light;
  return vec4f(rgb, 1.0);
}
`;
export function populationColor(pop) {
    if (pop <= 0) return [
        0.1,
        0.18,
        0.24
    ];
    const t = Math.min(1.0, Math.max(0.0, Math.log10(pop + 1) / 7.0));
    if (t < 0.25) {
        const s = t / 0.25;
        return [
            0.15 + s * 0.1,
            0.35 + s * 0.25,
            0.55 - s * 0.1
        ];
    } else if (t < 0.5) {
        const s = (t - 0.25) / 0.25;
        return [
            0.25 + s * 0.35,
            0.60 + s * 0.25,
            0.45 - s * 0.25
        ];
    } else if (t < 0.75) {
        const s = (t - 0.5) / 0.25;
        return [
            0.60 + s * 0.35,
            0.85 - s * 0.15,
            0.20 - s * 0.1
        ];
    } else {
        const s = (t - 0.75) / 0.25;
        return [
            0.95 + s * 0.05,
            0.70 - s * 0.45,
            0.10 + s * 0.85
        ];
    }
}
export function populationHeight(pop) {
    if (pop <= 0) return 0.001;
    const logVal = Math.log10(pop + 1);
    return Math.max(0.0015, logVal / 7.2 * 0.085);
}
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
                    arrayStride: 32,
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
                        },
                        {
                            shaderLocation: 2,
                            offset: 24,
                            format: 'float32'
                        },
                        {
                            shaderLocation: 3,
                            offset: 28,
                            format: 'unorm8x4'
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
    let vertexBuffer = null;
    let vertexCount = 0;
    function uploadMesh(cells) {
        if (vertexBuffer) {
            vertexBuffer.destroy();
            vertexBuffer = null;
        }
        let totalTriangles = 0;
        for (const c of cells){
            for (const ring of c.rings){
                const n = ring.length;
                if (n >= 3) {
                    totalTriangles += n;
                    totalTriangles += n * 2;
                }
            }
        }
        vertexCount = totalTriangles * 3;
        const stride = 8;
        const bufferData = new Float32Array(vertexCount * stride);
        const colorBytes = new Uint8Array(bufferData.buffer);
        let offset = 0;
        for (const c of cells){
            const h = populationHeight(c.population);
            const [r, g, b] = populationColor(c.population);
            const cr = Math.round(r * 255), cg = Math.round(g * 255), cb = Math.round(b * 255);
            for (const ring of c.rings){
                const n = ring.length;
                if (n < 3) continue;
                const pts = new Array(n);
                let cx = 0, cy = 0;
                for(let i = 0; i < n; i++){
                    const px = ring[i][0] / 65535 * 2 - 1;
                    const py = (1 - ring[i][1] / 65535) * 2 - 1;
                    pts[i] = [
                        px,
                        py
                    ];
                    cx += px;
                    cy += py;
                }
                cx /= n;
                cy /= n;
                const pushV = (x, y, zRatio, nx, ny, nz)=>{
                    const idx = offset * stride;
                    bufferData[idx] = x;
                    bufferData[idx + 1] = y;
                    bufferData[idx + 2] = zRatio;
                    bufferData[idx + 3] = nx;
                    bufferData[idx + 4] = ny;
                    bufferData[idx + 5] = nz;
                    bufferData[idx + 6] = h;
                    const bIdx = idx * 4 + 28;
                    colorBytes[bIdx] = cr;
                    colorBytes[bIdx + 1] = cg;
                    colorBytes[bIdx + 2] = cb;
                    colorBytes[bIdx + 3] = 255;
                    offset++;
                };
                for(let i = 0; i < n; i++){
                    const next = (i + 1) % n;
                    pushV(cx, cy, 1.0, 0, 0, 1);
                    pushV(pts[i][0], pts[i][1], 1.0, 0, 0, 1);
                    pushV(pts[next][0], pts[next][1], 1.0, 0, 0, 1);
                }
                for(let i = 0; i < n; i++){
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
            }
        }
        const totalBytes = bufferData.byteLength;
        vertexBuffer = device.createBuffer({
            size: totalBytes,
            usage: VERTEX | COPY_DST,
            mappedAtCreation: true
        });
        new Float32Array(vertexBuffer.getMappedRange()).set(bufferData);
        vertexBuffer.unmap();
        return {
            vertexCount: offset,
            bytes: totalBytes
        };
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
        const fovY = 45 * Math.PI / 180;
        const tanHalfFov = Math.tan(fovY / 2);
        const near = 0.01;
        const far = 100.0;
        const proj = new Float32Array(16);
        proj[0] = 1 / (aspect * tanHalfFov);
        proj[5] = 1 / tanHalfFov;
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
        const viewProj = new Float32Array(16);
        for(let i = 0; i < 4; i++){
            for(let j = 0; j < 4; j++){
                let sum = 0;
                for(let k = 0; k < 4; k++)sum += proj[k * 4 + i] * view[j * 4 + k];
                viewProj[j * 4 + i] = sum;
            }
        }
        return viewProj;
    }
    function draw(cam, toOffscreen = false) {
        if (!vertexBuffer || vertexCount === 0) return;
        const dpr = Math.min(2, devicePixelRatio || 1);
        resize(Math.max(1, Math.round(cam.width * dpr)), Math.max(1, Math.round(cam.height * dpr)));
        const viewProj = buildViewProj(cam);
        const uData = new Float32Array(24);
        uData.set(viewProj, 0);
        const lX = 0.5, lY = -0.7, lZ = 0.9;
        const lLen = Math.hypot(lX, lY, lZ);
        uData[16] = lX / lLen;
        uData[17] = lY / lLen;
        uData[18] = lZ / lLen;
        uData[19] = cam.heightScale;
        uData[20] = cam.x;
        uData[21] = cam.y;
        uData[22] = cam.distance;
        uData[23] = performance.now() * 0.001;
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
                        0.055,
                        0.085,
                        0.125,
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
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(vertexCount);
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
        uploadMesh,
        draw,
        readScreen,
        size: ()=>[
                w,
                h
            ]
    };
}
