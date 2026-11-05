# 30DayMapChallenge 2026 · Day 25 — Is this a map?

This page turns the frozen 2025 USGS ComCat M4.5+ preferred-network-`us` snapshot into a global field of concentric “afterimages.” Each event stays at its recorded epicentre. At the opening zoom, its source magnitude M gives q=clamp((M−4.5)/4.3,0,1), outer screen radius 2+9q CSS pixels, and stroke intensity 0.18+0.68q. Zoom scales radius by the square root of camera zoom. WebGL2 draws three instanced rings using 0.38, 0.69, and 1 times that radius. Recorded depth is an independent hue channel: shallow under 70 km, intermediate 70–300 km, deep at least 300 km. The formulas describe display geometry only; these marks are not physical seismic waves, shaking or hazard extents.

The equirectangular global view preserves relative epicentre locations and explicitly wraps longitudes at the antimeridian. Natural Earth v5.1.1 admin-0 country outlines and a 15-degree graticule give geographic orientation. Drag to pan; wheel or the controls to zoom. The keyboard-accessible timeline is indexed by sorted, exact ComCat timestamps and reveals all events through the selected event. Selecting the event displays its original ID, UTC time, longitude, latitude, magnitude, and depth.

## Data and interpretation

- Input: local `hf:usgs-comcat-2025-m45` GeoParquet `parquet/earthquakes.parquet`, never the separately stored GeoJSON. It is OGC:CRS84 (2D longitude/latitude), with `depth_km` separately retained in kilometres, positive downward.
- Selection: event type `earthquake`, preferred network `us`, magnitude at least 4.5, origin time 2025-01-01T00:00:00Z through 2025-12-31T23:59:59.999Z. The snapshot has 8,502 unique event IDs; origin time is retained as exact Unix milliseconds UTC.
- Provenance: retrieved 2026-10-25 from USGS FDSN event service 2.8.2. The baked sidecar records source path, query/filter, fields, source IDs checksum, output counts, time/magnitude/depth range and byte counts.
- Current bake: 8,502 event rows (463,096 B), 258 Natural Earth features, 4,274 antimeridian-safe coastline parts simplified at 0.12° to 29,841 vertices (683,428 B). The shipped events, coastlines and provenance/statistics JSON gzip to 172,939 B, 256,194 B and 966 B respectively (430,099 B combined).
- Credit: U.S. Geological Survey, Comprehensive Earthquake Catalog (ComCat). USGS-authored or produced data is U.S. public domain; USGS requests acknowledgement. The retained source/network identifiers do not relicense any separate linked products. See the [dataset card](https://huggingface.co/datasets/yuiseki/usgs-comcat-2025-m45) and [USGS copyright and credit policy](https://www.usgs.gov/faqs/are-usgs-reportspublications-copyrighted).
- Geographic context: Natural Earth v5.1.1 1:10m admin-0 countries, public domain. It is used only for coast/orientation context and does not alter the earthquake records.

The selection is a magnitude-thresholded, preferred-network-filtered snapshot, not a complete or uniformly detected global earthquake inventory. ComCat records may be revised, and detection capability, magnitude type, location and depth uncertainty vary. Missing records must not be read as absence of seismic activity. Nothing in this visualization forecasts earthquakes or estimates hazard.

## Verification

Unit tests cover source-row validation, global projection and antimeridian wrap, monotone magnitude encoding and independent depth channel, exact timestamp ordering/filtering, deterministic encode/decode, nearest-event hit testing, and the GPU instance layout. The capped Chrome 156/Xvfb run (three iterations, 1280 × 800) measured frame p95 6.96 ms and JavaScript draw p95 5.65 ms against 16.7 ms and 8 ms budgets; first frame p50 was 533.5 ms. Source counts, canvas pixels, selection, keyboard timeline, attribution, pan/zoom, and same-origin request checks passed. The run data and screenshot are in `results/30DayMapChallenge-2026-25/`.
