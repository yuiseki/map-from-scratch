import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTerrHeader,
  decodeChunk,
  encodeChunk,
  elevationColor,
  generateGridIndices,
  S,
} from './terrain.ts';

test('parseTerrHeader parses format header and validates magic', () => {
  const buf = new Uint8Array(64);
  const dv = new DataView(buf.buffer);
  // 'MFST'
  buf[0] = 77; buf[1] = 70; buf[2] = 83; buf[3] = 84;
  dv.setUint16(4, 1, true);   // version 1
  dv.setUint16(6, 128, true); // CS = 128
  buf[8] = 1;                 // block scale
  buf[9] = 4;                 // levels = 4
  dv.setUint16(10, 85, true); // chunks count
  dv.setUint32(12, 1000, true); // x0
  dv.setUint32(16, 2000, true); // y0
  buf[20] = 32;               // block
  dv.setFloat64(24, 30.5, true); // cell spacing
  dv.setFloat64(32, 35.36, true); // lat0
  dv.setFloat64(40, 138.73, true); // lon0

  const header = parseTerrHeader(buf);
  assert.equal(header.version, 1);
  assert.equal(header.chunkCount, 85);
  assert.equal(header.cs, 128);
  assert.equal(header.levels, 4);
  assert.equal(header.lat0, 35.36);
  assert.equal(header.lon0, 138.73);
});

test('parseTerrHeader rejects invalid magic or unsupported version', () => {
  const badMagic = new Uint8Array(64);
  assert.throws(() => parseTerrHeader(badMagic), /not a .terr file/);

  const badVersion = new Uint8Array(64);
  badVersion[0] = 77; badVersion[1] = 70; badVersion[2] = 83; badVersion[3] = 84;
  new DataView(badVersion.buffer).setUint16(4, 2, true); // version 2
  assert.throws(() => parseTerrHeader(badVersion), /unsupported .terr version/);
});

test('encodeChunk and decodeChunk round-trip terrain heights', () => {
  const n = S * S;
  const input = new Uint16Array(n);
  // Fill with simulated terrain: smooth slope + small variation
  for (let r = 0; r < S; r++) {
    for (let c = 0; c < S; c++) {
      input[r * S + c] = 500 + r * 10 + c * 5 + ((r * c) % 7);
    }
  }

  const encoded = encodeChunk(input);
  assert.ok(encoded.byteLength > 0);
  assert.ok(encoded.byteLength < n * 2); // Should achieve significant compression

  const decoded = new Uint16Array(n);
  decodeChunk(encoded, decoded);

  for (let i = 0; i < n; i++) {
    assert.equal(decoded[i], input[i], `Mismatch at index ${i}`);
  }
});

test('elevationColor maps elevation in meters to natural terrain colors', () => {
  // Low elevation: deep green
  const low = elevationColor(100);
  assert.ok(low[1] > low[0]); // Green > Red

  // Mid elevation (mountainside / rock): brownish
  const mid = elevationColor(2000);
  assert.ok(mid[0] > 0.3 && mid[1] > 0.2);

  // High peak (Fuji summit > 3500m): snow white
  const peak = elevationColor(3776);
  assert.ok(peak[0] > 0.8 && peak[1] > 0.8 && peak[2] > 0.8);
});

test('generateGridIndices creates standard triangle list for NxN grid', () => {
  const indices = generateGridIndices(2, 2); // 2x2 cells = 9 vertices, 2*2*2 = 8 triangles = 24 indices
  assert.equal(indices.length, 24);
  // Check index range
  for (let i = 0; i < indices.length; i++) {
    assert.ok(indices[i] >= 0 && indices[i] < 9);
  }
});
