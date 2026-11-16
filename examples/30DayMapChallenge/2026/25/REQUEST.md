# Day 25 — Is this a map?

The prompt asks for a drawing that keeps geographic truth while pushing away from ordinary point symbols. This renderer uses all 8,502 events in the frozen 2025 ComCat M4.5+ snapshot as anchors for three concentric, magnitude-scaled traces. Depth is shown by a separate three-band hue. A timeline reveals the records through an exact source event time; the selected event panel keeps the event ID and source measurements inspectable.

The ring equations are intentionally explicit and screen-space only: q = clamp((M - 4.5) / 4.3, 0, 1), opening-view outer radius 2 + 9q CSS pixels (scaled by square root of camera zoom), intensity 0.18 + 0.68q, and ring scale factors 0.38, 0.69, 1. WebGL2 instances draw the rings from one static source-position buffer; time cutoff, camera and selection are uniforms. The radius does not denote kilometres or elapsed wave travel. Depth changes hue only. The marks are not physical wavefronts, shaking, forecasts, impact footprints, or hazard contours.

## Source verification and bake

The `yuiseki-open-data` card and dataset license identify `hf:usgs-comcat-2025-m45` as USGS ComCat public-domain source information with acknowledgement requested. Its selected artifact is GeoParquet, OGC:CRS84 points with depth in a separate `depth_km` column. The bake reads only the local `parquet/earthquakes.parquet` file, selects `type='earthquake'`, `net='us'`, `mag >= 4.5`, preserves `event_id`, `ST_X(geometry)`, `ST_Y(geometry)`, `mag`, `depth_km`, and `time`, and sorts by exact timestamp then event ID. It rejects any result other than 8,502 unique IDs. A sorted-ID SHA-256 sidecar is recomputed in the browser to check preservation.

The coast context comes from Natural Earth v5.1.1 admin-0 country geometry, which the catalog documents as public domain. Exterior outlines are split where consecutive longitudes jump across the antimeridian, then simplified at 0.12° in longitude/latitude (about 0.4 screen pixels at the opening map width). The current bake has 4,274 line parts and 29,841 vertices. No basemap, runtime API, map library, projection library, external code, or generated imagery is used.

## Design choices

- **Equirectangular world:** one simple affine camera keeps the graticule and epicentres easy to read together. Its longitude wrap is normalized at the view centre; Natural Earth lines split at the date line so the renderer does not create cross-world chords.
- **WebGL2 + Canvas 2D:** one instanced GPU draw renders three rings for each of 8,502 source-positioned events. A separate Canvas 2D layer draws geographic context, labels and the selected-record marker.
- **Time slider:** the native range input navigates sorted source records and filters inclusively through that record's original epoch-millisecond timestamp. It neither interpolates nor changes event times.
- **Depth palette:** source depth has its own categorical legend (<70, 70–300, ≥300 km), so it cannot be mistaken for an alternate magnitude scale.

## Caveats

The catalogue is a selected snapshot: preferred network `us`, earthquake event type, M4.5+, year 2025. Detection, magnitude type, and hypocentre uncertainty vary; ComCat can be revised; missing events do not mean no seismic activity. The derived marks provide no physical wave, ground shaking, exposure, prediction or hazard information.

## Measurements

The capped Chrome 156/Xvfb benchmark (three runs at 1280 × 800) passed all 15 budgets and 11 browser checks: frame p95 6.96 ms, JavaScript draw p95 5.65 ms, first-frame p50 533.5 ms, code gzip 13,881 B and data gzip 421,815 B as measured by the harness. The captured screenshot was visually reviewed; the global coastline context, seismic field, legend, selected source event and attribution are legible. Artifacts: `results/30DayMapChallenge-2026-25/latest.json` and `results/30DayMapChallenge-2026-25/screenshot.png`.
