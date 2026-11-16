# Request and implementation notes

Recreate the 30DayMapChallenge 2026 Day 21 **OpenStreetMap** theme as an authored map of real OSM content. Keep the frozen local dataset itself central: show streets, railways, building footprints, water, green/open spaces and public-place tags; preserve source identity and tags; make the map navigable and inspectable; disclose its source, snapshot, license, and coverage limits. Do not use OSM tiles, external map services, image generation, or a generic map engine.

## Scope and source

The input is `hf:osm-tokyo23-src-2026-08`, a local snapshot dated 2026-08-31. Its four GeoParquet tables use EPSG:3857 geometry. The chosen contiguous Shibuya–Yoyogi rectangle is WGS84 139.685–139.715°E and 35.650–35.675°N; in EPSG:3857 it is x=15549663.07145842..15553002.656182218 and y=4252568.169330002..4255993.530861105. It is not an official district outline.

The selected extract has 19,948 source rows and 105,147 vertices: `planet_osm_roads` 543, `planet_osm_line` 27, `planet_osm_polygon` 15,257, and `planet_osm_point` 4,121. Rendered category counts are road 355, railway 188, water 44, building 14,958, green 282, and public-place 4,121. Rows preserve their source table, signed `osm_id`, selected source tag columns, and extended tags. The bake filters point rows to public-place tags; roads to highway or railway; lines to waterway; and polygons to building, water or green/open-space tags. It clips line/polygon geometry to the chosen rectangle and simplifies polygons at 0.4 m and lines at 1.2 m. The two-row difference between polygon rows and unique IDs comes from duplicate relation geometry rows in the source; rows are retained rather than silently merged.

## Renderer

Canvas 2D was chosen because this compact fixed extent has 19,948 features and 105,147 vertices, and direct path drawing keeps hit-testing and display geometry aligned. Projected bounds are precomputed and category draw order is fixed at load time; each redraw only checks enabled category and viewport overlap. Polygon rings remain grouped per polygon component so holes use even-odd filling and disjoint multipolygon islands remain individually selectable. The renderer avoids runtime map/data services and exposes source tags rather than inventing absent properties.

## Verification status

Unit tests cover projection, clipping, binary encoding, classification, hit testing, holes and multipolygon islands. The browser harness validates pixel output and interactions against the baked source. After an initial viewport-only redraw measured 186.7 ms draw CPU p95, the renderer added a spatial index and six category Canvas caches. The capped three-run benchmark now passes all seven budgets and seven checks: draw CPU p95 0.14 ms, frame p95 1.295 ms, first frame p50 365.545 ms, code gzip 15,340 B, data gzip 1,490,000 B. The 1280×800 screenshot was visually reviewed.
