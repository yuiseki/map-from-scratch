# luma-001-globe: 3D Earth Globe with Solar Terminator and Atmospheric Rim Glow

Reproduce luma.gl's showcase 3D Globe example from scratch in WebGL2 without external dependencies.

## Key Features
- High-tessellation 3D sphere geometry (8,192 vertices, 16,384 triangles) with normal and UV coordinates.
- Realistic solar day/night illumination:
  - Day diffuse surface with ocean specular sun glint and polar ice caps.
  - Smooth terminator twilight transition with warm atmospheric horizon scattering.
  - Night city lights (metropolitan cluster radiance) illuminating unlit continents.
- Multi-pass atmospheric Rayleigh rim glow shell with additive alpha blending.
- Interactive camera controls (drag to orbit yaw/pitch, scroll wheel to zoom).
- Zero external runtime dependencies.
