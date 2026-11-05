# Day 19 — Senses: Smell

This page uses the Tokyo 23-ward OpenStreetMap snapshot (2026-08-31) to locate the documented Shibaura Water Reclamation Center, then draws a clearly hypothetical downwind corridor from its mapped site using the JMA Tokyo station's 18:00 JST surface wind observation on 2026-11-04: from north-northwest at 1.9 m/s. The JMA station is about 6 km from the facility, so its observation is regional context, not a measurement at the facility.

The renderer shows a 5 km, linearly widening fan in the direction the wind was blowing. The width (12% of distance plus 250 m at the source) and length are display assumptions chosen for legibility; speed is reported but not used to estimate an odor concentration or arrival time. There is no emission rate, stack height, source temperature, atmospheric stability, turbulence, terrain/building flow, or odor measurement. The fan is therefore a qualitative transport illustration only. The plant is an infrastructure candidate selected from a name-matched OSM polygon and verified against the Tokyo Sewerage Bureau's facility page; neither that page nor OSM establishes that it emitted an odor during this observation.

The Canvas 2D view uses locally baked OSM waterway/road context and the plant outline. It has no map SDK, tile request, image asset, or runtime external dependency. Wind arrow points toward the direction of travel; the observation label retains the meteorological “from” direction.

## Sources and processing

- JMA hourly observations: [Tokyo, 2026-11-04](https://www.data.jma.go.jp/stats/etrn/view/hourly_s1.php?prec_no=44&block_no=47662&year=2026&month=11&day=04&view=). At 18:00 JST the table reports wind direction 北北西 and wind speed 1.9 m/s. JMA station coordinates are 35.69°N, 139.75°E (rounded, JMA ClimatView). JMA states data is available through the previous day, and values can later be revised. The map freezes this single observation.
- Facility: [芝浦水再生センター](https://www.gesui.metro.tokyo.lg.jp/pr/kouhou/shisetsu/44986), Tokyo Metropolitan Government Bureau of Sewerage. The official page identifies it as a wastewater reclamation center and gives its address; OSM geometry provides the mapped outline.
- OSM: [way 23690250](https://www.openstreetmap.org/way/23690250) from the frozen [`osm-tokyo23-src-2026-08`](https://huggingface.co/datasets/yuiseki/osm-tokyo23-src-2026-08) dataset, cut from the 2026-08-31 planet. OSM-derived database is ODbL 1.0. Attribution: © OpenStreetMap contributors. The dataset's source documentation identifies `way` as EPSG:3857 and provides bbox covering.

Attribution: “気象庁ホームページ（東京・2026年11月4日18時の観測）および東京都下水道局「芝浦水再生センター」を参照。OpenStreetMap contributors のデータを加工して作成（ODbL 1.0）。” JMA's published content is used under the Public Data License 1.0 unless otherwise marked; the page is an edited derivative and is not presented as a JMA product.

## Verification and measurements

On 2026-11-05, three capped browser benchmark iterations passed all 12 specification budgets and all 8 browser checks. Frame interval p95 was 2.895 ms, draw CPU p95 2.02 ms, first frame p50 48.615 ms; code gzip was 10,849 B and shipped `smell.json` gzip was 155,812 B. The bake-only `stats.json` sidecar is excluded from runtime data footprint. The screenshot was inspected: both the observation station and facility candidate are visible with the southeast fan, map scale, caveats and attribution. The full repository suite passed 877 tests, skipped 2 environment-dependent Emscripten tests, and all three TypeScript checks passed.
