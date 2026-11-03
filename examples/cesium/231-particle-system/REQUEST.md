# cesium-231-particle-system: 3D High-Energy Particle System

Reproduce CesiumJS's showcase "Particle System" in pure WebGL2 without external dependencies.

## Key Features
- Dynamic multi-tier 3D particle simulation:
  - High-velocity luminous rocket flame core with cone emitter sampling.
  - Expanding atmospheric smoke plume with upward buoyancy and wind deflection.
  - Sparkling golden ember particles with gravity and drag.
- Dual-pass particle blending:
  - Additive blending (`gl.blendFunc(gl.SRC_ALPHA, gl.ONE)`) for fiery radiance.
  - Standard alpha blending (`gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)`) for dense smoke plume.
- Metallic 3D launch pad ground plane with circular heat glow.
- Interactive 3D orbit controls (drag to orbit, wheel to zoom).
- Zero external runtime dependencies.
