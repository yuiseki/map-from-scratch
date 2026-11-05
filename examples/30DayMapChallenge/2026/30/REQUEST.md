# REQUEST — Day 30: Pen & paper

## Challenge interpretation

Create the last digital step in a hand-made map workflow: a printable field sheet that supplies light, trustworthy elevation guides while leaving meaningful paper space for a person to draw a route and annotations. The digital output must stay clearly identified as a generated guide. It must not pretend to be a finished hand-drawn map.

## Data source and permitted claims

Use the frozen local dataset `hf:gsi-dem-fuji-z14-100m-2026-10-25`, stored at `/sata_hdd_24tb/hf_data/gsi-dem-fuji-z14-100m-2026-10-25/data/elevation_100m.parquet`. The source records are EPSG:3857 regular-grid cells with `grid_x`, `grid_y`, `elevation_mean_m`, `elevation_min_m`, `elevation_max_m`, and `valid_pixels`. Each derived cell aggregates a 10×10 block from zoom-14 DEM10B raster pixels; the source elevation model includes interpolation from GSI Fundamental Geospatial Data. Before use, check the dataset card, license, manifest, checksums and GeoParquet schema.

The selected contiguous AOI is `grid_x=[371218,371456)`, `grid_y=[165525,165718)`: 238 columns × 193 rows. Derive EPSG:3857 bounds from the zoom-14 Web Mercator pixel matrix. Record the exact bounds, grid origin and spacing, their inverse-Web-Mercator WGS84 display extent, cell and valid/nodata counts, elevation range, contour levels, and output sizes in the bake sidecar.

Use a cell only when `valid_pixels > 0` and `elevation_mean_m` is present. Missing rows, null means and zero-valid-pixel cells remain nodata; they are never sea-level zero. The current source AOI has 45,934 rows and 45,934 valid cells. Do not add synthetic geography, trails, labels, boundary lines, summit claims or visual textures. A computed maximum must not be labeled an official summit.

Attribution and processing disclosure on the artifact:

> Source: Geospatial Information Authority of Japan (GSI), elevation tiles (Fundamental Geospatial Data elevation model), https://maps.gsi.go.jp/development/ichiran.html. Edited and aggregated into 10×10-pixel cells by yuiseki. This is not an official GSI product.

The derived source is governed by Japan Public Data License 1.0 and GSI Content Terms; do not describe it as generic CC BY. Disclose that DEM10B values are interpolated/aggregated and that the resulting contours are approximate drawing guides, not a survey. Cite the GSI terms and dataset card in the README.

## Dedicated print renderer

Implement a custom, deterministic SVG emitter. Do not use a general map engine, web map, map tiles, external APIs, screenshots, raster art or generated imagery. Marching squares must interpolate contours from the source cell means. Resolve four-edge saddle cases deterministically using the bilinear center value, stitch segment endpoints across adjacent cells, and suppress cells touching nodata. Keep output as vector paths and clip it to the selected source rectangle.

Produce an A4 landscape page with explicit `mm` dimensions and a `0 0 297 210` viewBox. Make the map frame and scale correspond to ground distance at the AOI center: target 1:100,000 using the Web Mercator local factor `cos(centerLatitude)`. Include a 2km ground-distance scale bar, north arrow, coordinate extent, elevation and contour units, a stronger index contour every 500m, source attribution, source limitations, printer margins, a large blank route/annotation area, and a plain instruction to print at 100% / Actual size. Make lines distinct on a monochrome printer.

The browser preview displays exactly the same local `sheet.svg` that its download link returns. No runtime map data or network service is necessary.

## Required tests and evidence

Write tests before or alongside implementation to cover:

- aligned contour thresholds, nonpositive interval rejection, and endpoint rules;
- linear edge interpolation and both saddle configurations;
- path continuity between adjacent cells and closed contours;
- nodata suppression without conversion to numeric zero;
- EPSG:3857 coordinate to page-mm transform, y-axis orientation, local scale correction, and the physical 1:100,000 scale;
- physical A4 page size, deterministic SVG serialization, source attribution, disclosure text, and blank manual annotation area;
- clipping at the AOI/frame boundaries and real bake-to-render count consistency.

The capped bake records exact input identity/schema/CRS and checksum verification; exact AOI; row/valid/nodata counts; elevation min/max; selected contour level values; marching-squares segment and stitched-path counts; licenses and attributions; and JSON/SVG byte sizes. Preserve a source-side stats output distinct from browser measurements.

Browser checks inspect the actual SVG image and source response: XML parses, physical page dimensions and scale are correct, every expected contour level appears, the rendered map rectangle contains visible guide pixels, vector coordinates remain inside the source frame, the downloadable SVG is byte-identical to the preview, source/caveat/hand-drawn status are present, and runtime requests/embedded references are same-origin or absent. Capture a 1280×800 screenshot and visually inspect composition, legibility, whitespace and whether the contour field reads as a guide for pencil work. Run three local browser iterations and report their first-render and artifact-size measurements.

All source reads, bakes, tests, builds, type checks and browser runs must be inside `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`. Do not delete `tmp`, use image generation, edit shared TODO, or commit/push.
