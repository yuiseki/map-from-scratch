// examples/opfs/001-offline-pmtiles/worker.ts

// Hilbert tile id calculator
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

interface TileEntry {
  offset: number;
  length: number;
}

let syncHandle: any = null;
let dataOffset = 0;
const tileEntries = new Map<number, TileEntry>();

let totalSyncReads = 0;
let totalSyncLatencyMs = 0;
let opfsSize = 0;

function readVarint(u8: Uint8Array, p: { pos: number }): number {
  let v = 0, shift = 1, b: number;
  do {
    b = u8[p.pos++];
    v += (b & 0x7f) * shift;
    shift *= 128;
  } while (b & 0x80);
  return v;
}

function parseDirectory(u8: Uint8Array): Map<number, TileEntry> {
  const p = { pos: 0 };
  const n = readVarint(u8, p);
  const map = new Map<number, TileEntry>();
  const ids: number[] = [];
  const runLengths: number[] = [];
  const lengths: number[] = [];
  const offsets: number[] = [];

  let last = 0;
  for (let i = 0; i < n; i++) {
    last += readVarint(u8, p);
    ids.push(last);
  }
  for (let i = 0; i < n; i++) {
    runLengths.push(readVarint(u8, p));
  }
  for (let i = 0; i < n; i++) {
    lengths.push(readVarint(u8, p));
  }
  for (let i = 0; i < n; i++) {
    const v = readVarint(u8, p);
    if (v === 0 && i > 0) {
      offsets.push(offsets[i - 1] + lengths[i - 1]);
    } else {
      offsets.push(v - 1);
    }
  }

  for (let i = 0; i < n; i++) {
    map.set(ids[i], { offset: offsets[i], length: lengths[i] });
  }
  return map;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const fileHandle = await opfsRoot.getFileHandle('world.pmtiles', { create: true });

      // Check current size in OPFS
      const existingFile = await fileHandle.getFile();
      if (existingFile.size === 0) {
        // Fetch archive once and store into OPFS
        const res = await fetch(msg.archiveUrl);
        if (!res.ok) throw new Error(`Failed to fetch PMTiles: ${res.status}`);
        const ab = await res.arrayBuffer();
        const writable = await fileHandle.createWritable();
        await writable.write(ab);
        await writable.close();
      }

      // Create synchronous access handle (Web Worker exclusive API)
      syncHandle = await (fileHandle as any).createSyncAccessHandle();
      opfsSize = syncHandle.getSize();

      // Read PMTiles v3 Header synchronously
      const headerBuf = new Uint8Array(127);
      syncHandle.read(headerBuf, { at: 0 });

      const dv = new DataView(headerBuf.buffer);
      const rootOff = Number(dv.getBigUint64(8, true));
      const rootLen = Number(dv.getBigUint64(16, true));
      dataOffset = Number(dv.getBigUint64(56, true));
      const minZoom = headerBuf[100];
      const maxZoom = headerBuf[101];

      // Read Root Directory synchronously
      const rootDirBuf = new Uint8Array(rootLen);
      syncHandle.read(rootDirBuf, { at: rootOff });
      const dirMap = parseDirectory(rootDirBuf);
      dirMap.forEach((v, k) => tileEntries.set(k, v));

      self.postMessage({
        type: 'ready',
        opfsSize,
        minZoom,
        maxZoom,
        tileCount: tileEntries.size,
      });
    } catch (err: any) {
      self.postMessage({ type: 'error', message: err?.message || String(err) });
    }
    return;
  }

  if (msg.type === 'getTile') {
    const { z, x, y, id } = msg;
    const tileId = zxyToTileId(z, x, y);
    const entry = tileEntries.get(tileId);

    if (!entry) {
      self.postMessage({ type: 'tile', id, z, x, y, rings: [], latency: 0 });
      return;
    }

    const t0 = performance.now();
    const tileBuf = new Uint8Array(entry.length);
    const bytesRead = syncHandle.read(tileBuf, { at: dataOffset + entry.offset });
    const latency = performance.now() - t0;

    totalSyncReads++;
    totalSyncLatencyMs += latency;

    // Decode tile rings
    // Format: uint16 numRings, then for each ring: uint16 numPoints, points (2 x uint16)
    const dv = new DataView(tileBuf.buffer, tileBuf.byteOffset, tileBuf.byteLength);
    const numRings = dv.getUint16(0, true);
    let ptr = 2;
    const rings: Float32Array[] = [];

    for (let r = 0; r < numRings; r++) {
      const numPoints = dv.getUint16(ptr, true);
      ptr += 2;
      const pts = new Float32Array(numPoints * 2);
      for (let i = 0; i < numPoints * 2; i += 2) {
        pts[i] = dv.getUint16(ptr, true) / 4096; // normalized 0..1 in tile
        pts[i + 1] = dv.getUint16(ptr + 2, true) / 4096;
        ptr += 4;
      }
      rings.push(pts);
    }

    self.postMessage(
      { type: 'tile', id, z, x, y, rings, latency, bytesRead },
      rings.map(r => r.buffer) as any
    );
    return;
  }

  if (msg.type === 'getStats') {
    self.postMessage({
      type: 'stats',
      totalSyncReads,
      avgLatencyMs: totalSyncReads > 0 ? totalSyncLatencyMs / totalSyncReads : 0,
      opfsSize,
    });
    return;
  }
};
