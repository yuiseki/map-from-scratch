# Mapbox 004 — Add 3D Model and Animate Along Route

Mapbox's official example animates a glTF airplane along a route. This standalone version shows a lit, textured Earth, a glowing great-circle route from San Francisco to New York, and a small procedural aircraft with a spinning propeller and blinking light. Drag to rotate and use the wheel to zoom.

## Design

- A WebGL2 indexed sphere renders Earth and its blue atmospheric rim. The bundled Solar System Scope texture is credited in the page.
- The flight path uses spherical interpolation between airport coordinates. A canvas overlay projects the path and a small aircraft mesh onto the same globe camera, hiding the route on the far hemisphere. The aircraft mesh is built from five triangles in the local forward/right/up frame; its propeller and strobe change over time.
- The aircraft geometry is procedural rather than a downloaded glTF asset. The route, local tangent frame, looping animation, and camera bounds are covered by tests and browser pixel checks.
- No Mapbox GL JS, Three.js, Turf, or other runtime package is loaded.

## Differences from the source

The original example uses Mapbox Standard at dusk, Turf-generated route coordinates, a glTF airplane, and animated aircraft submeshes. This version uses a textured globe, a great-circle route, and a small procedural aircraft glyph with propeller and strobe animation. It focuses on the globe-scale journey and the 3D model animation rather than the city basemap.

## Measurement

`bin/mfs bench mapbox-004-add-3d-model-and-animate-along-route -n 3` on NVIDIA RTX 3060: first frame p50 95.08 ms, frame p95 1.145 ms, GPU p95 0.1321 ms, code gzip 8,798 B, texture 512,606 B, runtime dependencies 0. All three WebGL/overlay pixel checks passed in each run. The screenshot was visually inspected; the route follows the northern arc across North America and the aircraft appears above the visible globe.

## Data

Earth texture: Solar System Scope, CC BY 4.0, linked in the page. Route endpoints are San Francisco International Airport (-122.379, 37.621) and John F. Kennedy International Airport (-73.778, 40.641).
