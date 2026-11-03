# cesium-298-volumecloud: Volumetric Atmospheric Cloud Rendering

Reproduce CesiumJS's showcase "Volumecloud" in pure WebGL2 without external runtime dependencies.

## Key Features
- High-fidelity real-time volumetric cloud raymarching pipeline:
  - Raymarching through a spherical tropospheric atmospheric shell above the 3D Earth globe.
  - Procedural multi-frequency 3D fractal noise field (FBM) with dynamic wind vector displacement.
  - Physically based radiative transfer: Beer-Lambert light absorption ($T = \exp(-\sigma_t \Delta s \rho)$) and Henyey-Greenstein anisotropic phase function for forward Mie scattering.
  - Secondary light ray march towards the sun for cloud self-shadowing and silver-lining illumination.
- 3D procedural Earth globe underneath with continental/ocean masks and atmospheric Rayleigh limb glow.
- Interactive controls: orbit camera around globe or into the cloud layer, adjust cloud coverage density slider, sun elevation slider, and auto-rotation toggle.
- Zero external runtime dependencies.
