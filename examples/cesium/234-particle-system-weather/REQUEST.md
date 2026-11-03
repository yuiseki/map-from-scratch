# cesium-234-particle-system-weather: 3D Volumetric Weather (Rain & Snow)

Reproduce CesiumJS's showcase "Particle System Weather" in pure WebGL2 without external dependencies.

## Key Features
- Volumetric 3D particle simulation for dual weather systems:
  - **Rain Storm**: High-velocity downward droplets with vertical streak shaping, wind drift, and damp asphalt ground styling.
  - **Snow Blizzard**: Gentle floating snowflakes with sinusoidal turbulence swaying, horizontal wind deflection, and crisp snow-covered terrain styling.
- Toroidal wrap-around boundaries for infinite seamless weather volume coverage around the viewpoint.
- Dynamic GPU point sprite shaders adapting particle geometry (elongated streaks vs fuzzy soft snowflakes).
- Interactive camera navigation (orbit drag and wheel zoom) with weather mode and wind velocity toggles.
- Zero external runtime dependencies.
