# cesium-089-clouds: 3D Volumetric Cumulus Clouds

Reproduce CesiumJS's showcase "Clouds" in pure WebGL2 without external dependencies.

## Key Features
- Volumetric 3D cumulus cloud clusters:
  - Multi-puff cluster assembly creating natural cauliflower cloud tops and flat bases.
  - Directional sunlight shading: sunlit silver-white crests with soft ambient sky bounce underneath.
  - Dynamic wind drift across a toroidal 3D bounding volume.
- Dynamic cloud shadow projection onto terrain:
  - Analytically projects cloud positions along the sun ray to cast soft moving shadows on the rolling hills below.
- Smooth atmospheric sky dome gradient from horizon to zenith.
- Interactive camera orbit navigation and wind velocity / sun angle controls.
- Zero external runtime dependencies.
