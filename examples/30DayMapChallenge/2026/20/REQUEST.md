# Day 20 — Hexagons

## Request and design

Show Kontur's global H3 resolution-4 population grid as a rotatable 3D globe. Keep the source hexagonal cells geographically recognizable and let the viewer read a selected cell's H3 key and original population estimate. Use the frozen 2023-11-01 release: its date labels the dataset revision, not a census date.

The renderer starts from Kontur's GeoParquet cell polygons in EPSG:3857, converts their vertices to WGS 84 longitude/latitude at bake time, then maps each vertex to a unit sphere. The source contains 71,283 unique cells: 71,265 Polygon and 18 MultiPolygon records. Those 18 antimeridian pieces stay split in the baked output, so no polygon edge crosses the world as a long chord. The source has no polygon holes. Coordinates are rounded to 0.00001 degree (about a metre at the equator), well below the spatial resolution of the ~22 km H3 cells.

One WebGL2 vertex/index batch contains the hex tops and radial side walls. The globe's ocean sphere writes a depth surface first; the depth buffer hides cells on the far side. Drag rotates east/right and north/up, the wheel and buttons change zoom, and clicking a visible cell reports its H3 ID and unmodified estimate. There is no base map, external map SDK, tile endpoint, runtime data service, or third-party runtime dependency.

## Encodings and limits

For a non-negative population `p`, the shared intensity is `t = clamp(log(1+p) / log(1+22,732,635), 0, 1)`. Color interpolates from RGB (50,118,153) to (255,218,136); the explicit zero color (29,43,55) is reserved but is not present in this snapshot. Radial vertex radius is `1.002 + 0.021*t` Earth radii above a unit sphere. This radial height is a visual population encoding, not physical elevation. It exaggerates the population pattern for readability and does not mean a person or building is located at the top of the column.

Kontur describes the values as estimated population. The grid has no age breakdown and the ~22 km cells do not support neighborhood-scale or individual-location claims. In this frozen release all 71,283 rows have a positive value, so zero and missing values are both absent; the page says so rather than inventing a zero/missing cell. No cells are filled north or south of the source's Web Mercator coverage (~85.06°).

The camera uses an orthographic sphere projection. The fixed opening view centers approximately on 15°E, 15°N; rotation is free except that pitch is clamped at ±84.8° to avoid pole-flip instability. The disk scale is 0.415 of the shorter CSS viewport dimension at zoom 1, with zoom bounded from 0.72 to 1.5. Cells whose centers are on the far hemisphere are not selectable; click picking searches the nearest front-side cell center in screen space, including its radial population height. These choices are for an overview globe, not street-level navigation or geodetic measurement.

## Source, attribution, and processing

- [Kontur Population dataset](https://www.kontur.io/datasets/population-dataset/), global 22 km H3 grid, release 2023-11-01. Attribution: **Kontur Population dataset © Kontur**.
- [HDX dataset record](https://data.humdata.org/dataset/kontur-population-dataset-22km) identifies the license as Creative Commons Attribution International (`cc-by`), linked to the [CC BY license record](https://www.opendefinition.org/licenses/cc-by).
- Frozen local source: `kontur_population_20231101_r4.parquet`, a GeoParquet conversion of the source GeoPackage. Every source row and population value is retained. Outer rings are transformed from EPSG:3857 to longitude/latitude and rounded to five decimal places. MultiPolygon parts remain separate. This is an edited derivative, not an official Kontur product.

The snapshot check finds 71,283 rows and distinct H3 IDs; population sum 8,031,924,024; minimum 1; maximum 22,732,635; 0 zero rows and 0 null rows. These are a sum and range of model estimates, not an asserted census total.

## Verification record

The authored tests cover Web Mercator decoding, globe vertex placement, antimeridian-neighbor continuity, population color/radial monotonicity, and malformed source records. The browser benchmark checks the pinned source totals, actual globe and representative low/high population pixels, geographic orientation (Cairo east and north of Dakar), interaction, credits/disclosures, and that runtime requests stay same-origin. Three capped browser iterations on Chrome 156 / ANGLE NVIDIA GeForce RTX 3060 passed all nine checks and all twelve budgets (2026-11-05): first-frame p50 857 ms, CPU frame p95 0.060 ms, total frame p95 1.980 ms, GPU p95 1.020 ms, GPU buffers 30,229,040 B, and compressed baked data 2,668,475 B. The opening-view screenshot was visually inspected at 1280×800 and shows the sphere, front-side H3 cells and attribution. The benchmark redraws immediately before pixel readback because WebGL does not guarantee the default drawing buffer persists across tasks.
