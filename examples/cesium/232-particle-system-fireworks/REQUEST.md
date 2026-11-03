# cesium-232-particle-system-fireworks: 3D Particle System Fireworks

Reproduce CesiumJS's showcase "Particle System Fireworks" in pure WebGL2 without external dependencies.

## Key Features
- Dynamic 3D particle system simulation with multi-stage lifecycles:
  - Launch rocket ascent trails.
  - Multi-color spherical explosion bursts (crimson red, golden amber, emerald green, cyan azure, magenta).
  - Physics with gravity acceleration, atmospheric drag, and sparkling decay.
- GPU point sprite rendering with radial soft Gaussian falloff and intense glowing cores.
- Additive blending (`gl.blendFunc(gl.SRC_ALPHA, gl.ONE)`) for vibrant luminous radiance.
- 3D ground plane with coordinate grid and interactive orbit camera.
- Zero external runtime dependencies.
