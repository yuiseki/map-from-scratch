# cesium-281-star-burst: 3D Celestial Starburst

Reproduce CesiumJS's showcase "Star Burst" in pure WebGL2 without external dependencies.

## Key Features
- 3D hyperspace / celestial starburst particle simulation:
  - Thousands of stars shooting radially outward in 3D space with Doppler spectral coloring (warm orange, white, hyper cyan).
  - High-velocity motion blur streak lines fading at the tail and brilliant at the leading head.
  - Soft radial point sprite cores with exponential glow falloff.
- Additive blending (`SRC_ALPHA`, `ONE`) for luminous radiance.
- Interactive warp speed slider (cruising speed to relativistic hyper-warp) and 3D orbit camera.
- Zero external runtime dependencies.
