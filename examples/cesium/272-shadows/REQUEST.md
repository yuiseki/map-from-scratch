# cesium-272-shadows: Real-Time Directional Soft Shadows

Reproduce CesiumJS's showcase "Shadows" in pure WebGL2 without external runtime dependencies.

## Key Features
- High-quality real-time shadow mapping pipeline:
  - Depth map generation pass into offscreen 1024x1024 Framebuffer Object (FBO) with front-face culling to suppress shadow acne.
  - Main rendering pass with 3x3 Percentage-Closer Filtering (PCF) soft shadow kernel.
  - Slope-scale adaptive depth bias preventing self-shadowing surface artifacts.
- Procedural 3D city scene with skyscrapers, surrounding towers, and expansive ground plane.
- Interactive controls: orbit sun azimuth and elevation, toggle shadows on/off, and free orbit camera controls.
- Zero external runtime dependencies.
