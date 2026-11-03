# cesium-291-time-dynamic-point-cloud: 4D Time-Dynamic Point Cloud

Reproduce CesiumJS's showcase "Time Dynamic Point Cloud" in pure WebGL2 without external dependencies.

## Key Features
- High-density 4D time-dynamic point cloud surface:
  - Thousands of point particles evaluated via multi-frequency harmonic sinusoidal wave superposition directly on the GPU.
  - Smooth undulating terrain/ocean surface dynamics over time.
  - Elevation-based color mapping: deep indigo marine troughs, cyan/emerald slopes, and bright golden-white crests.
- Soft circular point splatting with distance-based attenuation and additive luminance blending (`gl.blendFunc(gl.SRC_ALPHA, gl.ONE)`).
- Wireframe reference base coordinate grid.
- Interactive controls: orbit camera, play/pause toggle, speed adjustment, point radius slider.
- Zero external runtime dependencies.
