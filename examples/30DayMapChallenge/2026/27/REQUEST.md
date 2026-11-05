# Request and design record

## Request

For 30DayMapChallenge 2026 Day 27, use WebGPU as a new tool for making a map. The day has no fictional-map requirement: this is a map of real 2020 census population data in Chiyoda-ku, Tokyo.

## Data choice

The catalog lists `hf:estat-census-mesh-2020-250m` as a CC BY 4.0-compatible 2020 Census dataset with no geometry: the 10-digit mesh key defines each cell, and the table values remain strings. The dataset card at `/sata_hdd_24tb/hf_data/__published/estat-census-mesh-250m-2020/README.md` documents 13,975,584 rows across 12 tables, two incompatible datums, and the raw `*` suppression marker. The selected file is `data/parquet/T001142.parquet`, JGD2011, table name `人口及び世帯（JGD2011）`; its 54 columns include `T001142004`, `0～14歳人口 総数`.

The source describes `*` as a hidden breakdown value, and says its count is added to a destination mesh; total population and household columns are never suppressed. A mesh with no population has no source row. This renderer keeps `*`, `0`, positive decimal strings, unavailable strings, and an absent source row as separate states. Values in the selected area are not converted to a numeric zero when hidden or absent.

The area is the exact municipality identified by local code `131016` (千代田区) in `yuiseki/jp-admin-2026-09`. The source boundary is EPSG:4612 (JGD2000); bake transforms it with DuckDB Spatial `ST_Transform` to EPSG:6668 (JGD2011), then includes a mesh square if its centroid is in or on that polygon. Full census squares are shown; the boundary is not used to prorate counts. The T001142 mesh geometry uses JGD2011.

The official 250m mesh definition is the quarter mesh formed by dividing each third-level mesh into a 4-by-4 grid. The 10-digit key is decomposed into first-, second- and third-level mesh digits, then the fourth- and fifth-level quadrant digits. The third mesh cell is 30 arc-seconds north-south by 45 arc-seconds east-west; each final cell is 7.5 by 11.25 arc-seconds. `mesh.test.ts` checks exact bounds and edge adjacency; the official statistical mesh definition is documented at [Statistics Bureau: Standard Grid Square and Grid Square Code](https://www.stat.go.jp/english/data/mesh/02.htm).

## Renderer

Every animation frame uploads the current camera and dispatches a WebGPU compute pipeline over actual census cells. For each cell the shader projects all four geographic bounds into device pixels, rejects cells outside the viewport, and derives the thematic class from the retained status and population value. The render pipeline reads the same compute output to draw instanced screen-space quads, so the output changes when camera or source population changes. No generic map engine, tiles, or external runtime data are involved.

CPU-side tests cover exact mesh decode/encode, adjacency, source value interpretation, missing-row semantics, centroid-in-polygon inclusion, compute projection reference values, picking and data round trips. Browser checks additionally compare the compute buffer and actual rendered pixels, exercise drag, wheel and picking, and inspect the visible legend/citations. The parent agent will coordinate browser measurement after the other active benchmark completes.

## Known limits

- Each population value is an aggregate for a census mesh, not a person or household location.
- The census is dated 2020-10-01 and should not be read as a current population estimate.
- Suppressed age breakdowns are not recoverable from the source; the `*` marker is explicitly shown.
- No source row is displayed as `no-row`, not as a numeric zero. The source card says absent rows represent meshes without population, but the map does not infer or display an exact count of zero.
- Mesh counts remain attached to the source's whole 250m cells even where a mesh crosses Chiyoda-ku's administrative edge.
- The municipal outline is transformed from JGD2000 EPSG:4612 to JGD2011 EPSG:6668 before cell-center containment, so the predicate compares a shared CRS.
