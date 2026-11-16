# Day 23 implementation prompt — Senses: Taste

Create an original map for **30DayMapChallenge 2026 · 23 Senses: Taste** using real, frozen OpenStreetMap food-place data. Make a compelling map of where food and drink can be found in a named part of Tokyo, using OSM's actual amenity/shop and cuisine tags as the evidence. A map can suggest culinary variety, but it cannot know what a person tastes or whether a place is open or good.

## Data and interpretation

- Read the relevant `yuiseki-open-data` skill/catalog entry and the local data card/license before choosing a source. Prefer `hf:osm-tokyo23-src-2026-08`, the local 2026-08-31 frozen Tokyo 23-ward extract. Use its point/polygon tables as appropriate; inspect the GeoParquet schema and EPSG:3857 metadata. Never call public OSM APIs, tiles, Overpass, or Nominatim.
- Pick a clearly identified extent and reproducible filter. Keep original OSM IDs and only the tags actually present. Record rows by source geometry, mapped amenity/shop class, cuisine availability, records omitted and reason, and any duplicate node/area handling.
- Do not infer restaurant quality, popularity, taste preference, price, opening status, safety, or cultural authenticity from tags. Distinguish OSM's explicit `cuisine` tag from a broader renderer grouping, and show an “unspecified” state rather than guessing.
- Attribute **© OpenStreetMap contributors**, link the copyright page, name the snapshot date, state ODbL 1.0 and share-alike terms for the derived extract, and disclose that community-mapped OSM may be incomplete or stale.

## Map and renderer

- Make this day visually distinct from the other Tokyo OSM maps: the theme is the spatial vocabulary/diversity of food and drink, not a generic road/building basemap. Choose an appropriate map view such as a carefully designed category palette, nested cuisine/category patterns, or an honestly labelled density surface.
- Implement a dedicated from-scratch Canvas 2D or WebGL2 renderer; do not use a general map engine, public basemap tiles, external APIs, or generated imagery. The exact map extent, projection, symbol area and density normalization must be stated and consistent.
- Provide keyboard-accessible category filters and pan/zoom. Selecting a source point/area should show its OSM ID and original relevant tags. Keep labels and source credits readable without covering the core distribution.
- If using a density or hex aggregation, test its aggregation and normalization against exact source features. Do not equate counts with customers or preference. Preserve enough individual context at closer zoom to show the source objects behind the summary.

## Engineering and evidence

- TDD: write failing tests first for tag parsing/classification, duplicate rules, projection/clipping, spatial aggregation if present, geometry encoding/decoding and feature hit testing. Add browser checks for source counts, category toggles, original-tag inspection, pan/zoom, attribution/disclosures and no runtime external requests.
- Resource-cap all real-data reads, bake, tests and measurement with `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`. Do not delete files under `tmp`.
- Add `spec.yaml`, `REQUEST.md`, README, deterministic bake and stats, renderer, browser benchmark/checks and a captured screenshot. Run three benchmark iterations, inspect the screenshot, run the full test suite and all type checks, and record measured source/output counts and performance.
- Update only Day 23's line in `examples/30DayMapChallenge/2026/TODO.md` after verification; coordinate with other agents because the TODO is shared. Do not use image generation.
