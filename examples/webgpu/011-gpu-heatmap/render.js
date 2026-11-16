import { decodeHM01 } from './heatmap.js';
const VERTEX = 0x20;
const UNIFORM = 0x40;
const COPY_DST = 0x08;
const COPY_SRC = 0x04;
const MAP_READ = 0x01;
const RENDER_ATTACHMENT = 0x10;
const TEXTURE_BINDING = 0x04;
const STAGE_VERTEX = 0x1;
const STAGE_FRAGMENT = 0x2;
const SPLAT_WGSL = `
struct Uniforms {
  center: vec2<f32>,
  viewSize: vec2<f32>,
  worldPx: f32,
  radius: f32,
  scale: f32,
  padding: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexInput {
  @location(0) quadPos: vec2<f32>,
  @location(1) ptCoord: vec2<f32>,
  @location(2) ptWeight: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) weight: f32,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let screenX = u.viewSize.x * 0.5 + (in.ptCoord.x - u.center.x) * u.worldPx;
  let screenY = u.viewSize.y * 0.5 + (in.ptCoord.y - u.center.y) * u.worldPx;

  let pxOffset = in.quadPos * (u.radius / u.scale);
  let targetX = (screenX / u.scale) + pxOffset.x;
  let targetY = (screenY / u.scale) + pxOffset.y;

  let targetW = u.viewSize.x / u.scale;
  let targetH = u.viewSize.y / u.scale;

  let ndcX = (targetX / targetW) * 2.0 - 1.0;
  let ndcY = 1.0 - (targetY / targetH) * 2.0;

  out.position = vec4<f32>(ndcX, ndcY, 0.0, 1.0);
  out.uv = in.quadPos;
  out.weight = in.ptWeight;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) {
    discard;
  }
  let w = in.weight * exp(-4.0 * r2);
  return vec4<f32>(w, 0.0, 0.0, 1.0);
}
`;
const COLOR_WGSL = `
struct Params {
  intensity: f32,
  threshold: f32,
  maxRef: f32,
  padding: f32,
};

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var s_sampler: sampler;
@group(0) @binding(2) var t_density: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var out: VertexOutput;
  let x = f32(i32(vid == 1u) * 4 - 1);
  let y = f32(i32(vid == 2u) * 4 - 1);
  out.position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let density = textureSample(t_density, s_sampler, in.uv).r;
  let v = clamp((density / p.maxRef) * p.intensity, 0.0, 1.0);

  let bg = vec3<f32>(0.045, 0.075, 0.11);
  if (v <= p.threshold) {
    return vec4<f32>(bg, 1.0);
  }

  let t = (v - p.threshold) / max(0.001, 1.0 - p.threshold);
  var color: vec3<f32>;
  if (t < 0.25) {
    color = mix(vec3<f32>(0.13, 0.20, 0.40), vec3<f32>(0.18, 0.48, 0.72), t * 4.0);
  } else if (t < 0.50) {
    color = mix(vec3<f32>(0.18, 0.48, 0.72), vec3<f32>(0.30, 0.78, 0.70), (t - 0.25) * 4.0);
  } else if (t < 0.75) {
    color = mix(vec3<f32>(0.30, 0.78, 0.70), vec3<f32>(1.00, 0.84, 0.34), (t - 0.50) * 4.0);
  } else {
    color = mix(vec3<f32>(1.00, 0.84, 0.34), vec3<f32>(0.98, 0.29, 0.24), (t - 0.75) * 4.0);
  }

  let finalColor = mix(bg, color, smoothstep(0.0, 0.08, t));
  return vec4<f32>(finalColor, 1.0);
}
`;
export class WebGPUHeatmapRenderer {
    device;
    context;
    canvasFormat;
    quadBuffer;
    pointBuffer;
    pointCount = 0;
    splatPipeline;
    splatUniformBuffer;
    splatBindGroup;
    colorPipeline;
    colorParamBuffer;
    colorSampler;
    densityTexture = null;
    densityTextureView = null;
    colorBindGroup = null;
    targetScale = 2.0;
    targetWidth = 0;
    targetHeight = 0;
    constructor(device, context){
        this.device = device;
        this.context = context;
        this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: this.canvasFormat,
            alphaMode: 'opaque',
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
        this.pointBuffer = this.device.createBuffer({
            size: 16,
            usage: VERTEX | COPY_DST
        });
        this.splatUniformBuffer = this.device.createBuffer({
            size: 32,
            usage: UNIFORM | COPY_DST
        });
        const splatModule = this.device.createShaderModule({
            code: SPLAT_WGSL
        });
        const splatBindGroupLayout = this.device.createBindGroupLayout({
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
        this.splatBindGroup = this.device.createBindGroup({
            layout: splatBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.splatUniformBuffer
                    }
                }
            ]
        });
        this.splatPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [
                    splatBindGroupLayout
                ]
            }),
            vertex: {
                module: splatModule,
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
                        arrayStride: 12,
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
                            }
                        ]
                    }
                ]
            },
            fragment: {
                module: splatModule,
                entryPoint: 'fs_main',
                targets: [
                    {
                        format: 'r16float',
                        blend: {
                            color: {
                                operation: 'add',
                                srcFactor: 'one',
                                dstFactor: 'one'
                            },
                            alpha: {
                                operation: 'add',
                                srcFactor: 'one',
                                dstFactor: 'one'
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
        this.colorParamBuffer = this.device.createBuffer({
            size: 16,
            usage: UNIFORM | COPY_DST
        });
        this.colorSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge'
        });
        const colorModule = this.device.createShaderModule({
            code: COLOR_WGSL
        });
        const colorBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: STAGE_FRAGMENT,
                    buffer: {
                        type: 'uniform'
                    }
                },
                {
                    binding: 1,
                    visibility: STAGE_FRAGMENT,
                    sampler: {
                        type: 'filtering'
                    }
                },
                {
                    binding: 2,
                    visibility: STAGE_FRAGMENT,
                    texture: {
                        sampleType: 'float'
                    }
                }
            ]
        });
        this.colorPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [
                    colorBindGroupLayout
                ]
            }),
            vertex: {
                module: colorModule,
                entryPoint: 'vs_main'
            },
            fragment: {
                module: colorModule,
                entryPoint: 'fs_main',
                targets: [
                    {
                        format: this.canvasFormat
                    }
                ]
            },
            primitive: {
                topology: 'triangle-list'
            }
        });
    }
    hasData() {
        return this.pointCount > 0;
    }
    setData(data) {
        const decoded = decodeHM01(data);
        this.pointCount = decoded.points.length;
        const packed = new Float32Array(this.pointCount * 3);
        for(let i = 0; i < this.pointCount; i++){
            const p = decoded.points[i];
            const offset = i * 3;
            packed[offset] = p.x;
            packed[offset + 1] = p.y;
            packed[offset + 2] = p.weight;
        }
        this.pointBuffer.destroy();
        this.pointBuffer = this.device.createBuffer({
            size: packed.byteLength,
            usage: VERTEX | COPY_DST
        });
        this.device.queue.writeBuffer(this.pointBuffer, 0, packed);
    }
    ensureDensityTexture(width, height) {
        const tw = Math.max(1, Math.floor(width / this.targetScale));
        const th = Math.max(1, Math.floor(height / this.targetScale));
        if (this.densityTexture && this.targetWidth === tw && this.targetHeight === th) {
            return;
        }
        if (this.densityTexture) {
            this.densityTexture.destroy();
        }
        this.targetWidth = tw;
        this.targetHeight = th;
        this.densityTexture = this.device.createTexture({
            size: [
                tw,
                th,
                1
            ],
            format: 'r16float',
            usage: RENDER_ATTACHMENT | TEXTURE_BINDING
        });
        this.densityTextureView = this.densityTexture.createView();
        this.colorBindGroup = this.device.createBindGroup({
            layout: this.colorPipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.colorParamBuffer
                    }
                },
                {
                    binding: 1,
                    resource: this.colorSampler
                },
                {
                    binding: 2,
                    resource: this.densityTextureView
                }
            ]
        });
    }
    render(view) {
        if (this.pointCount === 0) return;
        const canvas = this.context.canvas;
        const width = view.width ?? canvas.width;
        const height = view.height ?? canvas.height;
        if (width === 0 || height === 0) return;
        this.ensureDensityTexture(width, height);
        if (!this.densityTextureView || !this.colorBindGroup) return;
        const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
        const centerX = (view.center[0] + 180) / 360;
        const centerY = mercY(view.center[1]);
        const worldPx = 256 * Math.pow(2, view.zoom);
        const splatUniforms = new Float32Array([
            centerX,
            centerY,
            width,
            height,
            worldPx,
            view.radius,
            this.targetScale,
            0
        ]);
        this.device.queue.writeBuffer(this.splatUniformBuffer, 0, splatUniforms);
        const baselineMax = Math.max(10.0, 50.0 * Math.pow(view.radius / 30.0, 1.5));
        const colorParams = new Float32Array([
            view.intensity,
            view.threshold,
            baselineMax,
            0
        ]);
        this.device.queue.writeBuffer(this.colorParamBuffer, 0, colorParams);
        const commandEncoder = this.device.createCommandEncoder();
        const splatPass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.densityTextureView,
                    clearValue: {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 1.0
                    },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        splatPass.setPipeline(this.splatPipeline);
        splatPass.setBindGroup(0, this.splatBindGroup);
        splatPass.setVertexBuffer(0, this.quadBuffer);
        splatPass.setVertexBuffer(1, this.pointBuffer);
        splatPass.draw(6, this.pointCount, 0, 0);
        splatPass.end();
        const colorPass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.context.getCurrentTexture().createView(),
                    clearValue: {
                        r: 0.045,
                        g: 0.075,
                        b: 0.11,
                        a: 1.0
                    },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        colorPass.setPipeline(this.colorPipeline);
        colorPass.setBindGroup(0, this.colorBindGroup);
        colorPass.draw(3, 1, 0, 0);
        colorPass.end();
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
