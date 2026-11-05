# Day 28 · Senses: Feeling — Tokyo Green Cover

東京の土地被覆セルに占める樹木・低木・草地・草本湿地の割合を、**緑被率という物理的な代理指標**として表示します。感情や「癒やし」の実測ではありません。

## AOI and source

- Source: [ESA WorldCover 10 m 2021 v200](https://doi.org/10.5281/zenodo.7254221), tile N33E138; local derived table [`esa_worldcover_tokyo_2021_v200_100m.parquet`](/sata_hdd_24tb/hf_data/esa-worldcover-tokyo-2021-100m/data/parquet/esa_worldcover_tokyo_2021_v200_100m.parquet), published as [`yuiseki/esa-worldcover-tokyo-2021-100m`](https://huggingface.co/datasets/yuiseki/esa-worldcover-tokyo-2021-100m).
- The source crop covers 139.5–140.0°E, 35.5–36.0°N. It has 360,000 cells aggregated from non-overlapping 10×10 blocks of the original 10 m pixels, EPSG:4326 / WGS 84, 36,000,000 valid source pixels and zero NoData pixels.
- The selected AOI is the exact zero-based source-grid window `cell_row 288–455`, `cell_col 192–395` (inclusive): 168 rows × 204 columns = 34,272 cells. Its cell edges span 139.66–139.83°E, 35.62–35.76°N. This is a fixed rectangle, not a municipal boundary. Full source cells are retained.
- Every selected cell has 100 valid source pixels and zero NoData pixels. AOI class totals are recorded in `data/baked/30DayMapChallenge-2026-28/stats.json` and the selection's exact cell counts are retained in `cells.json`.

## Green-share definition

`green share = (pixels_10 + pixels_20 + pixels_30 + pixels_90) / valid_pixels`

The numerator includes ESA WorldCover class 10 (tree cover), 20 (shrubland), 30 (grassland), and 90 (herbaceous wetland). Cropland class 40 stays in the source counts but is excluded: cultivated land is not treated here as natural green cover. Built-up, bare/sparse vegetation, snow and ice, permanent water, mangroves, and moss/lichen are also excluded. NoData is not turned into 0%: `valid_pixels = 0` stays a distinct null state.

In the AOI the four included classes total 308,135 of 3,427,200 valid pixels (8.99%). This proportion describes the classified satellite pixels inside each cell. It does not describe who can enter a place, a park boundary, shade at a pedestrian's exact location, or anyone's experience.

| WorldCover code | Source class | AOI source pixels | Included in green share |
| ---: | --- | ---: | :---: |
| 10 | Tree cover | 273,652 | Yes |
| 20 | Shrubland | 0 | Yes |
| 30 | Grassland | 34,282 | Yes |
| 40 | Cropland | 9,964 | No |
| 50 | Built-up | 2,779,755 | No |
| 60 | Bare / sparse vegetation | 17,594 | No |
| 70 | Snow and ice | 0 | No |
| 80 | Permanent water bodies | 311,752 | No |
| 90 | Herbaceous wetland | 201 | Yes |
| 95 | Mangroves | 0 | No |
| 100 | Moss and lichen | 0 | No |

## Interaction and renderer

The dedicated Canvas 2D renderer turns each row-major source grid cell into one pixel in a 204×168 offscreen raster. Its ordered green-share palette preserves the distinction between 0% and NoData. The displayed map keeps the source grid's north-up positions and local physical aspect ratio. Drag to pan, wheel or use the buttons to zoom, reset to the fixed extent, and click a cell to inspect all eleven original class counts. Focus the canvas and use arrow keys to inspect adjacent cells.

The map has no basemap, generated image, external map engine, runtime data API, or remote tile dependency. A scale bar and north arrow provide geographic context; the selected grid window is not shown as a legal or administrative outline.

## Attribution and license

The source card identifies the derived table as CC BY 4.0 and specifies this credit:

> © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.

See the [dataset card](https://huggingface.co/datasets/yuiseki/esa-worldcover-tokyo-2021-100m), [source DOI](https://doi.org/10.5281/zenodo.7254221), and `source/ATTRIBUTION.txt`. The derivative and renderer do not imply ESA endorsement.

## Development

```sh
bin/mfs bake 30DayMapChallenge-2026-28
bin/mfs bench 30DayMapChallenge-2026-28 -n 3
```

All real-data reads, bakes, tests, type checks, builds, and browser measurements must run with the repository resource cap.

## Verification and performance

The capped three-run browser benchmark reports exact source totals and passes all eight interaction, rendering, attribution, caveat, and request-origin checks. The canvas is keyboard-focusable and arrow keys inspect adjacent cells. The earlier run reported frame p95 17.735 ms against a 16.7 ms target, draw CPU p95 0.20 ms, and first-frame p50 55.025 ms. Host load averages were 24.45, 21.35, and 20.68. Code gzip was 9,739 B and baked-data gzip was 65,071 B.

2026-11-06 corrected three-run Chrome 156 measurement after pixel checks were moved to an OffscreenCanvas copy: all 8 browser checks passed and 22/23 budgets passed. The callback-to-callback frame p95 is 17.750 ms against a 16.7 ms target; draw CPU p95 is 0.110 ms and first-frame p50 is 62.785 ms. Host load averages were 22.08/21.77/21.68; this is concurrent environment data, not an established cause. The frame target remains unmet. Gzip code/data is 9,739/65,071 B. See `results/30DayMapChallenge-2026-28/latest.json`.
