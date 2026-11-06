import { decodePoints, weightToColor } from './scatter.js';
const VERTEX = 0x20;
const UNIFORM = 0x40;
const COPY_DST = 0x08;
const COPY_SRC = 0x04;
const MAP_READ = 0x01;
const RENDER_ATTACHMENT = 0x10;
const STAGE_VERTEX = 0x1;
const STAGE_FRAGMENT = 0x2;
const WGSL = `
struct Uniforms {
  centerMerc: vec2<f32>,
  viewSize: vec2<f32>,
  worldPx: f32,
  radiusScale: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexInput {
  @location(0) quadPos: vec2<f32>,     // unit quad [-1, 1]
  @location(1) mercPos: vec2<f32>,     // Mercator [0, 1]
  @location(2) weight: f32,
  @location(3) baseRadius: f32,
  @location(4) color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) pixelOffset: vec2<f32>,
  @location(1) radius: f32,
  @location(2) color: vec4<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;

  let screenCenterX = u.viewSize.x * 0.5 + (in.mercPos.x - u.centerMerc.x) * u.worldPx;
  let screenCenterY = u.viewSize.y * 0.5 + (in.mercPos.y - u.centerMerc.y) * u.worldPx;

  let r = in.baseRadius * u.radiusScale;
  let halfSpan = r + 1.5; // Extra padding for antialiasing smoothstep

  let screenX = screenCenterX + in.quadPos.x * halfSpan;
  let screenY = screenCenterY + in.quadPos.y * halfSpan;

  let ndcX = (screenX / u.viewSize.x) * 2.0 - 1.0;
  let ndcY = 1.0 - (screenY / u.viewSize.y) * 2.0;

  out.position = vec4<f32>(ndcX, ndcY, 0.0, 1.0);
  out.pixelOffset = in.quadPos * halfSpan;
  out.radius = r;
  out.color = in.color;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let dist = length(in.pixelOffset);
  let delta = 0.8;
  let coverage = 1.0 - smoothstep(in.radius - delta, in.radius + delta, dist);
  if (coverage <= 0.001) {
    discard;
  }

  // Thin outer stroke enhancement for crisp visual distinction
  let strokeRatio = smoothstep(in.radius - delta - 1.0, in.radius - delta, dist);
  let rgb = mix(in.color.rgb, in.color.rgb * 0.65, strokeRatio);
  let alpha = in.color.a * coverage;

  return vec4<f32>(rgb * alpha, alpha);
}
`;
export class WebGPUScatterplotRenderer {
    device;
    context;
    canvasFormat;
    quadBuffer;
    instanceBuffer;
    instanceCount = 0;
    pipeline;
    uniformBuffer;
    bindGroup;
    constructor(device, context){
        this.device = device;
        this.context = context;
        this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: this.canvasFormat,
            alphaMode: 'premultiplied',
            usage: RENDER_ATTACHMENT | COPY_SRC
        });
        const quadVertices = new Float32Array([
            -1,
            -1,
            1,
            -1,
            -1,
            1,
            -1,
            1,
            1,
            -1,
            1,
            1
        ]);
        this.quadBuffer = this.device.createBuffer({
            size: quadVertices.byteLength,
            usage: VERTEX | COPY_DST
        });
        this.device.queue.writeBuffer(this.quadBuffer, 0, quadVertices);
        this.instanceBuffer = this.device.createBuffer({
            size: 16,
            usage: VERTEX | COPY_DST
        });
        this.uniformBuffer = this.device.createBuffer({
            size: 32,
            usage: UNIFORM | COPY_DST
        });
        const shaderModule = this.device.createShaderModule({
            code: WGSL
        });
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: STAGE_VERTEX,
                    buffer: {
                        type: 'uniform'
                    }
                }
            ]
        });
        this.bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.uniformBuffer
                    }
                }
            ]
        });
        this.pipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [
                    bindGroupLayout
                ]
            }),
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
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
                        arrayStride: 32,
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
                                format: 'float32'
                            },
                            {
                                shaderLocation: 3,
                                offset: 12,
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
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [
                    {
                        format: this.canvasFormat,
                        blend: {
                            color: {
                                operation: 'add',
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha'
                            },
                            alpha: {
                                operation: 'add',
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha'
                            }
                        }
                    }
                ]
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none'
            }
        });
    }
    hasData() {
        return this.instanceCount > 0;
    }
    setData(data) {
        const points = decodePoints(data);
        this.instanceCount = points.length;
        const packed = new Float32Array(this.instanceCount * 8);
        for(let i = 0; i < this.instanceCount; i++){
            const p = points[i];
            const offset = i * 8;
            packed[offset] = p.x;
            packed[offset + 1] = p.y;
            packed[offset + 2] = p.weight;
            packed[offset + 3] = p.weight >= 2 ? 6.0 : 4.0;
            const color = weightToColor(p.weight);
            packed[offset + 4] = color[0];
            packed[offset + 5] = color[1];
            packed[offset + 6] = color[2];
            packed[offset + 7] = color[3];
        }
        this.instanceBuffer.destroy();
        this.instanceBuffer = this.device.createBuffer({
            size: packed.byteLength,
            usage: VERTEX | COPY_DST
        });
        this.device.queue.writeBuffer(this.instanceBuffer, 0, packed);
    }
    render(view) {
        if (this.instanceCount === 0) return;
        const canvas = this.context.canvas;
        const width = view.width ?? canvas.width;
        const height = view.height ?? canvas.height;
        if (width === 0 || height === 0) return;
        const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
        const centerX = (view.center[0] + 180) / 360;
        const centerY = mercY(view.center[1]);
        const worldPx = 256 * Math.pow(2, view.zoom);
        const uniforms = new Float32Array([
            centerX,
            centerY,
            width,
            height,
            worldPx,
            view.radiusScale,
            0,
            0
        ]);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
        const commandEncoder = this.device.createCommandEncoder();
        const pass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.context.getCurrentTexture().createView(),
                    clearValue: {
                        r: 0.05,
                        g: 0.08,
                        b: 0.12,
                        a: 1.0
                    },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.quadBuffer);
        pass.setVertexBuffer(1, this.instanceBuffer);
        pass.draw(6, this.instanceCount, 0, 0);
        pass.end();
        this.device.queue.submit([
            commandEncoder.finish()
        ]);
    }
    async readScreen(view) {
        this.render(view);
        const canvas = this.context.canvas;
        const w = view.width ?? canvas.width;
        const h = view.height ?? canvas.height;
        const bytesPerRow = Math.ceil(w * 4 / 256) * 256;
        const readBuffer = this.device.createBuffer({
            size: bytesPerRow * h,
            usage: COPY_DST | MAP_READ
        });
        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToBuffer({
            texture: this.context.getCurrentTexture()
        }, {
            buffer: readBuffer,
            bytesPerRow
        }, [
            w,
            h,
            1
        ]);
        this.device.queue.submit([
            encoder.finish()
        ]);
        await readBuffer.mapAsync(MAP_READ);
        const raw = new Uint8Array(readBuffer.getMappedRange());
        const out = new Uint8Array(w * h * 4);
        const isBgra = this.canvasFormat === 'bgra8unorm';
        for(let y = 0; y < h; y++){
            for(let x = 0; x < w; x++){
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
