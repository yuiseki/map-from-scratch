// examples/opfs/001-offline-pmtiles/bake.ts
import fs from 'node:fs';
import path from 'node:path';

// Hilbert curve calculation for PMTiles v3 tileId
const TZ = [0, 1, 5, 21, 85, 341, 1365];
function zxyToTileId(z: number, x: number, y: number): number {
  const n = 1 << z;
  let d = 0, xx = x, yy = y;
  for (let s = n >> 1; s >= 1; s >>= 1) {
    const rx = (xx & s) ? 1 : 0;
    const ry = (yy & s) ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { xx = s - 1 - xx; yy = s - 1 - yy; }
      const t = xx; xx = yy; yy = t;
    }
  }
  return TZ[z] + d;
}

function writeVarint(buf: number[], val: number): void {
  let v = val;
  while (v >= 0x80) {
    buf.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  buf.push(v);
}

// Convert GeoJSON lon/lat to Web Mercator [0, 1]
function mercX(lon: number): number {
  return (lon + 180) / 360;
}
function mercY(lat: number): number {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI;
}

// Clip polygon ring against tile box [x0, y0, x1, y1] (Sutherland-Hodgman)
type Point = [number, number];

function clipPolygon(ring: Point[], [x0, y0, x1, y1]: [number, number, number, number]): Point[] {
  let output = ring;

  // Left
  output = clipEdge(output, p => p[0] >= x0, (p1, p2) => [x0, p1[1] + (p2[1] - p1[1]) * ((x0 - p1[0]) / (p2[0] - p1[0]))]);
  // Right
  output = clipEdge(output, p => p[0] <= x1, (p1, p2) => [x1, p1[1] + (p2[1] - p1[1]) * ((x1 - p1[0]) / (p2[0] - p1[0]))]);
  // Top
  output = clipEdge(output, p => p[1] >= y0, (p1, p2) => [p1[0] + (p2[0] - p1[0]) * ((y0 - p1[1]) / (p2[1] - p1[1])), y0]);
  // Bottom
  output = clipEdge(output, p => p[1] <= y1, (p1, p2) => [p1[0] + (p2[0] - p1[0]) * ((y1 - p1[1]) / (p2[1] - p1[1])), y1]);

  return output;
}

function clipEdge(points: Point[], inside: (p: Point) => boolean, intersect: (p1: Point, p2: Point) => Point): Point[] {
  if (points.length < 3) return [];
  const out: Point[] = [];
  let s = points[points.length - 1];
  for (const e of points) {
    if (inside(e)) {
      if (inside(s)) {
        out.push(e);
      } else {
        out.push(intersect(s, e));
        out.push(e);
      }
    } else if (inside(s)) {
      out.push(intersect(s, e));
    }
    s = e;
  }
  return out;
}

async function main() {
  const rawPath = path.resolve('data/raw/ne_110m_land.geojson');
  if (!fs.existsSync(rawPath)) {
    throw new Error(`Missing raw data: ${rawPath}`);
  }

  const rawJson = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

  // Extract all rings as normalized Web Mercator coordinates [0, 1]
  const landRings: Point[][] = [];
  for (const feat of rawJson.features) {
    const geom = feat.geometry;
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) {
        landRings.push(ring.map(([lon, lat]: [number, number]) => [mercX(lon), mercY(lat)]));
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        for (const ring of poly) {
          landRings.push(ring.map(([lon, lat]: [number, number]) => [mercX(lon), mercY(lat)]));
        }
      }
    }
  }

  interface TileRecord {
    z: number;
    x: number;
    y: number;
    tileId: number;
    data: Buffer;
  }

  const tiles: TileRecord[] = [];

  // Generate tiles for zoom 0..2 (total 21 tiles)
  for (let z = 0; z <= 2; z++) {
    const n = 1 << z;
    const tileSpan = 1 / n;

    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const box: [number, number, number, number] = [
          x * tileSpan,
          y * tileSpan,
          (x + 1) * tileSpan,
          (y + 1) * tileSpan,
        ];

        const clippedRings: Point[][] = [];
        for (const ring of landRings) {
          const clipped = clipPolygon(ring, box);
          if (clipped.length >= 3) {
            clippedRings.push(clipped);
          }
        }

        // Pack tile binary format (extent: 4096)
        // uint16: numRings
        // for each ring:
        //   uint16: numPoints
        //   points: 2 x uint16 (x, y normalized to 0..4096)
        let totalBytes = 2;
        for (const r of clippedRings) {
          totalBytes += 2 + r.length * 4;
        }

        const tileBuf = Buffer.alloc(totalBytes);
        tileBuf.writeUInt16LE(clippedRings.length, 0);
        let ptr = 2;

        for (const r of clippedRings) {
          tileBuf.writeUInt16LE(r.length, ptr);
          ptr += 2;
          for (const [px, py] of r) {
            const lx = Math.max(0, Math.min(4096, Math.round(((px - box[0]) / tileSpan) * 4096)));
            const ly = Math.max(0, Math.min(4096, Math.round(((py - box[1]) / tileSpan) * 4096)));
            tileBuf.writeUInt16LE(lx, ptr);
            tileBuf.writeUInt16LE(ly, ptr + 2);
            ptr += 4;
          }
        }

        tiles.push({
          z,
          x,
          y,
          tileId: zxyToTileId(z, x, y),
          data: tileBuf,
        });
      }
    }
  }

  // Sort tiles by tileId ascending (PMTiles specification requirement)
  tiles.sort((a, b) => a.tileId - b.tileId);

  // Encode Root Directory
  const varints: number[] = [];
  const count = tiles.length;
  writeVarint(varints, count);

  // 1. TileId deltas
  let lastId = 0;
  for (const t of tiles) {
    writeVarint(varints, t.tileId - lastId);
    lastId = t.tileId;
  }

  // 2. Run lengths (all 1)
  for (let i = 0; i < count; i++) {
    writeVarint(varints, 1);
  }

  // 3. Lengths
  for (const t of tiles) {
    writeVarint(varints, t.data.length);
  }

  // 4. Offsets (first is stored + 1, subsequent are 0 for contiguous)
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      writeVarint(varints, 1); // 0 + 1
    } else {
      writeVarint(varints, 0); // contiguous
    }
  }

  const rootDirBuf = Buffer.from(varints);

  // Build tile payload section
  const tilePayloads = Buffer.concat(tiles.map(t => t.data));

  // Build 127-byte PMTiles v3 Header
  const headerBuf = Buffer.alloc(127);
  headerBuf.write('PMTiles', 0, 7, 'ascii');
  headerBuf.writeUInt8(3, 7); // version 3

  const rootOffset = 127;
  const rootLength = rootDirBuf.length;
  const dataOffset = rootOffset + rootLength;
  const dataLength = tilePayloads.length;

  headerBuf.writeBigUInt64LE(BigInt(rootOffset), 8);
  headerBuf.writeBigUInt64LE(BigInt(rootLength), 16);
  headerBuf.writeBigUInt64LE(0n, 24); // meta offset
  headerBuf.writeBigUInt64LE(0n, 32); // meta length
  headerBuf.writeBigUInt64LE(0n, 40); // leaf offset
  headerBuf.writeBigUInt64LE(0n, 48); // leaf length
  headerBuf.writeBigUInt64LE(BigInt(dataOffset), 56);
  headerBuf.writeBigUInt64LE(BigInt(dataLength), 64);

  headerBuf.writeBigUInt64LE(BigInt(count), 72); // numAddressedTiles
  headerBuf.writeBigUInt64LE(BigInt(count), 80); // numTileEntries
  headerBuf.writeBigUInt64LE(BigInt(count), 88); // numTileContents

  headerBuf.writeUInt8(1, 96); // clustered
  headerBuf.writeUInt8(0, 97); // internal_compression: 0 (None)
  headerBuf.writeUInt8(0, 98); // tile_compression: 0 (None)
  headerBuf.writeUInt8(1, 99); // tile_type: 1 (MVT / vector)
  headerBuf.writeUInt8(0, 100); // min_zoom: 0
  headerBuf.writeUInt8(2, 101); // max_zoom: 2

  // Bounds: [-180, -85, 180, 85] in E7
  headerBuf.writeInt32LE(-180 * 1e7, 102);
  headerBuf.writeInt32LE(-85 * 1e7, 106);
  headerBuf.writeInt32LE(180 * 1e7, 110);
  headerBuf.writeInt32LE(85 * 1e7, 114);

  // Center: [0, 0, 0]
  headerBuf.writeUInt8(0, 118); // center zoom
  headerBuf.writeInt32LE(0, 119); // center lon E7
  headerBuf.writeInt32LE(0, 123); // center lat E7

  const fullArchive = Buffer.concat([headerBuf, rootDirBuf, tilePayloads]);

  const outDir = path.resolve('data/baked/opfs-001-offline-pmtiles');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'world.pmtiles');
  fs.writeFileSync(outPath, fullArchive);

  console.log(`Bake complete: ${outPath} (${(fullArchive.length / 1024).toFixed(1)} KB, ${count} tiles)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
