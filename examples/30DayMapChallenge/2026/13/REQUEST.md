# Day 13 — Interactions

## Request

Create an interactive map for Day 13 of 30DayMapChallenge 2026. The official prompt is “Interactions between things, or maybe the result would be an interactive map?” This example uses the second reading: explore how a municipality's monthly average presence is divided by the published residence-area categories.

## Map brief

Draw Japanese municipality destinations from the Ministry of Land, Infrastructure, Transport and Tourism (MLIT) 全国の人流オープンデータ. A selected municipality shows four aggregate bins: people whose home is in the same municipality, another municipality in the same prefecture, another prefecture in the same regional block, or another block. The reader can change month, weekday/holiday/all days, and daytime/late night/all day.

The source has no origin municipality and no individual trajectory. The map therefore does not draw geographic origin-to-destination lines. Municipality point locations are averages of the source's 1 km mesh centers, so they are approximate marks rather than official municipality centroids. Values under 10 are suppressed; a missing category is not zero. The counts are aggregated monthly average presence derived from mobile-device location data, not unique people or trip counts.

## Data and attribution

- MLIT 全国の人流オープンデータ, 2019-01–2021-12 monthly snapshot. The local source README documents the source table's fields, 10-person suppression and the meaning of `from_area`.
- CC BY 4.0 under the Government of Japan Standard Terms of Use 2.0.
- Required credit: `出典：「全国の人流オープンデータ」（国土交通省）（https://www.geospatial.jp/ckan/dataset/mlit-1km-fromto）を加工して作成`
- Modification: group by year, month, day type, time of day, destination municipality and broad residence-area category; add approximate destination point locations from means of 1 km mesh centers.
- Natural Earth v5.1.1 Japan prefecture outlines are public domain.

The display is an independent processed visualization, not an MLIT publication or endorsement.

## Implementation and verification

- `PROMPT.md` records the creation brief and interpretation limits.
- `mobility.ts` defines and validates the compact MFR1 month-frame format; `mobility.test.ts` covers day/time/category indexing, normalization and binary round-trip.
- `bake.ts` groups the local source snapshot and generates 36 individually compressed month frames plus municipality and prefecture assets. Each month is loaded on demand; municipality codes without a matching 2020 mesh-centre position are excluded from the plotted list.
- `renderer.ts` draws the national map with Canvas 2D and implements hit testing, panning and zooming.
- `main.ts` connects keyboard-accessible native controls to month, day type, time of day and municipality selection.
- `bench.ts` verifies nationwide coverage, a known Tokyo municipality, rendered pixels, visible disclosure and interaction, and records navigation costs, per-month load times and initial-view transfer size.

## Results

- Bake: 1,896 municipalities with mesh-centre locations, 47 Natural Earth prefecture features, 614,196 grouped municipality/month/day/time records. 120 groups have no matching 2020 mesh-centre location and are omitted. Raw compressed month frames total 5,648,905 B; largest is 160,400 B.
- Three Chrome 156 / Xvfb runs at 1280×800: first frame 100.095 / 121.220 / 118.085 ms (p50 118.085 ms); frame p95 6.90 ms; Canvas draw CPU p95 5.615 ms; month switch p95 14.365 ms across 108 changes (max 44.85 ms); active initial chunk 157,015 B. All budget checks and browser checks passed. Site-shipped data footprint (recompressed files individually) is 5,799,208 B; code gzip is 8,443 B.
- Full test suite: 848 tests, 846 passed, 0 failed, 2 skipped. Node, web and test TypeScript checks passed.
- The screenshot was opened and reviewed: [/Workspaces/repos/__yuiseki/map-from-scratch-30day-2026/results/30DayMapChallenge-2026-13/screenshot.png](/Workspaces/repos/__yuiseki/map-from-scratch-30day-2026/results/30DayMapChallenge-2026-13/screenshot.png). The national extent, selected Taito-ku point, category breakdown, controls and caveats are legible.
- Bake and browser benchmark commands ran under a user systemd scope capped at MemoryMax=8G, MemorySwapMax=0, CPUQuota=400%.
