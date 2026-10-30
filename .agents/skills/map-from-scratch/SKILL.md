---
name: map-from-scratch
description: Build the smallest, fastest map renderer for one request ("I want to do X, so make me a map"), almost from scratch, drawing on the map engines collected in ref-repos, and prove it with measurements. Use when someone wants a map front end for a specific purpose, data set, device or performance target, rather than a general-purpose map engine.
argument-hint: "[the request: what the map is for, on what device, with what data]"
---

# /map-from-scratch: a renderer made for one request

A general map engine pays for every feature it might need. A renderer made for
one request pays only for that request. This skill writes such a renderer in
`examples/<nn>-<slug>/` of the map-from-scratch repository, defines it in
`spec.yaml`, measures it with the harness, and keeps changing it until the
numbers say it is small and fast enough for what was asked.

Repository: `~/Workspaces/repos/__yuiseki/map-from-scratch` (below: the repo).
Everything runs in Docker through `bin/mfs`; the host needs only docker and,
for GPU examples, the nvidia container runtime. The repo is GPL-3.0-or-later.

## Rules

- One request, one renderer. Do not grow an earlier example into a shared
  engine. Copy the closest example and cut it down.
- Learn from the engines in `ref-repos/` (MapLibre GL JS and Native, Cesium,
  deck.gl, OpenLayers, QGIS, Mapnik, Organic Maps, ortho-earth and ~40 more;
  `ref-repos/clone.sh` fetches them). Read how they solve the sub-problem in
  front of you, then write only the part this request needs. Code under GPL-3,
  GPL-2.0-or-later, LGPL or a permissive licence may be adapted with a comment
  naming the source file; GPL-2.0-only code (GeoServer, parts of Navit) may be
  read but not copied. Check the repository's own licence files.
- No external dependencies at run time, except earcut (vendored in
  `vendor/earcut`) for polygon triangulation. Platform APIs (Canvas 2D,
  WebGL2, WebGPU, EGL/GLES, X11, libc) are not dependencies. A general engine
  may appear only under `baselines/`, to measure against.
- Do the work at bake time, not at run time: projection, simplification,
  triangulation, draw order, quantisation and compression all happen in
  `bake.ts`. The renderer receives data laid out for exactly what it draws.
- Every requirement becomes a budget in `spec.yaml`, or says why it is not
  measured. The harness refuses a definition that leaves one out.
- Every bench has functional checks, defined in `spec.yaml` and reported by
  id, that read back what reached the screen. Fast numbers from a renderer
  that draws nothing are worthless, and this has happened
  (references/pitfalls.md).

## Procedure

1. **Read the request into `spec.yaml` `requirements`.** Quote the request.
   One requirement per need, in the request's words, each with the number it
   becomes and why (60 Hz → 16.7 ms; "page under 150 KB" → `total_gzip_bytes`).
   Write `architecture_selection.not_doing` before any code: what the renderer
   will not do (3D, tiles, labels, rotation, …) is where most savings come
   from. The format of every section is in references/spec-yaml.md.
2. **Choose runtime and API from the requirements**, not from habit, and
   write the choice and the rejected alternatives in
   `architecture_selection`:

   | When the request says | Start from |
   | --- | --- |
   | embed in a page, tiny, no libraries, a few dozen shapes | Canvas 2D + Path2D (01) |
   | phone browser, pinch, tap to identify | WebGL2, on-demand drawing, id-buffer picking (02) |
   | animate over time, scrub | WebGL2, all data on the GPU, one uniform per frame (03) |
   | millions of points, recount per view | WebGL2 float target + additive blend + GPU reduction (04) |
   | desktop, no browser, instant start | C + EGL + GLES3, instanced segments, program binary cache (05) |
   | microcontroller, no FPU, little RAM | freestanding C, integers, strip rendering, data in flash (06) |
   | thousands of points, hover for a name, whole page size-capped | WebGL2 stencil fill, CPU brute-force hover (07) |

   WebGPU is a valid choice for a renderer, but in this harness headless
   Chromium only gets SwiftShader for WebGPU, so a WebGPU example cannot be
   measured on the GPU here yet. Say so if you choose it.
3. **Design the data structure for the request, too.** The format the data
   arrives in is often the real bottleneck. Decide what the renderer reads
   first and most often (a view, a time step, a zoom level), and lay the
   bytes out so that one or a few HTTP Range requests fetch exactly that:
   index first, then blocks ordered by space (Hilbert, Morton) or time,
   quantised, delta-coded, columnar where it helps. Read the ideas in
   `ref-repos/maplibre__maplibre-tile-spec` (MLT: columnar layout, FastPFOR,
   dictionary and FSST strings, pre-tessellation) and
   `ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/geopbf`
   (GPL-3), and the PMTiles spec. Measure the new structure against reading
   the original format for the same views (bytes, requests, time to first
   frame under `benchmarks.network`), and record both in
   `performance_knowledge`. Bake-time tools: `tools/sources.ts`,
   `tools/geo.ts`, `tools/pmtiles.ts`, the `duckdb` CLI (spatial),
   `ogr2ogr`, `osmium`. Local copies: z.yuiseki.net/static is
   `/sata_hdd_24tb/www/html/static/`, Hugging Face datasets of yuiseki are
   under `/sata_hdd_24tb/hf_data/__published/`.
4. **Look it up in the know-how, then in ref-repos.** For each sub-problem of
   the design (line joins, polygon fill, tile decoding, label placement,
   picking, projection, globe camera), first read the matching know-how skill
   in `.agents/skills/<topic>/SKILL.md`: decisions, trade-offs and reversals
   mined from the issues, pull requests and commit logs of the 48 engines,
   each claim with its source. Topics: 3d-buildings-and-meshes,
   3d-tiles-and-hlod, animation-and-camera, antialiasing-and-blending,
   api-design-and-extensibility, data-range-requests, draw-order-and-depth,
   float-precision, gpu-memory-and-batching, label-placement,
   line-tessellation, mobile-and-power, picking-and-hit-testing,
   point-rendering-and-clustering, polygon-triangulation,
   projection-and-globe, raster-tiles, simplification-and-generalization,
   startup-and-bundle-size, style-and-expressions, symbols-and-icons,
   terrain-and-elevation, testing-and-benchmarking, text-rendering,
   tile-cache-and-loading, tile-lod-and-overzoom, plateau-3d-tiles,
   vector-tile-encoding, visual-review,
   worker-threading; and yuiseki-open-data for the data itself. Then search
   `ref-repos/` (`rg -l` by concept, then read the few files that implement
   it) for the code, and note in `performance_knowledge` or a code comment
   which engine's approach you took or rejected and why.
5. **Scaffold** by copying the closest example to `examples/<nn>-<slug>/`:
   `spec.yaml`, `REQUEST.md` (the narrative: design and what was learnt),
   `bake.ts`, the renderer, and for browser examples `index.html` that loads
   `main.ts`, plus a `bench.ts` that `main.ts` imports only under `?bench`.
   Everything is TypeScript: Node runs it directly, the static server strips
   the types for the browser, and `bin/mfs test` type-checks it with tsc
   (strict, erasable syntax only, `.ts` import specifiers). Count in
   `chosen.code` exactly what a user downloads. Shared bake helpers are in `tools/` (`sources.ts` for raw data,
   converted again when its settings change; `geo.ts` for projections,
   simplification, triangulation, clipping); add to them with tests.
6. **Bake**: `bin/mfs bake <nn>`. Print counts (features, vertices, bytes)
   and look at them: an outlier bounding box or a 10x larger file than
   expected is a bug in the bake, not a fact about the data. Write the steps
   in `datasets.preparation`.
7. **Write the renderer**, smallest first: get one frame on screen, then add
   interaction. Patterns that worked are in references/patterns.md; the
   browser plumbing (DPR-aware ResizeObserver, pointer to device pixels,
   one pending rAF) is easiest to copy from 02 or 07.
8. **Write the bench**: first frame (say exactly when it starts and stops in
   `benchmarks.scenarios`; do not count loading the bench code), a camera
   path (`zoomPath` and `benchFrames` in `harness/page/bench.ts`, or the C
   equivalent), fixed views for the cheap and expensive ends
   (`benchFrames(gl, n, draw, {prefix: 'whole_'})` reports `whole_frame_ms`),
   interaction costs, and every check of `verification.checks` as
   `emit({check: id, pass, detail})`. Report the GPU (`info.gpu`).
9. **Measure**: `bin/mfs bench <nn>`, then look at
   `results/<id>/screenshot.png`. Before believing a number, ask what it
   measures (references/pitfalls.md); note the machine's load, which moves
   time budgets far more than GPU time. Change one thing at a time; for a
   parameter sweep pass it through `MFS_PAGE_QUERY` and compare runs.
   Then open the page in a browser and review it as a user would
   (`.agents/skills/visual-review`): every check can pass on a map that is
   squashed, upside down or missing half the world.
10. **Record** what was learnt in `performance_knowledge` (finding, evidence
   with numbers, when it applies), including dead ends and corrected mistakes.
11. **Optionally compare** with a general engine under `baselines/` (see
   `baselines/b02-maplibre`): same data, same viewport, same camera path.
12. **Commit** when `bin/mfs test` passes and `bin/mfs bench <nn>` passes all
   budgets and checks. `bin/mfs report` prints every example's latest numbers
   for the README.

## Harness reference

- `bin/mfs image | test | list | bake <id> | build <id> | bench <id|all> [-n N] | report | serve [port] | probe [lifetime]`
- `spec.yaml` (references/spec-yaml.md) is read by `harness/lib/spec.ts`;
  the harness takes runtime, page or command, viewport, throttle, iterations,
  bake and build commands, shipped files, budgets and check ids from it.
- Renderers report with one JSON object per line prefixed `@mfs `
  (native: stdout; browser: `window.__mfsEmit`): `{"metric":name,"value":x}`,
  `{"metric":name,"values":[…]}`, `{"mark":name}` (native; timed from fork),
  `{"check":id,"pass":bool,"detail":…}`, `{"info":{…}}`, `{"error":msg}`,
  `{"done":true}`.
- Results go to `results/<id>/` (latest.json with budgets and checks,
  timestamped runs, screenshot, chrome.log). They are not committed.
- Browser examples are published on GitHub Pages
  (https://yuiseki.github.io/map-from-scratch/) by `tools/deploy-pages.sh`,
  which builds the site (`tools/build-site.ts`), checks every page on it
  (`bin/mfs bench <id> --site`) and pushes `gh-pages`. Pages must work as
  plain static files with relative paths (no COOP/COEP there), and every
  data file must stay under 100 MB.
