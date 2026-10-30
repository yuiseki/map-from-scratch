// Bench-mode helpers for browser renderers. A page imports this file only
// when its URL has ?bench, so none of it counts toward the renderer's
// footprint.
declare global {
  interface Window { __mfsEmit?: (payload: string) => void }
}

export const emit = (o: object): void =>
  window.__mfsEmit ? window.__mfsEmit(JSON.stringify(o)) : console.log('@mfs ' + JSON.stringify(o));

export function glRenderer(gl: WebGL2RenderingContext): string {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

// Runs drawStep(i) for i in [0, steps) back to back and reports, per frame:
//   cpu_ms    time spent in JS issuing the frame
//   frame_ms  issue + wait until the GPU has finished (1-pixel readPixels)
//   gpu_ms    GPU time from EXT_disjoint_timer_query_webgl2, when available
// prefix names a fixed-view run (e.g. "whole_") apart from the main path.
export async function benchFrames(
  gl: WebGL2RenderingContext,
  steps: number,
  drawStep: (i: number) => void,
  { warmup = 10, prefix = '' }: { warmup?: number; prefix?: string } = {},
): Promise<void> {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const px = new Uint8Array(4);
  const cpu: number[] = [], frame: number[] = [], queries: WebGLQuery[] = [];
  for (let i = -warmup; i < steps; i++) {
    const k = ((i % steps) + steps) % steps;
    const q = ext && i >= 0 ? gl.createQuery() : null;
    const t0 = performance.now();
    if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    drawStep(k);
    if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
    const t1 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t2 = performance.now();
    if (i < 0) continue;
    cpu.push(t1 - t0);
    frame.push(t2 - t0);
    if (q) queries.push(q);
  }
  emit({ metric: `${prefix}cpu_ms`, values: cpu });
  emit({ metric: `${prefix}frame_ms`, values: frame });
  if (!ext) return;
  const gpu: number[] = [];
  for (const q of queries) {
    while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await nextFrame();
    if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
  }
  emit({ metric: `${prefix}gpu_ms`, values: gpu });
}

// Where a WebGPU frame writes its two GPU timestamps: drawStep passes
// begin as the timestampWrites of its first pass and end as that of its
// last, so gpu_ms spans every pass of the frame (not commands encoded
// outside a pass, such as clearBuffer).
export interface FrameTimestamps { begin: GPUComputePassTimestampWrites; end: GPUComputePassTimestampWrites }

// benchFrames for WebGPU, reporting the same three numbers per frame:
//   cpu_ms    time spent in JS encoding and submitting the frame
//   frame_ms  that + wait until the queue is done (onSubmittedWorkDone)
//   gpu_ms    end minus begin timestamp, when the device has timestamp-query
// Request the device with 'timestamp-query' to get gpu_ms. Chromium rounds
// the timestamps to 100 us unless it runs with
// --enable-webgpu-developer-features (the harness passes it).
export async function benchFramesGpu(
  device: GPUDevice,
  steps: number,
  drawStep: (i: number, ts?: FrameTimestamps) => void,
  { warmup = 10, prefix = '' }: { warmup?: number; prefix?: string } = {},
): Promise<void> {
  const timed = device.features.has('timestamp-query');
  const querySet = timed ? device.createQuerySet({ type: 'timestamp', count: steps * 2 }) : null;
  const cpu: number[] = [], frame: number[] = [];
  for (let i = -warmup; i < steps; i++) {
    const k = ((i % steps) + steps) % steps;
    const ts = querySet && i >= 0
      ? { begin: { querySet, beginningOfPassWriteIndex: 2 * i }, end: { querySet, endOfPassWriteIndex: 2 * i + 1 } }
      : undefined;
    const t0 = performance.now();
    drawStep(k, ts);
    const t1 = performance.now();
    await device.queue.onSubmittedWorkDone();
    const t2 = performance.now();
    if (i < 0) continue;
    cpu.push(t1 - t0);
    frame.push(t2 - t0);
  }
  emit({ metric: `${prefix}cpu_ms`, values: cpu });
  emit({ metric: `${prefix}frame_ms`, values: frame });
  if (!querySet) return;
  // TypeScript's DOM types have the GPU* interfaces but not the constant
  // objects: QUERY_RESOLVE 0x200, COPY_SRC 0x4, COPY_DST 0x8, MAP_READ 0x1.
  const bytes = steps * 2 * 8;
  const resolve = device.createBuffer({ size: bytes, usage: 0x200 | 0x4 });
  const read = device.createBuffer({ size: bytes, usage: 0x8 | 0x1 });
  const enc = device.createCommandEncoder();
  enc.resolveQuerySet(querySet, 0, steps * 2, resolve, 0);
  enc.copyBufferToBuffer(resolve, 0, read, 0, bytes);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(0x1);   // GPUMapMode.READ
  const t = new BigUint64Array(read.getMappedRange());
  // A frame whose end is not after its begin was not timed (the pass was
  // skipped, or the counter wrapped): leave it out rather than report 0.
  const gpu: number[] = [];
  for (let i = 0; i < steps; i++) if (t[2 * i + 1] > t[2 * i]) gpu.push(Number(t[2 * i + 1] - t[2 * i]) / 1e6);
  read.unmap();
  for (const b of [resolve, read]) b.destroy();
  querySet.destroy();
  emit({ metric: `${prefix}gpu_ms`, values: gpu });
}

// A camera path for 2D maps: zoom in towards a point and back out while
// panning, so every frame differs.
export interface CameraStep { cx: number; cy: number; zoom: number }

export function zoomPath(steps: number, { cx, cy, z0, z1, pan = 0 }: { cx: number; cy: number; z0: number; z1: number; pan?: number }): CameraStep[] {
  return Array.from({ length: steps }, (_, i) => {
    const u = i / (steps - 1);
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    return {
      cx: cx + pan * Math.sin(2 * Math.PI * u),
      cy: cy + pan * 0.5 * Math.sin(4 * Math.PI * u),
      zoom: z0 + (z1 - z0) * w,
    };
  });
}
