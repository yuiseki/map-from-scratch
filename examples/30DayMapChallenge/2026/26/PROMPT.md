# Day 26 implementation prompt — Water

Create an original map for **30DayMapChallenge 2026 · 26 Water**. Make water and its geographic consequences the subject, with a renderer written specifically for this data. This prompt starts from real Japanese flood-inundation data: portray the modeled scenario honestly, and do not present it as an observed flood or a forecast.

## Source and cartographic requirements

- Read `.agents/skills/yuiseki-open-data/SKILL.md`, its catalog section for `ksj/` and `ksj-a31a-flood-tokyo23`, the local dataset card, license, and schema before deciding the exact layer, area and fields. Use only a source with confirmed redistribution terms and cite the MLIT National Land Numerical Information flood inundation dataset (CC BY 4.0) as specified by its source card.
- Use the FY2025 A31a flood-inundation polygons. Prefer the spatially ordered, bbox-bearing `z:ksj/A31a/` partitions when they are a better fit than the unsorted Tokyo23 extract. Select a compact contiguous Tokyo area and disclose its exact geographic bbox; do not imply that selected boundaries equal administrative borders. Verify feature counts, CRS, relevant depth fields/classes, source file categories and actual values from source metadata/data.
- Choose one coherent flood scenario/category and map its documented inundation depth class directly. Do not merge planned-scale, maximum-scale, duration, collapse-flow and erosion layers into an unsupported scenario. Preserve unknown/no-data separately from a measured zero or non-inundated area. Use a legible, ordered depth palette with units/definitions from the source, a visible legend, and explain the river / scenario context.
- Explain that this is a modelled inundation assumption, not a record of actual water, a real-time warning, an address-level guarantee or an individual risk assessment. Link the official data source and show credit/license.

## Renderer and interaction

- Build a dedicated renderer from scratch for this selected source: no MapLibre, Leaflet, D3 geo, generic map engine, map tiles, external API, rasterized/image-generated basemap or generated imagery. Canvas 2D or WebGL2 is appropriate; choose based on measured geometry volume and rendering path. Use only source-supported geometry and properties.
- Let the viewer explore depth classes and inspect at least one polygon's source category, river/manager attributes and raw depth value. Provide useful pan/zoom, coordinate or scale context, and accessible controls. Any contextual boundaries or river labels must have explicit provenance and must not obscure the inundation data.
- Make the opening composition readable at desktop and mobile sizes. Keep the water field central in the map and avoid large blank canvases or controls that conceal the selected extent.

## Engineering and evidence

- TDD: write failing tests for source-field interpretation, geometry/CRS handling, depth ordering, no-data versus zero, clipping, serialization and picking before implementing the corresponding code. Add browser checks for real rendered pixels, scenario/category selection, inspect details, legend and caveats, navigation, attribution/license and zero cross-origin runtime map requests.
- All real-data processing, bakes, tests, build/typecheck, browser checks and benchmarks must run under the repository cap: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`. Never delete `tmp`.
- Add `spec.yaml`, deterministic bake and stats, tests, dedicated renderer, benchmark, README and detailed `REQUEST.md`. Record source paths, source files/categories, bbox, CRS, feature/vertex counts, property definitions, transformation and license. Measure three browser iterations, inspect a captured screenshot and report all failed as well as passing budgets/checks.
- Update only Day26's row in `examples/30DayMapChallenge/2026/TODO.md` after the implementation passes its documented gates. Do not use image generation. Do not modify or commit shared TODO while other agents are working on it; tell the parent when the day is ready for final coordinated verification.
