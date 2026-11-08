// Reader for mapbox/earcut's bench/tiles-fixture.bin: 119,680 real MVT
// polygons (4.6 MB), the set upstream benchmarks and checks earcut on. The
// file is not committed here; `ref-repos/clone.sh earcut` fetches it.
//
// Format (LEB128 unsigned varints throughout):
//   file    := tile*
//   tile    := zoom featureCount feature*
//   feature := geomLen geom      (geomLen = number of varints in geom)
//   geom    := MVT command and zigzag delta-coded parameter integers
// Rings are grouped into polygons by the sign of their area, as the MVT spec
// says: a positive ring starts a polygon, negative rings are its holes.
import { readFileSync } from 'node:fs';
import { flatten, type Flat } from '../kits/earcut/earcut.ts';

export const TILES_FIXTURE = new URL('../ref-repos/mapbox__earcut/bench/tiles-fixture.bin', import.meta.url);

export interface TilePolygon extends Flat { z: number }

export function readTilesFixture(path: URL | string = TILES_FIXTURE): TilePolygon[] {
  const buf = readFileSync(path);
  let pos = 0;
  const varint = (): number => {
    let val = 0, shift = 0, b: number;
    do {
      b = buf[pos++];
      val |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    return val >>> 0;
  };
  const polys: TilePolygon[] = [];
  while (pos < buf.length) {
    const z = varint();
    const features = varint();
    for (let f = 0; f < features; f++) {
      const count = varint();
      const geom = new Array<number>(count);
      for (let i = 0; i < count; i++) geom[i] = varint();
      let current: number[][][] | null = null;
      for (const ring of decodeRings(geom)) {
        if (ring.length < 3) continue;
        const area = ringArea(ring);
        if (area === 0) continue;
        if (area > 0) {
          if (current) polys.push({ ...flatten(current), z });
          current = [ring];
        } else if (current) current.push(ring);
      }
      if (current) polys.push({ ...flatten(current), z });
    }
  }
  return polys;
}

function decodeRings(geom: number[]): number[][][] {
  const rings: number[][][] = [];
  let x = 0, y = 0, i = 0;
  let ring: number[][] | null = null;
  const zigzag = (n: number): number => (n >> 1) ^ -(n & 1);
  while (i < geom.length) {
    const cmd = geom[i] & 7, count = geom[i] >> 3;
    i++;
    if (cmd === 1) {
      for (let k = 0; k < count; k++) {
        x += zigzag(geom[i++]);
        y += zigzag(geom[i++]);
        if (ring) rings.push(ring);
        ring = [[x, y]];
      }
    } else if (cmd === 2) {
      for (let k = 0; k < count; k++) {
        x += zigzag(geom[i++]);
        y += zigzag(geom[i++]);
        ring!.push([x, y]);
      }
    } else if (cmd === 7 && ring) {
      rings.push(ring);
      ring = null;
    }
  }
  if (ring) rings.push(ring);
  return rings;
}

function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[i][1] + ring[j][1]);
  return sum / 2;
}
