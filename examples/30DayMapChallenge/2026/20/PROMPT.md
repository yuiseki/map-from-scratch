# Day 20 implementation prompt — Hexagons

Create an original, from-scratch map for 30DayMapChallenge 2026 Day 20, “Hexagons”. Make a global, interactive 3D population globe from Kontur's actual H3 resolution-4 population grid. Each native hexagonal cell should remain geographically recognizable and encode its population in a clear, legible way.

## Data and representation

- Before implementation, read `.agents/skills/yuiseki-open-data/SKILL.md`, its `hf:kontur-population-2023-11-01-22km` catalog entry, the dataset's own README/metadata, and the relevant map-from-scratch / WebGL / polygon-rendering skills. Verify field meanings, geometry/CRS, cell count, population total, data revision, license, and attribution from primary metadata. Record any discrepancies rather than copying catalog estimates blindly.
- Use the local Kontur resolution-4 GeoParquet snapshot (catalog: 71,283 cells, about 3.5 MB, EPSG:3857 hexagon polygons, CC BY). Bake a compact representation for the browser; do not load Parquet, DuckDB, or a general map SDK at runtime.
- Use a dedicated WebGL2 renderer to draw the global H3 cells on a rotatable globe. Preserve cell boundaries and handle the antimeridian/polar geometry without drawing world-spanning chords. A cell's color and radial height may encode a documented monotonic transform of its population; include an explicit legend and state that values are estimates from the dataset, not a census count. Keep zero/missing semantics distinct if both occur.
- Every map view, color transform, extrusion scale, camera choice, clipping rule, and population measure must be documented in `REQUEST.md` and `spec.yaml`. Do not imply precision unsupported by the dataset's ~22 km resolution.

## Engineering and verification

- Begin with tests for projected/longitude-latitude decoding, globe vertex projection, antimeridian handling, population color/height monotonicity, and malformed records. Demonstrate the relevant tests fail before implementation.
- Use a batched, allocation-conscious GPU path for the cells. Provide pointer drag to rotate, wheel/buttons to zoom, a visible scale/context, and a cell inspection interaction that reports the original grid value.
- Add `spec.yaml`, `REQUEST.md`, bake script, compact baked data and stats, WebGL2 renderer, browser benchmark/checks, and update Day 20 in `examples/30DayMapChallenge/2026/TODO.md`. Include source attribution and CC BY terms on the page.
- Run the full test/type-check suite and at least three capped browser benchmark iterations. Verify actual rendered pixels (including representative low/high population cells and globe silhouette), inspect the screenshot, and retain the measurements. Do not relax budgets to hide a miss.
- Keep the page independent of runtime map services. Verify no external runtime requests.
- Every command that reads, queries, transforms, bakes, tests, or benchmarks real data must use:
  `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`.
- Leave commit and push to the parent agent.
