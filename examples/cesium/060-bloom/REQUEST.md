# cesium-060-bloom: HDR Bloom Post-Processing Pipeline

Reproduce CesiumJS's showcase "Bloom" in pure WebGL2 without external dependencies.

## Key Features
- High Dynamic Range (HDR) bloom / glow post-processing pipeline:
  - Base 3D scene rendering into HDR offscreen Framebuffer (FBO).
  - Photometric bright-pass filter extracting high-luminance light beacons above threshold.
  - Separable two-pass Gaussian blur (horizontal & vertical downsampled passes) for soft radial radiance spread.
  - Fullscreen composite pass with Reinhard tone mapping and gamma correction blending scene with diffuse glow.
- 3D futuristic neon metropolis with high-intensity emissive rooftop light beacons and reflective dark street grid.
- Interactive controls: toggle bloom effect, adjust glow intensity slider, and orbit camera.
- Zero external runtime dependencies.
