# cesium-163-globe-materials: Procedural 3D Globe Materials

Reproduce CesiumJS's showcase "Globe Materials" in pure WebGL2 without external dependencies.

## Key Features
- Procedural multi-layer shader materials mapped directly onto a 3D elevated planetary sphere:
  - Topographic contour lines dynamically computed across elevation gradients with smooth analytical edges.
  - Hypsometric elevation color ramp (bathymetric ocean trench, turquoise coastal shelf, green plains, golden ochre highlands, alpine snow peaks).
  - Continuous rotating radar scan beam with realistic phosphor persistence decay and concentric distance range rings.
  - Atmospheric Fresnel rim glow around the globe horizon silhouette.
- Interactive controls to toggle individual material layers and globe auto-rotation.
- Smooth mouse drag orbit and wheel zoom.
- Zero external runtime dependencies.
