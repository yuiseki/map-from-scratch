# Day 21 implementation prompt — OpenStreetMap

Create an original map for **30DayMapChallenge 2026 · 21 OpenStreetMap**. Make the frozen OpenStreetMap snapshot the subject: show how a real Tokyo urban area is represented by OSM's tagged streets, railways, buildings, water, parks and public places. The map should read as an authored map of OSM data, not as an OSM tile basemap or a generic showcase of Tokyo.

## Data and scope

- Use the local frozen `hf:osm-tokyo23-src-2026-08` dataset from 2026-08-31, specifically its osm2pgsql GeoParquet point, line, polygon and (where useful) roads tables. Before baking, inspect the schema, source `geo` metadata and local dataset card/license. Do not query public OSM APIs, tiles, Overpass, Nominatim or external map services.
- Select one contiguous, named Tokyo-area extent that contains a legible mix of the source classes. Pick its exact WGS84 and EPSG:3857 bounds after a capped, repeatable source query, and record feature counts by source table and rendered category. Do not claim that the rectangular extract is an official district boundary.
- Keep the map about the actual OSM snapshot and attributes. Preserve representative original geometry and OSM IDs through baking; distinguish source categories from any renderer grouping. Do not invent roads, buildings, land use, population, or completeness.
- Credit **© OpenStreetMap contributors**, link the OSM copyright page, identify the 2026-08-31 snapshot, and state ODbL 1.0 and the share-alike terms for the OSM-derived extract. Explain that OSM is community-mapped and is not a legal survey or a guarantee of completeness.

## Map and renderer

- Build a dedicated from-scratch browser renderer; do not use MapLibre, Leaflet, another map engine, public OSM tiles, or a generated background image. Choose Canvas 2D or WebGL2 based on measured feature volume.
- Make roads, railways, building footprints, water and green/open-space polygons visually distinct through hierarchy, color and geometry, while keeping the actual OSM categories inspectable. Give the reader a useful wide initial view and zoom/pan to inspect detail.
- Add a small, keyboard-accessible layer/category control and a feature inspection interaction that exposes original OSM ID and available OSM tags without fabricating missing tags. Show a scale bar and coordinate readout. Ensure interactions work without a precise pointer gesture.
- Avoid suggesting that every feature in the city is present or that renderer categories are official OSM classifications. Document any simplification, filtering, clipping, or tag grouping.

## Engineering and evidence

- TDD: add failing unit tests before implementation for the projected coordinate transform, clipping/extent handling, feature encoding/decoding, OSM tag classification and hit testing. Add browser checks for real source counts/IDs, category toggles, inspection, pan/zoom, scale bar and attribution.
- All source reads, baking, browser runs, tests and measurements must be resource-capped with the repository's prescribed `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% --` wrapper. Use only local source files for the bake and do not delete any `tmp` files.
- Add `spec.yaml`, `REQUEST.md`, bake script, deterministic baked data and stats, renderer, benchmark/browser checks, and README. Record source version, license/credit, CRS, extent, filter/query, feature and vertex counts, baked bytes, and measured performance.
- Run three browser benchmark iterations, inspect the captured screenshot, run the full test suite and all type checks, and update the Day 21 row in `examples/30DayMapChallenge/2026/TODO.md` only after the evidence supports it.
- Do not use image generation. Produce the cartography from the real OSM data.
