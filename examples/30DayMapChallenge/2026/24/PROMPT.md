# Day 24 implementation prompt — Network

Create an original map for **30DayMapChallenge 2026 · 24 Network** from real Tokyo bus-network data. Show the network as an interconnected system of stops and route lines, and make structural differences such as high-degree interchange stops and operator coverage legible without claiming service frequency or current operation.

## Data and interpretation

- Read `yuiseki-open-data` skill/catalog and source cards first. Prefer local KSJ N07 2022 bus-route lines and KSJ P11 2022 bus stops (`hf:ksj-n07-bus-route-greater-tokyo` and `hf:ksj-p11-bus-stop-jp`), using a named, fixed Tokyo-area extent. Confirm formats, CRS, source field semantics, CC BY 4.0 credit, and actual local paths before baking.
- These route data do not include route names or a timetable in the N07 edition. Do not invent route-to-line links, line directions, headways, departures, capacity, or current service. Keep N07 route line features and P11 stop records explicitly distinguishable; connect records topologically only when source keys prove the relation. Record all joins or lack of them.
- Reproject source coordinates correctly from EPSG:6668, inspect geometries and counts under resource limits, and document precise extent, duplicate handling, operators, stops and line segments.
- Attribute the sources as required: `出典「国土数値情報（バスルートデータ）」（国土交通省）を加工して作成` and the corresponding P11 bus-stop dataset credit. State CC BY 4.0 and any processing. Make clear this is a 2022 snapshot rather than a live service map.

## Map and renderer

- Use a purpose-built renderer, not MapLibre, Leaflet, D3 geo, public tiles or other general-purpose map engines. Show the real geographic network with a useful overview and a zoomable detail. Provide visible source-appropriate symbols/lines, scale and coordinate context.
- Provide a way to inspect a stop's original identifier, name, operator, `n_routes` and route list when present. If encoding route connectivity, use those actual source route lists and show an accurate caveat that they are route memberships, not schedules.
- Keep any derived centrality or shared-route links reproducible and visibly distinguish derived connections from source geometry. Include a clear key and keyboard-accessible pan/zoom and selection controls.

## Engineering and evidence

- TDD: begin with failing tests for CRS transformation, source-schema parsing, route/stop relation handling, graph construction (or source-only separation), deduplication, clipping, encoded data and feature inspection. Add browser checks for counts, verified connections, pan/zoom, selection, visible source credits/disclosures, and zero runtime external services.
- Cap all real-data reads, bake, tests and measurements with `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`. Never delete `tmp` files.
- Add `spec.yaml`, `REQUEST.md`, README, deterministic bake/statistics, renderer, browser bench/checks and a screenshot. Run three browser iterations, visually inspect the screenshot, full test suite and all type checks; document measured source/derived counts, compressed footprint and performance.
- Update only Day 24's line in the shared `examples/30DayMapChallenge/2026/TODO.md` after verification. Do not use image generation.
