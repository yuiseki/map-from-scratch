# Day 28 — Senses: Feeling

## Request and interpretation

Make an original map for 30DayMapChallenge 2026 Day 28, “Senses: Feeling,” with real geography rather than a fictional map. The prompt asks for spatial vegetation presence as a carefully labeled physical proxy for green respite. It explicitly does not claim to map anyone's actual feelings, psychological state, park access, or quality of experience.

The map uses ESA WorldCover 2021 v200 and calls its value **green share**: the portion of valid 10 m source pixels in a block classified as tree cover (10), shrubland (20), grassland (30), or herbaceous wetland (90). Cropland (40) remains available in source-cell inspection but is deliberately excluded because cultivated land is not equated with natural green respite. All other source classes are also excluded. For an all-NoData cell, the share is null rather than zero; the verified source crop and selected AOI currently contain no NoData pixels.

## Verified source and exact area

Before baking, the local dataset card, its CC BY 4.0 license metadata, `source/ATTRIBUTION.txt`, `source/MANIFEST.json`, conversion code and Parquet schema were read. The actual table is `/sata_hdd_24tb/hf_data/esa-worldcover-tokyo-2021-100m/data/parquet/esa_worldcover_tokyo_2021_v200_100m.parquet`, from HF dataset `yuiseki/esa-worldcover-tokyo-2021-100m`. The card documents 10×10 non-overlapping source-pixel blocks, geometry and counts for all eleven source classes; the table schema was checked directly. The source is tile N33E138 from ESA WorldCover 10 m 2021 v200, DOI `10.5281/zenodo.7254221`, with WGS 84 / EPSG:4326 cell geometry.

Select source rows 288–455 and columns 192–395, inclusive. The source crop is indexed from its north-west corner; the fixed 168×204-cell selection spans 139.66–139.83°E and 35.62–35.76°N, or 34,272 complete cells. The rectangle is a compact AOI and does not follow administrative boundaries. The 360,000-cell source crop has 36,000,000 valid pixels and zero NoData; the selected AOI has 3,427,200 valid pixels and zero NoData pixels. In that area, tree cover contributes 273,652 pixels, grass 34,282, wetland 201 and shrubland 0; their total is 308,135 (8.99%). `stats.json` records the complete class totals and band counts.

## Renderer and interaction

The source is a dense regular grid, so the renderer stores a row-major array of per-cell source counts and rasterizes each 100-pixel block to one pixel in a 204×168 offscreen Canvas 2D image. It displays a six-band ordered palette from 0% to 100%, with a separate NoData color. Pan and zoom redraw only this cached raster. Click a cell to see its grid row and column and the counts for every WorldCover class. The canvas also supports keyboard focus and arrow-key cell inspection. The scale bar and north arrow give geographic context without suggesting that a cell is a park polygon.

## Limits and credit

Land cover is a physical observation/classification, not a psychological or social measurement. The green-share layer does not establish perceived calm, restorativeness, public access, walking routes, safety, health effects, park boundaries, or vegetation visible from a particular street. It derives from a 2021 satellite product aggregated to about 76 m east–west by 93 m north–south blocks at Tokyo's latitude; a cell is not square on the ground.

Required attribution from the verified source card: “© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.” The dataset is CC BY 4.0. The source and processing link are visible in the page and detailed in the README.

## Verification status

Eight focused model tests pass for class selection, green-share arithmetic and bands, zero versus NoData, source count validation, AOI grid selection, north-up geographic bounds, local projection, source-cell picking and serialization. The capped bake selected exactly 34,272 cells and reproduced the independently queried class totals. Node typecheck and isolated strict browser typecheck pass. The earlier three-run browser test passed all eight checks after adding keyboard focus to the canvas. Its frame p95 was 17.735 ms against the 16.7 ms target, draw CPU p95 was 0.20 ms, and first-frame p50 was 55.025 ms; host load averages were 24.45, 21.35 and 20.68. Those timings were superseded by the corrected OffscreenCanvas benchmark recorded below. The screenshot was reviewed: map, legend, selected-cell counts, caveat and source credit are legible. The full-suite count below is a later run and supersedes the earlier concurrent-development result (961 passed, 2 skipped, 1 Day29 failure): on 2026-11-06, 1,001 tests ran with 999 passed, 2 skipped and 0 failed; all three TypeScript checks passed.

The corrected 2026-11-06 three-run Chrome 156 measurement after the OffscreenCanvas readback fix passed all 8 browser checks and 22/23 budgets. Frame p95 was 17.750 ms (16.7 ms target), draw CPU p95 0.110 ms, first-frame p50 62.785 ms; gzip code/data 9,739/65,071 B. Host load averages were 22.08/21.77/21.68, recorded without attributing causality. The frame target remains unmet; see `results/30DayMapChallenge-2026-28/latest.json`.


A repeat run under the same four-CPU cap on 2026-11-06 reproduced the frame miss at p95 17.700 ms (p50 17.340 ms), while draw CPU p95 was 0.200 ms. All 8 checks passed and 22/23 budgets passed. Host load averages were 18.49/18.69/20.21; the miss persisted at lower recorded load.


A third corrected run added an idle RAF control (no canvas draw) in the same 3-iteration benchmark. Idle callback interval p95 was 17.525 ms; draw-active frame p95 was 17.710 ms, draw CPU p95 0.255 ms, and first-frame p50 61.510 ms. The idle baseline already exceeds 16.7 ms; the active-run increase was 0.185 ms. This does not establish renderer causality, so the budget remains marked unmet rather than relaxed. All 8 checks passed; 22/23 budgets passed. Host load averages were 19.71/18.53/19.24. Code/data gzip was 9,959/65,070 B.

An Xvfb run with the same resource cap and three iterations tested whether display mode explained the cadence. Idle RAF p95 was 17.705 ms, active frame p95 17.780 ms, and draw CPU p95 0.310 ms. All 8 checks passed and 22/23 budgets passed; the 16.7 ms frame budget remains unmet. Xvfb therefore did not remove the idle RAF overrun.
