# Measurements that lied, and how they were caught

Every item here happened while building the examples. Each one produced
plausible numbers. Suspect the measurement before the renderer.

## The environment

- **A browser flag crashed the GPU process.** With `--enable-features=...,VulkanFromANGLE`
  headless Chromium lost every GPU context about 300 ms after launch. Picking
  returned 0 everywhere (02) and a 2D canvas lost its transform (01). The
  harness now uses a minimal flag set, warms up until a WebGL context survives
  one second, and records `warmup_attempts`. `bin/mfs probe lifetime` checks
  context lifetime directly.
- **Environment variables did not reach the container.** For a while
  `MFS_CHROME_FLAGS` was not passed through `bin/mfs`, so a series of flag
  experiments all ran with the defaults and "no flag made a difference".
  When an experiment varies a setting, confirm the setting arrived (the
  results now record `page_query`).
- **WebGPU on SwiftShader.** Headless Chromium offers a WebGPU adapter in
  the container, but it is SwiftShader. Any WebGPU number from it is a CPU
  number. The harness fails a `gpu: hardware` example whose `info.gpu` names
  a software rasteriser. Headed on a private Xvfb (`benchmarks.display: xvfb`
  or `MFS_DISPLAY=xvfb`) the same container gets the NVIDIA adapter, with
  timestamp-query and subgroups; WebGL2 stays on ANGLE Vulkan with the same
  numbers as headless (04: gpu_ms p50 0.77 ms either way).
- **Timing a WebGPU frame.** Time the frame with timestamp queries
  (`benchFramesGpu`), not around `queue.submit`: submit returns before the
  GPU starts (webgpu-003 reported 0.21 ms that way, on SwiftShader). Draw the
  timed frames into an offscreen texture: awaiting `onSubmittedWorkDone`
  yields the task, so a canvas texture is presented between frames, and on
  Xvfb that cost 81 ms a frame against 2.3 ms offscreen. WebGL2's
  `benchFrames` never yields, so it never presents either. Even offscreen
  the await has a floor of about 2.3 ms with 0.05 ms of GPU work: compare
  WebGPU with WebGL2 by gpu_ms, and read frame_ms as including that wait.
- **Timer resolution.** Without cross-origin isolation `performance.now()`
  is coarsened to 100 us. The static server sends COOP/COEP so it is 5 us.

## The measurement method

- **Measuring the read-back, not the drawing.** Syncing a Canvas 2D frame
  with `getImageData` made "redraw" 14 ms; recording the draw calls took
  0.02 ms. Canvas 2D work happens at composite time: measure the frame
  interval of rAF instead, against an idle page (01).
- **A percentile that hides the worst view.** A camera path's p95 (5.2 ms)
  hid that the all-in-view frame cost 11.7 ms (04). Bench the cheap and the
  expensive ends as fixed views with their own budgets.
- **Name collisions between metrics.** The native runner's process CPU time
  was also called `cpu_ms` and mixed five 1,000 ms values into the per-frame
  CPU times (05). It is now `process_cpu_ms`.
- **Reading a rounded table.** `193200` in the summary was 193,170 rounded to
  four digits; it looked like a counter that never changed (06). Read
  `latest.json` before concluding.
- **Host time is not device time.** For a microcontroller, report the work
  (segments drawn, pixels written, roads tested) next to host time; only the
  work carries over (06).
- **First launch is not every launch.** With a program binary cache, the
  first start costs 183 ms and 166 MB, the next ones 107 ms and 124 MB (05).
  Make the bench include a cold start and say which statistic each budget is
  on.

## The renderer drew nothing

- **An incomplete texture returns zeros.** R32F is not filterable; with the
  default filters the texture is incomplete and every `texelFetch` gives 0.
  The count check passed because it read the count framebuffer directly; the
  screen was black (04). Check what reaches the screen.
- **A hand-picked coordinate missed the road.** A functional check placed at
  "where Route 3 should be" read the background; the renderer was right.
  Take check locations from the baked data itself (05, 06).
- **Conclusions measured under broken conditions survive the fix.** After the
  flag fix, three earlier findings had to be re-measured: the CPU canvas was
  slower, not safer (01); incremental repaint was not needed (01); a GPU-time
  difference between vertex layouts disappeared (02). Re-run what was
  measured under the broken setting and correct REQUEST.md.

## Found by an agent working from this skill alone (example 07)

- **The first locale call is slow.** The first `toLocaleString('ja-JP')`
  initialises ICU: 34 ms once, 0.17 ms after. It showed up as one outlier in
  every hover run. Format numbers with a regular expression where a
  response must be immediate.
- **A tight colour check fails in dense areas.** "The city centre is orange"
  failed for 536 of 7,342 cities because a neighbour's white outline covered
  the centre; the drawing was right. Test for "not land and not sea" and
  record the strict ratio as information.
- **Load moves time budgets, not GPU time.** With a load average of 124 the
  first frame p50 was 174 ms, at 72 it was 76 ms; gpu_ms stayed at 1.2–1.7 ms.
  Re-measure time budgets on a quiet machine before concluding.
