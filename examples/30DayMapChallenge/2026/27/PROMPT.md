# Day 27 implementation prompt — New tool

Create an original map for **30DayMapChallenge 2026 · 27 New tool**. Learn and use WebGPU as the new mapping tool: build a dedicated renderer that uses a WebGPU compute pipeline for a meaningful spatial operation and WebGPU rendering for the resulting map. Show a real geographic pattern from Japan's 2020 census grid. This is a real-data map; the theme does not require a fictional setting.

## Source and cartographic requirements

- Read `.agents/skills/yuiseki-open-data/SKILL.md` and its catalog entry for `hf:estat-census-mesh-2020-250m`, then inspect the actual dataset card, license, table names, field definitions, codebook and available local files before choosing an area and population measure. Confirm the source data's CRS/mesh convention, record counts, suppression/no-data semantics, exact citation and redistribution terms. Use CC BY 4.0-compatible data and show attribution.
- Select one contiguous, legible, geographically identifiable area with a manageable source subset. Prefer one prefecture or a bounded city-area if the dataset layout supports reliable mesh selection. Do not fabricate geometry or population values. For 250 m mesh codes, construct cell geometry from the documented mesh coding rules and test cell bounds/adjacency; do not infer cells from rounded coordinates.
- Select one clearly defined census population column/age group from a documented source table. Preserve positive values, explicit zeros, suppressed `*`, and absent rows as distinct states; never turn suppression or missing data into zero. Document census date and table meaning.
- Use a cartographic scale suited to a dense residential grid: a readable legend, clear treatment for zero/suppressed/no-row, mesh boundaries or a subtle geographic locator, exact area and a concise caveat that census counts describe the 2020 census grid rather than current population. Avoid framing the visualization as individual-level data.

## WebGPU tool use and renderer

- Implement the map drawing path from scratch with WebGPU; do not use MapLibre, Leaflet, deck.gl, D3 geo, Three.js, Cesium, map tiles, remote APIs or generated imagery. Canvas 2D may be used only for a separately justified accessible overlay, not as a fallback pretending to exercise WebGPU.
- The WebGPU compute pipeline must perform a substantive, testable spatial operation on source-backed mesh features, such as screen-space binning/aggregation for the current view or GPU computation of per-cell projected bounds and display classes. It must affect the rendered output; a no-op compute dispatch or CPU-only preprocessing does not satisfy the theme. Keep the source rows and their provenance intact so the map can inspect real cells.
- Render mesh cells with WebGPU buffers/shaders. Provide pan/zoom, resize handling, selection/inspection of a cell with its mesh code, value/status and source table, and an accessible legend. Handle WebGPU unsupported/adapter/device failure with an honest message; do not silently switch to a different renderer.
- Keep camera initialization centered on the actual selected area. Do not use a fictional map or arbitrary abstract geometry to work around source-data issues.

## Engineering and evidence

- Follow TDD: first add failing tests for mesh-code decoding and geometry, table-field interpretation, zero/suppression/missing-state distinctions, selected-area inclusion, GPU binning/visibility contract and serialization/picking. Implement each to pass; include small synthetic edge cases in tests without treating them as rendered demo data.
- Add a deterministic data bake, sidecar stats, `spec.yaml`, `README.md`, `REQUEST.md`, dedicated WebGPU renderer and benchmark. Record source files/tables/fields, table meaning, selection and bbox, CRS, row and cell counts, codebook/licensing, preprocessing and the compute shader's inputs/outputs.
- Browser checks must prove WebGPU adapter/device initialization, compute output changes when input/camera changes, actual populated map pixels, feature/value/status consistency, pan/zoom/selection, legend and caveats, source attribution, and zero external runtime map/data requests. Capture a screenshot at 1280×800 and visually inspect it. Measure at least three browser runs and report GPU/CPU timing and data/code sizes; disclose unavailable WebGPU, test skips and failed budgets instead of claiming success.
- All real-data processing, bakes, tests, type/build checks, browser checks and benchmarks must run under the repository resource cap: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`. Never delete `tmp`.
- Do not use image generation. Do not update the shared TODO, commit or push. Defer browser benchmarks until the parent confirms that no other browser run is active. Report the exact files, test/benchmark commands and results, screenshot path, remaining issues and the map's data caveats to the parent before the day is called complete.
