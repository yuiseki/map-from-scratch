# Day 19 implementation prompt — Senses: Smell

Create an original, from-scratch map for 30DayMapChallenge 2026 Day 19, “Senses: Smell”. The map should let a reader explore how an odor plume could travel from a documented source under a documented wind observation, while making clear that the plume is a simplified estimate and not a measurement of odor or exposure.

## Data and honest interpretation

- Before choosing data, read `.agents/skills/yuiseki-open-data/SKILL.md`, the relevant entries in its catalog, and the repository map-from-scratch skill. Verify candidate source files, metadata, licenses, attribution, geometry/CRS, and time coverage from primary documentation.
- Prefer a bounded Tokyo study area with real, traceable industrial/odor-source candidates (for example, explicitly tagged OSM facilities) and real, time-stamped wind observations from a documented meteorological station or an authoritative gridded dataset. Do not invent facility locations or observed weather. If a reliable wind dataset cannot be used, stop and report the evidence and best next data option instead of fabricating it.
- Render the source locations/areas and a plume oriented by the observed wind. State the selected observation time, wind direction and speed, source-selection rule, and every modeling assumption on the page and in `REQUEST.md`/`spec.yaml`.
- Treat the plume as a qualitative transport illustration unless a scientifically defensible dispersion model and all required inputs can be established. Do not label modeled pixels as measured odor concentration, exposure, health risk, or a regulatory exceedance. Do not imply every OSM industrial object emits odor.
- Include license/attribution and links to original sources. Respect ODbL/share-alike for OSM-derived data. Keep the AOI small enough that the phenomenon is legible.

## Map and engineering requirements

- Make a dedicated, dependency-free renderer; do not use a general-purpose map engine or external map tiles at runtime. Choose Canvas 2D, WebGL2, or WebGPU based on a measured workload.
- Begin with tests for wind-vector orientation, plume construction/bounds, and source/data decoding. Confirm the tests fail before implementing the corresponding behavior.
- Make direction and uncertainty legible: show wind provenance, origin(s), plume axis, extent/decay assumptions, and a clear legend. Add useful interaction such as selecting a source or changing the wind scenario only when supported by actual data.
- Add `spec.yaml`, `REQUEST.md`, bake script, compact reproducible baked data, browser benchmark and checks, and update the Day 19 row in `examples/30DayMapChallenge/2026/TODO.md`.
- Run relevant and full tests/type checks, at least three capped browser benchmark runs, inspect actual rendered pixels and screenshot, and document all budgets including misses. Do not relax budgets merely to make them pass.
- Every command that reads, queries, transforms, bakes, tests, or benchmarks real data must be wrapped with:
  `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`.
- Leave commit and push to the parent agent for review.
