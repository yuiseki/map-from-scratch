# Day 21 — OpenStreetMap

The map renders a local, frozen 2026-08-31 OpenStreetMap extract around Shibuya and Yoyogi using a purpose-built Canvas 2D renderer. It draws six data-derived categories and lets you inspect source table, OSM object ID, and available tags. Use the checkboxes to toggle categories; drag and wheel to navigate; focus the map and use arrow keys, `+`/`-`, and `[`/`]` for keyboard navigation and feature inspection.

The source is the local `hf:osm-tokyo23-src-2026-08` osm2pgsql GeoParquet dataset (EPSG:3857, GeoParquet 1.1.0), distributed under ODbL 1.0. This extract contains **19,948 selected rows**, **105,147 vertices**, and a **3,617,535-byte** baked payload. Selected rows by source table: roads 543, line 27, polygon 15,257, point 4,121. Rendered features: roads 355, railways 188, water 44, buildings 14,958, green spaces 282, public places 4,121. Two polygon rows can share a relation ID because the source table may contain multiple geometries for one relation.

The selected Shibuya–Yoyogi extent is a repeatable rectangle, not an administrative boundary: WGS84 139.685–139.715°E, 35.650–35.675°N; EPSG:3857 x=15549663.07145842..15553002.656182218, y=4252568.169330002..4255993.530861105. Lines and polygons are clipped to that rectangle; polygons are topology-preserving simplified by 0.4 m and lines by 1.2 m. The point table is filtered to public-place tags; roads to highway/railway tags; line features to waterways; polygons to buildings, water and green/open-space tags. Renderer categories are explanatory groupings, not official OSM taxonomies.

**© OpenStreetMap contributors** · [Copyright and license](https://www.openstreetmap.org/copyright). The OSM-derived extract is subject to ODbL 1.0 and its share-alike terms. OSM is community-mapped data, not a legal survey, and this filtered rectangle does not guarantee completeness.

`osm.test.ts` の9件が通過しています。カテゴリ別Canvasキャッシュにより再描画を合成中心にし、キャッシュ生成と選択候補には空間インデックスを使います。3回のブラウザ計測は7/7予算・7/7チェックに合格しました。draw CPU p95 0.14ms、frame p95 1.295ms、初回frame p50 365.545ms。1280×800の画面を確認済みです。
