# Day 25 implementation prompt — Is this a map?

Create an original map for **30DayMapChallenge 2026 · 25 Is this a map?** Stretch cartographic convention using the frozen public-domain USGS ComCat catalogue of 2025 magnitude-4.5+ earthquakes. Make a global earthquake field that remains geographically anchored but reads like an artwork: at each actual epicentre, compose a projected, depth-sensitive seismic “afterimage” from concentric wave traces whose radius/opacity are explicitly defined transformations of source magnitude and depth. The result should invite the question “is this a map?” while still letting a viewer locate the events on Earth.

## Source and visual meaning

- Read the relevant `yuiseki-open-data` catalog entry and source card; use the local `hf:usgs-comcat-2025-m45` GeoParquet only. Verify its CRS, fields, count, time range and license, and record the exact inputs in `spec.yaml` and `REQUEST.md`.
- The snapshot has 8,502 events. Preserve preferred event ID, longitude, latitude, magnitude, depth and time through the bake. Do not fabricate or re-cluster events. Show that this is the selected 2025 M4.5+ ComCat snapshot, not a complete record of all earthquakes or a prediction of hazard.
- Land/coast outlines and graticules may supply geographic orientation, but must come from documented public-domain Natural Earth geometry; no online basemap or API at runtime.
- Keep the visual encodings honest: magnitude must map monotonically to the documented wave radius/intensity; depth is a separate visual channel with a legend; dates may control a time sweep only if exact timestamps are preserved. Do not label the rings as measured physical seismic waves or shaking/impact footprints. They are an artistic symbol.
- Credit USGS ComCat; identify the data as public domain, the snapshot period and filters, and provide source/interpretation caveats on the page.

## Map and renderer

- Implement a dedicated from-scratch Canvas 2D or WebGL2 renderer; no MapLibre, Leaflet, D3 geo, projection package, external tile service, network API, or generated image.
- Preserve the global location of events in the opening view, provide a projection/graticule/coastline context, and make the transformed artwork legible as a composition rather than merely drawing 8,502 ordinary circles. The overall geographic orientation must remain inspectable.
- Provide keyboard-accessible selection or time control; when a trace/event is selected, show its original USGS ID and source fields. Include zoom/pan, a scale or geographic reference, accessible controls and a concise legend describing the artistic transformation.
- Clearly distinguish source observations from derived display geometry. Explain that the glyphs are not physical wave propagation, magnitude forecasts, or hazard contours.

## Engineering and evidence

- TDD: add failing tests first for source record validation, longitude/latitude projection and antimeridian handling, glyph transformation monotonicity, date ordering/filtering, encoding/decoding and event hit testing. Add browser checks for exactly the frozen source count/ID preservation, visible global geography and artistic glyph layer, selected record fidelity, control behavior, disclosures and no runtime external requests.
- Cap all real-data reads, bake, tests and performance runs with `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>`. Never remove files from `tmp`.
- Add `spec.yaml`, `REQUEST.md`, README, deterministic bake and statistics, dedicated renderer, benchmark/checks and screenshot. Run 3 browser iterations, inspect the image, run the full suite and every type check, and document measured performance and exact source/output counts.
- Update only Day 25's shared TODO row after verification. Do not use image generation.
