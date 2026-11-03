# cesium-233-particle-system-tails: 3D Orbiting Particle Tails

Reproduce CesiumJS's showcase "Particle System Tails" in pure WebGL2 without external dependencies.

## Key Features
- Multi-body 3D orbital particle emitter simulation:
  - Central planetary globe with directional lighting.
  - Primary celestial body (comet) orbiting in an inclined elliptical path, emitting radiant golden combustion trails.
  - Secondary orbital craft (probe) on an opposing polar orbit, emitting luminous cyan plasma plumes.
  - Particle puff expansion, drag deceleration, dispersion, and smooth alpha decay.
- Additive blending (`SRC_ALPHA`, `ONE`) for luminous particle glow.
- Interactive camera orbit navigation and adjustable orbit speed and emission rate sliders.
- Zero external runtime dependencies.
