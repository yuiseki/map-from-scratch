# cesium-143-elevation-band-material: 3D Mountain Terrain with Elevation Band Material

Reproduce CesiumJS's showcase "Elevation Band Material" example in pure WebGL2 without external dependencies.

## Key Features
- High-density 3D stratovolcano terrain mesh ($128 \times 128$ grid, 32,768 triangles, 3,776m altitude) with analytical normals and height values.
- Elevation band material shader dividing the mountain into 5 distinct altitude zones:
  - 0m - 1,000m: Valley Forest lush green
  - 1,000m - 1,800m: Subalpine light green
  - 1,800m - 2,500m: Alpine meadow yellow/gold
  - 2,500m - 3,200m: Rocky scree orange
  - 3,200m+: Summit glacial snow white with specular sun reflection
- Screen-space anti-aliased contour lines (isolines) computed via screen-space derivatives (`fwidth`).
- Directional sunlight diffuse lighting and atmospheric aerial perspective haze.
- Interactive camera controls (drag to orbit around peak, wheel to zoom).
- Zero external runtime dependencies.
