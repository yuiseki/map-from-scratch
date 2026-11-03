# cesium-166-globe-translucency: Translucent Planetary Globe with Subterranean Features

Reproduce CesiumJS's showcase "Globe Translucency" in pure WebGL2 without external dependencies.

## Key Features
- Semi-transparent outer planetary crust with view-angle-dependent Fresnel falloff (high translucency when looking directly into the globe, soft atmospheric opacity at glancing limbs).
- Full multi-layer interior planetary visualization:
  - Deep glowing molten core sphere with high emissive radiance.
  - Convective mantle intermediate shell.
  - Subterranean seismic hypocenters and magma chamber markers located at depths underneath the crust.
- Multi-pass depth-tested alpha blending (`gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)`) ensuring interior objects are rendered properly beneath the crust without depth-fighting.
- Interactive controls for crust opacity slider and subterranean feature toggles.
- Zero external runtime dependencies.
