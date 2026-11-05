# Day 14 — Borgesian map

## Request and interpretation

Create a map for the official 2026 theme, “A map so detailed it becomes the territory. Inspired by Borges' On Exactitude in Science.” The artwork uses real OpenStreetMap building polygons around Shibuya Station and makes physical scale part of the map. It contains a 500 m projected overview and a movable detail viewport. A reader adjusts an on-screen 85.60 mm reference to the width of a physical payment card, confirms that calibration, and can then open a local ground-scale 1:1 view.

The 1:1 claim is conditional and local. Browser CSS pixels have no fixed physical size across displays, operating-system scaling, browser zoom and remote desktops. The page starts with unknown physical scale and disables the 1:1 control until a person calibrates this display. The window is placed inside OSM relation 904652357. At latitude 35.65854°, the renderer multiplies CSS pixels/mm by 1,000 and by cos(latitude) to compensate for local Web Mercator scale. This correction is local: Earth curvature, projection variation and OSM positional accuracy prevent a claim of globally exact ground correspondence.

At literal scale, a monitor can show only a few decimetres of territory. That constraint is the point of the piece. The overview remains available for navigation; its detail-window indicator is enlarged to at least 3 CSS pixels. Panning beyond the fixed extract shows blank background. The data extract is a rectangle, not an administrative boundary.

## Data and terms

- Frozen OSM Tokyo 23-ward extract dated 2026-08-31: `hf:osm-tokyo23-src-2026-08`, polygon table in GeoParquet 1.1, EPSG:3857, ODbL 1.0. No public OSM API or tile server is queried.
- Query window: WGS 84 longitude 139.6993542117395–139.7038457881601°, latitude 35.6576752828918–35.66132466989101°. EPSG:3857 x=15,551,260.975–15,551,760.975 m and y=4,253,619.680–4,254,119.680 m.
- 337 polygon rows intersect the window; 222 carry `building` tags and are rendered. They have 222 distinct OSM ids, 223 rings and 1,698 original vertices. Tag counts: `yes` 182, `retail` 22, `roof` 5, `commercial` 4, `office` 3, `train_station` 3, `bridge` 1, `apartments` 1, `college` 1.
- Full source rings are retained. Differential coordinates relative to the EPSG:3857 window origin are encoded as float32; baked and decoded absolute coordinates remain float64. This preserves sub-millimetre detail at Tokyo's large projected coordinates.
- Attribution: `© OpenStreetMap contributors`. Data is available under the [Open Database License 1.0](https://www.openstreetmap.org/copyright). This processed OSM-derived extract is distributed under ODbL terms. Source tags are grouped into seven display classes; source counts remain in `stats.json`.
- The extract boundary is not official. OSM building footprints are volunteered geographic information, not cadastral or survey records. No image basemap, artificial land geometry, addresses or other polygon layer is added.

## Implementation and verification

- `PROMPT.md` records the text-first creation prompt. No image generation is used.
- `territory.ts` implements calibration, local ground-scale correction, camera transform, bbox intersection and the BRG1 binary codec.
- `bake.ts` reads the local frozen GeoParquet, selects bbox-intersecting tagged buildings, parses Polygon/MultiPolygon WKB, retains source vertices and writes `buildings.bin` and measured `stats.json`.
- `renderer.ts` creates Path2D objects and draws a custom Canvas 2D overview/detail map with hit testing, clipping and pointer/keyboard navigation.
- `index.html` and `main.ts` provide calibration and view controls, attribution, caveats, selection links, the prompt and scale indicator.
- `bench.ts` checks source geometry, scale calibration, visible disclosures and keyboard controls; it measures first render, frame interval and draw CPU time.

Tests cover calibration, latitude correction, transforms, zoom anchoring, bbox intersection, high-coordinate/small-delta precision, binary round-trip and malformed data. Browser checks exercise the known OSM relation, the scale formula, and arrow/Enter behavior on both canvases.

Verification on 2026-11-05: the 3-run Chrome/Xvfb bench passed all seven budgets and all seven browser checks. It measured 222 buildings / 1,698 vertices, first-frame samples 49.575 / 53.865 / 47.230 ms (p50 49.575 ms), frame p95 0.725 ms, draw CPU p95 0.265 ms, 12,636 B gzipped code and 12,461 B gzipped data. The overview scale bar explicitly identifies its 50 m as EPSG:3857 projected distance. The bench screenshot (`results/30DayMapChallenge-2026-14/screenshot.png`) was opened and visually inspected; the overview, controls, attribution and caveats render as intended. Full repository tests and Node, browser and test TypeScript checks passed.

2026-11-06: the building-pixel check now uses `readBack()` to inspect an OffscreenCanvas copy. The previous frame and draw timings are historical; rerun the three browser iterations before treating them as the current performance baseline.
