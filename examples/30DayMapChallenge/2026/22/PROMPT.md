# Day 22 implementation prompt — Projections

Create an original map for **30DayMapChallenge 2026 · 22 Projections**. Let the reader see how a projection changes the appearance of the same world: switch between at least four named, mathematically distinct global projections while keeping the source countries, viewport, scale reference and styling consistent. Make distortion legible and explain that no flat map preserves every property of the globe.

## Data and cartography

- Use the locally available Natural Earth countries layer at a documented scale/version. Read the catalog entry and source metadata before baking. Natural Earth is public domain. Record the exact local path, feature count, geometry types, coordinate system, source version and any geometry processing.
- Preserve the same source country geometry for every view. Do not compare different resolutions or datasets between projections. Draw an unmistakable graticule and equator, and provide a scale/distortion cue (for example, an equal-area reference or a latitude distortion indicator) whose meaning is correct for each selected projection.
- Include at least: equirectangular, Mercator, Equal Earth, and one of Robinson or Winkel Tripel. Implement projection math directly in the dedicated renderer; no MapLibre, D3 geo, proj4, Leaflet, other rendering engines, map tiles, external APIs, or generated imagery.
- Handle antimeridian edges and projection domains without drawing spurious world-spanning segments or infinities. State clipping/domain behavior, especially Mercator's latitude limit. Label each projection and describe its preserved property / characteristic distortion without implying one is universally best.
- Keep the visual composition strong and usable: keyboard-accessible projection selection, a clear opening view, responsive redraw and concise explanatory labels. A small side-by-side comparison or an animated transition is welcome only if it preserves the same scale/data comparison and remains understandable.

## Engineering and evidence

- TDD: first add failing unit tests for each projection's key invariants (origin/equator, symmetry, known points or preserved property), antimeridian handling, finite output/domain clipping and screen transform. Add browser checks for projection switching, recognizable continents, graticule, consistent source count, explanatory labels and no runtime network dependencies.
- Source reads, baking, browser runs, tests and measurements must use the repository resource cap: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`. Keep all work reproducible and never delete `tmp` files.
- Add `spec.yaml`, `REQUEST.md`, deterministic baked geometry and stats, dedicated renderer, benchmark/browser checks and README. Record the projection formulas and sources of constants. Measure three browser iterations and capture a screenshot; inspect it. Run the full test suite and every type check.
- Update only Day 22's row in `examples/30DayMapChallenge/2026/TODO.md` with evidence-backed status and measurements after verification. Do not use image generation.
