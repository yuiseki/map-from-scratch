import assert from 'node:assert/strict';
import test from 'node:test';
import { acousticWeight, audioParameters, decodeSoundGrid, encodeSoundGrid, mixSoundscape, type SoundSource } from './soundscape.ts';

test('motorways and railways contribute more modeled sound than footpaths', () => {
  assert.ok(acousticWeight({ kind: 'road', class: 'motorway' }) > acousticWeight({ kind: 'road', class: 'footway' }));
  assert.ok(acousticWeight({ kind: 'rail', class: 'rail' }) > acousticWeight({ kind: 'road', class: 'residential' }));
});

test('soundscape mix is deterministic, bounded, and silent without nearby sources', () => {
  const sources: SoundSource[] = [
    { kind: 'road', class: 'motorway', x: 0.5, y: 0.5, strength: 0.8 },
    { kind: 'rail', class: 'rail', x: 0.51, y: 0.5, strength: 0.5 },
  ];
  const first = mixSoundscape(sources, 0.5, 0.5);
  assert.deepEqual(first, mixSoundscape(sources, 0.5, 0.5));
  assert.ok(first.traffic > 0 && first.rail > 0);
  assert.ok(first.traffic <= 1 && first.rail <= 1 && first.master <= 1);
  assert.deepEqual(mixSoundscape([], 0.5, 0.5), { traffic: 0, rail: 0, master: 0 });
});

test('modeled sound attenuates with distance', () => {
  const sources: SoundSource[] = [{ kind: 'road', class: 'primary', x: 0.5, y: 0.5, strength: 1 }];
  assert.ok(mixSoundscape(sources, 0.5, 0.5).master > mixSoundscape(sources, 0.9, 0.9).master);
});

test('sound grid encoding preserves both channels and rejects malformed records', () => {
  const encoded = encodeSoundGrid({ width: 2, height: 1, roads: new Uint16Array([125, 0]), rails: new Uint16Array([0, 640]) });
  assert.equal(encoded.byteLength, 20);
  assert.deepEqual([...decodeSoundGrid(encoded).roads], [125, 0]);
  assert.deepEqual([...decodeSoundGrid(encoded).rails], [0, 640]);
  assert.throws(() => decodeSoundGrid(encoded.slice(0, 16)), /invalid/i);
  assert.throws(() => encodeSoundGrid({ width: 2, height: 2, roads: new Uint16Array(3), rails: new Uint16Array(3) }), /dimensions/i);
});

test('audio synthesis parameters separate road noise from the rail tone', () => {
  const quiet = audioParameters(0, 0), loudRoad = audioParameters(1, 0), loudRail = audioParameters(0, 1);
  assert.ok(loudRoad.trafficGain > quiet.trafficGain);
  assert.ok(loudRoad.trafficCutoffHz > quiet.trafficCutoffHz);
  assert.equal(loudRoad.railGain, quiet.railGain);
  assert.ok(loudRail.railGain > quiet.railGain);
  assert.ok(loudRail.railFrequencyHz > quiet.railFrequencyHz);
  assert.deepEqual(audioParameters(2, -1), audioParameters(1, 0));
});
