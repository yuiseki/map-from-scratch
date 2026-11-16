# 30DayMapChallenge 2026 — Day 20: Hexagons

An interactive WebGL2 globe of Kontur's global H3 resolution-4 population estimates. Drag to rotate, use the wheel or zoom buttons, and click a visible hexagon to inspect its H3 identifier and source value.

Each cell's color and radial column height use a documented logarithmic transform. The height is a visual encoding, not elevation. The source is a coarse ~22 km model-estimate grid, not census counts. The page distinguishes this scale and interpretation and identifies that the frozen release has no zero or missing rows.

Source: [Kontur Population dataset](https://www.kontur.io/datasets/population-dataset/), © Kontur, release 2023-11-01. HDX license metadata says CC BY. See [REQUEST.md](./REQUEST.md) for processing details and [spec.yaml](./spec.yaml) for the camera, scale, budgets, and browser checks.

To bake from the local frozen GeoParquet, run `bin/mfs bake 30DayMapChallenge-2026-20`. The page itself reads only its same-origin baked `kontur.json` file.

Verification: the complete project suite passes (882 passed, 2 skipped). Three capped Chrome 156 / NVIDIA RTX 3060 benchmark iterations passed all nine browser checks and twelve budgets. At 1280×800, first-frame p50 was 857 ms, frame p95 was 1.98 ms, GPU p95 was 1.02 ms, and buffers used 30.23 MB. The screenshot was visually inspected. See [REQUEST.md](./REQUEST.md) and [spec.yaml](./spec.yaml) for full measurements and limits.
