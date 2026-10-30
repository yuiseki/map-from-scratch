// The PMTiles v3 operations this one raster viewer needs: header, gzip
// directories and JPEG tile bytes. Each request is an explicit HTTP Range.
// Format: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
const URL = 'https://z.yuiseki.net/static/gsi/seamlessphoto/seamlessphoto512.pmtiles';
interface Entry { id: number; offset: number; length: number; run: number }
interface Header { root: number; rootLength: number; leaves: number; data: number; minZoom: number; maxZoom: number }
const T = [0, 1, 5, 21, 85, 341, 1365, 5461, 21845, 87381, 349525, 1398101, 5592405, 22369621, 89478485, 357913941, 1431655765, 5726623061];

async function read(start: number, length: number): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(URL, { headers: { Range: `bytes=${start}-${start + length - 1}` }, cache: 'no-store' });
    if (response.status === 200) {
      await response.body?.cancel();
      continue;
    }
    if (response.status !== 206) throw new Error(`写真データの Range 読み込み: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== length) throw new Error(`写真データの長さが違います: ${bytes.length} / ${length}`);
    const span = response.headers.get('content-range');
    if (span && !span.startsWith(`bytes ${start}-${start + length - 1}/`)) throw new Error(`写真データの Content-Range が違います: ${span}`);
    return bytes;
  }
  throw new Error('写真データの Range 要求が繰り返し HTTP 200 になりました');
}

async function ungzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function directory(bytes: Uint8Array): Entry[] {
  let p = 0;
  const varint = (): number => {
    let value = 0, factor = 1, byte: number;
    do {
      if (p >= bytes.length) throw new Error('PMTiles の索引が途中で終わりました');
      byte = bytes[p++];
      value += (byte & 127) * factor;
      factor *= 128;
    } while (byte & 128);
    return value;
  };
  const count = varint(), entries: Entry[] = [];
  let id = 0;
  for (let i = 0; i < count; i++) { id += varint(); entries.push({ id, offset: 0, length: 0, run: 0 }); }
  for (const entry of entries) entry.run = varint();
  for (const entry of entries) entry.length = varint();
  for (let i = 0; i < count; i++) {
    const value = varint();
    entries[i].offset = value === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : value - 1;
  }
  return entries;
}

function tileId(z: number, x: number, y: number): number {
  const n = 2 ** z;
  let id = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) ? 1 : 0, ry = (y & s) ? 1 : 0;
    id += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      [x, y] = [y, x];
    }
  }
  return T[z] + id;
}

function find(entries: Entry[], id: number): Entry | null {
  let lo = 0, hi = entries.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].id <= id) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return hit < 0 ? null : entries[hit];
}

export async function openArchive() {
  const first = await read(0, 16384);
  const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
  if (new TextDecoder().decode(first.subarray(0, 7)) !== 'PMTiles' || first[7] !== 3) throw new Error('PMTiles v3 ではありません');
  const u64 = (offset: number) => Number(view.getBigUint64(offset, true));
  const h: Header = { root: u64(8), rootLength: u64(16), leaves: u64(40), data: u64(56), minZoom: first[100], maxZoom: first[101] };
  if (h.root + h.rootLength > first.length) throw new Error('PMTiles のルート索引が先頭範囲を超えています');
  if (first[97] !== 2 || first[98] !== 1 || first[99] !== 3) throw new Error('想定外の PMTiles 圧縮形式です');
  const root = directory(await ungzip(first.subarray(h.root, h.root + h.rootLength)));
  const leaves = new Map<string, Promise<Entry[]>>();
  async function tile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    if (z < h.minZoom || z > h.maxZoom || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return null;
    const id = tileId(z, x, y);
    let entries = root;
    for (let depth = 0; depth < 4; depth++) {
      const entry = find(entries, id);
      if (!entry) return null;
      if (entry.run !== 0) return id - entry.id < entry.run ? read(h.data + entry.offset, entry.length) : null;
      const key = `${entry.offset}:${entry.length}`;
      let leaf = leaves.get(key);
      if (!leaf) {
        leaf = read(h.leaves + entry.offset, entry.length).then(ungzip).then(directory);
        leaves.set(key, leaf);
      }
      entries = await leaf;
    }
    throw new Error('PMTiles の索引が深すぎます');
  }
  return { tile, minZoom: h.minZoom, maxZoom: h.maxZoom };
}
