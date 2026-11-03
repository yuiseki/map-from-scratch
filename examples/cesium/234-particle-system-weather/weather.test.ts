import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWeatherParticles,
  updateWeather,
  packWeatherBuffer,
  medianPixel,
  type WeatherParticle,
} from './weather.ts';

test('createWeatherParticles spawns particles within specified volume', () => {
  const count = 1000;
  const volume: [number, number, number] = [800, 500, 800];
  const particles = createWeatherParticles(count, 'rain', volume);

  assert.equal(particles.length, count);
  for (const p of particles) {
    assert.ok(p.x >= -volume[0] / 2 && p.x <= volume[0] / 2);
    assert.ok(p.y >= 0 && p.y <= volume[1]);
    assert.ok(p.z >= -volume[2] / 2 && p.z <= volume[2] / 2);
    // Rain should have high downward vertical speed
    assert.ok(p.vy < -300);
  }
});

test('snow mode spawns particles with gentle downward speed and smaller size', () => {
  const particles = createWeatherParticles(500, 'snow', [600, 400, 600]);
  assert.equal(particles.length, 500);
  for (const p of particles) {
    // Snow fall speed is gentle (-30 to -120)
    assert.ok(p.vy < -20 && p.vy > -150);
  }
});

test('updateWeather moves particles, applies wind, and wraps at bottom to top', () => {
  const volume: [number, number, number] = [500, 300, 500];
  const particles: WeatherParticle[] = [
    { x: 0, y: 10, z: 0, vx: 0, vy: -200, vz: 0, size: 4 },
  ];

  // Advance by 0.1s -> falls by 20 -> y becomes -10 -> wraps to top
  updateWeather(particles, 0.1, 'rain', [50, 0, 0], volume, 1.0);
  assert.ok(particles[0].y >= 250); // Wrapped near volume height

  // Away from the bottom, wind carries the particle sideways.
  const still: WeatherParticle[] = [{ x: 0, y: 200, z: 0, vx: 0, vy: -10, vz: 0, size: 4 }];
  updateWeather(still, 0.1, 'rain', [50, 0, -20], volume, 1.0);
  assert.ok(Math.abs(still[0].x - 5) < 1e-9 && Math.abs(still[0].y - 199) < 1e-9 && Math.abs(still[0].z - -2) < 1e-9);
});

test('packWeatherBuffer outputs correct stride and floats for GPU drawing', () => {
  const particles: WeatherParticle[] = [
    { x: 10, y: 20, z: 30, vx: 5, vy: -50, vz: 0, size: 6 },
    { x: -10, y: 50, z: -30, vx: -5, vy: -40, vz: 2, size: 8 },
  ];

  // Each particle: x, y, z, size, alpha (5 floats)
  const buf = packWeatherBuffer(particles);
  assert.equal(buf.length, particles.length * 5);
  assert.equal(buf[0], 10);
  assert.equal(buf[1], 20);
  assert.equal(buf[2], 30);
  assert.equal(buf[3], 6); // size
});

test('median sky sample rejects a bright weather particle outlier', () => {
  const samples: Uint8Array[] = [
    new Uint8Array([51, 61, 71, 255]),
    new Uint8Array([51, 61, 71, 255]),
    new Uint8Array([104, 119, 134, 255]),
    new Uint8Array([51, 61, 71, 255]),
    new Uint8Array([51, 61, 71, 255]),
  ];
  assert.deepEqual([...medianPixel(samples)], [51, 61, 71, 255]);
});
