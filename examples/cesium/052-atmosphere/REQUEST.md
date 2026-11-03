# cesium-052-atmosphere: 3D Planetary Atmospheric Scattering

Reproduce CesiumJS's showcase "Atmosphere" in pure WebGL2 without external dependencies.

## Key Features
- Physically-based Rayleigh and Mie atmospheric scattering around a 3D Earth globe:
  - Rayleigh scattering: Wavelength-selective sky blue scattering and sunset terminator reddening.
  - Mie scattering: Forward directional sun halo and horizon glare.
  - Planetary atmospheric limb glow shell with luminous additive blending fading into deep space.
- Procedural Earth surface texturing:
  - Continents and landmasses with elevation tinting.
  - Deep blue oceans with specular sun reflection glint.
  - Polar ice caps and subtle night city clusters on the dark side of the globe.
- Interactive camera orbit navigation and adjustable sun angle and atmospheric density controls.
- Zero external runtime dependencies.
