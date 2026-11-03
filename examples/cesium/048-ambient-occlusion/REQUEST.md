# cesium-048-ambient-occlusion: Screen Space Ambient Occlusion (SSAO)

Reproduce CesiumJS's showcase "Ambient Occlusion" in pure WebGL2 without external runtime dependencies.

## Key Features
- Multi-pass real-time Screen Space Ambient Occlusion (SSAO) pipeline:
  - G-Buffer Pass: Renders 3D urban geometric scene to Multiple Render Targets (albedo color texture and view-space normal + linear depth texture).
  - SSAO Generation Pass: 16-sample hemisphere kernel oriented along view-space normals, jittered by a 4x4 rotation noise texture and projected into screen space with smooth distance range attenuation.
  - Edge-Preserving Blur Pass: 4x4 box filter smoothing high-frequency noise without bleeding across depth edges.
  - Composite Shading Pass: Blends diffuse scene illumination with ambient occlusion shadowing and gamma tone mapping.
- Procedural 3D urban block city with varying skyscraper heights and narrow alleyways.
- Interactive controls: toggle SSAO on/off, adjust occlusion intensity slider, sample radius slider, and orbit camera.
- Zero external runtime dependencies.
