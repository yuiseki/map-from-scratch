# 30DayMapChallenge 2026 · Day 16: Collaborative map

OpenStreetMapに記録された渋谷の建物編集を、2025年の月ごとに累積する地図です。約38 × 46 mのセルで集計し、どの場所にどの種類の変更記録が集まったかを見られます。地物の形を再描画する代わりに、履歴の活動密度そのものを地図の主題にしています。

## Data and processing

- Source: [ohsome API v1 contributions extraction](https://docs.ohsome.org/ohsome-api/development/endpoints.html), route `/contributions/centroid`.
- Query: WGS84 bbox `139.696,35.650,139.706,35.660`; `2025-01-01` through `2026-01-01`; `building=*`; clipped geometries and contribution types only. The API reported version 1.10.4. The bounded annual response was 52,781 bytes with 162 features.
- The local browser data has 152 features with point geometry; 10 deletion records had no returned geometry and were not placed. The remaining records were grouped into a 24 × 24 regular grid and calendar months. Thirteen features had no contribution type flag and are counted as “その他”; five features had both geometry and tag change flags, so category counts may overlap while the total remains one contribution per feature.
- The bake strips OSM element IDs, changeset IDs, object tags, and all person-related metadata. It stores only cell coordinates, monthly counters, and aggregate provenance. No public OSM tile, Nominatim, or Overpass service is used at runtime.
- The grid origin and cell marks describe returned centroids at coarse scale, not the exact ground footprint of an edit. The API does not provide enough information here to distinguish individual contributors or manual and automated edits. Counts are not unique people and do not measure map quality.

To rebake, run `node examples/30DayMapChallenge/2026/16/bake.ts`. It makes one bounded API request and aborts if the response exceeds 1 MB or 60 seconds. A previously captured response can be passed as a first argument for offline rebaking.

## Renderer and interaction

The example uses a dedicated Canvas 2D renderer with a local ground-distance projection. The native month slider and previous/next controls update a cumulative map; the small bar timeline also selects a month. Selecting a grid cell reports its aggregate contribution types. Arrow keys move the focused map selection. The map and data load from the static site bundle without a mapping framework.

## Attribution and license

Data: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), accessed through [ohsome](https://ohsome.org/). OSM data is licensed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The OSM-derived aggregate database is published under ODbL 1.0; share-alike terms apply to derivative databases. This rendering is an independent, unofficial work and is not endorsed by OSM or HeiGIT.
