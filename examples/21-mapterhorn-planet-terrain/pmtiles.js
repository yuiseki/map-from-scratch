const MANIFEST = 'https://download.mapterhorn.com/download_urls.json';
const T = [
    0,
    1,
    5,
    21,
    85,
    341,
    1365,
    5461,
    21845,
    87381,
    349525,
    1398101,
    5592405,
    22369621,
    89478485,
    357913941,
    1431655765,
    5726623061,
    22906492245
];
export const rangeStats = {
    requests: 0,
    bytes: 0
};
export const tileStats = {
    requests: 0,
    bytes: 0
};
async function read(url, start, length) {
    for(let attempt = 0; attempt < 4; attempt++){
        const requestUrl = new URL(url);
        if (attempt) requestUrl.searchParams.set('retry', String(attempt));
        const response = await fetch(requestUrl, {
            headers: {
                Range: `bytes=${start}-${start + length - 1}`
            },
            cache: 'no-store'
        });
        if (response.status === 200) {
            await response.body?.cancel();
            continue;
        }
        if (response.status !== 206) throw new Error(`標高データの Range 読み込み: HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== length) throw new Error(`標高データの長さが違います: ${bytes.length} / ${length}`);
        const span = response.headers.get('content-range');
        if (span && !span.startsWith(`bytes ${start}-${start + length - 1}/`)) throw new Error(`標高データの Content-Range が違います: ${span}`);
        rangeStats.requests++;
        rangeStats.bytes += bytes.length;
        return bytes;
    }
    throw new Error('標高データのサーバーが HTTP Range に応答しません');
}
async function ungzip(bytes) {
    const stream = new Blob([
        Uint8Array.from(bytes)
    ]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
function directory(bytes) {
    let p = 0;
    const varint = ()=>{
        let value = 0, factor = 1, byte;
        do {
            if (p >= bytes.length) throw new Error('PMTiles の索引が途中で終わりました');
            byte = bytes[p++];
            value += (byte & 127) * factor;
            factor *= 128;
        }while (byte & 128)
        return value;
    };
    const count = varint(), entries = [];
    let id = 0;
    for(let i = 0; i < count; i++){
        id += varint();
        entries.push({
            id,
            offset: 0,
            length: 0,
            run: 0
        });
    }
    for (const entry of entries)entry.run = varint();
    for (const entry of entries)entry.length = varint();
    for(let i = 0; i < count; i++){
        const value = varint();
        entries[i].offset = value === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : value - 1;
    }
    return entries;
}
function tileId(z, x, y) {
    const n = 2 ** z;
    let id = 0;
    for(let s = n / 2; s >= 1; s /= 2){
        const rx = x & s ? 1 : 0, ry = y & s ? 1 : 0;
        id += s * s * (3 * rx ^ ry);
        if (ry === 0) {
            if (rx === 1) {
                x = s - 1 - x;
                y = s - 1 - y;
            }
            [x, y] = [
                y,
                x
            ];
        }
    }
    return T[z] + id;
}
function find(entries, id) {
    let lo = 0, hi = entries.length - 1, hit = -1;
    while(lo <= hi){
        const mid = lo + hi >> 1;
        if (entries[mid].id <= id) {
            hit = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return hit < 0 ? null : entries[hit];
}
async function openArchiveAt(url, size) {
    const first = await read(url, 0, Math.min(16384, size));
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
    if (new TextDecoder().decode(first.subarray(0, 7)) !== 'PMTiles' || first[7] !== 3) throw new Error('PMTiles v3 ではありません');
    const u64 = (offset)=>Number(view.getBigUint64(offset, true));
    const h = {
        root: u64(8),
        rootLength: u64(16),
        leaves: u64(40),
        data: u64(56),
        minZoom: first[100],
        maxZoom: first[101]
    };
    if (h.rootLength < 1) throw new Error('PMTiles のルート索引がありません');
    if (first[97] !== 2 || first[98] !== 1 || first[99] !== 4) throw new Error('想定外の PMTiles 圧縮形式です');
    const rootBytes = h.root + h.rootLength <= first.length ? first.subarray(h.root, h.root + h.rootLength) : await read(url, h.root, h.rootLength);
    const root = directory(await ungzip(rootBytes));
    const leaves = new Map();
    async function tile(z, x, y) {
        if (z < h.minZoom || z > h.maxZoom || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return null;
        const id = tileId(z, x, y);
        let entries = root;
        for(let depth = 0; depth < 4; depth++){
            const entry = find(entries, id);
            if (!entry) return null;
            if (entry.run !== 0) return id - entry.id < entry.run ? read(url, h.data + entry.offset, entry.length) : null;
            const key = `${entry.offset}:${entry.length}`;
            let leaf = leaves.get(key);
            if (!leaf) {
                leaf = read(url, h.leaves + entry.offset, entry.length).then(ungzip).then(directory);
                leaves.set(key, leaf);
            }
            entries = await leaf;
        }
        throw new Error('PMTiles の索引が深すぎます');
    }
    return {
        tile,
        minZoom: h.minZoom,
        maxZoom: h.maxZoom
    };
}
export async function openArchive() {
    let areas = null;
    const ready = fetch(MANIFEST).then(async (response)=>{
        if (!response.ok) throw new Error(`Mapterhorn のアーカイブ一覧: HTTP ${response.status}`);
        const manifest = await response.json();
        if (!Array.isArray(manifest.items)) throw new Error('Mapterhorn のアーカイブ一覧が読めません');
        areas = manifest.items.filter((item)=>item.min_zoom >= 13);
    });
    const archives = new Map();
    const areaAt = (lon, lat)=>areas?.find((a)=>lon >= a.min_lon && lon < a.max_lon && lat >= a.min_lat && lat < a.max_lat);
    async function terrainTile(z, x, y) {
        if (z > 18 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return null;
        if (z <= 12) {
            const response = await fetch(`https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`);
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`全球標高タイル: HTTP ${response.status}`);
            if (!response.headers.get('content-type')?.startsWith('image/webp')) throw new Error('全球標高タイルが WebP ではありません');
            const bytes = new Uint8Array(await response.arrayBuffer());
            tileStats.requests++;
            tileStats.bytes += bytes.length;
            return bytes;
        }
        await ready;
        const n = 2 ** z;
        const lon = (x + 0.5) / n * 360 - 180;
        const lat = (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * (y + 0.5) / n))) - Math.PI / 2) * 180 / Math.PI;
        const item = areaAt(lon, lat);
        if (!item || z < item.min_zoom || z > item.max_zoom) return null;
        let archive = archives.get(item.url);
        if (!archive) {
            archive = openArchiveAt(item.url, item.size).catch((reason)=>{
                archives.delete(item.url);
                throw reason;
            });
            archives.set(item.url, archive);
        }
        return (await archive).tile(z, x, y);
    }
    return {
        tile: terrainTile,
        ready,
        maxZoomAt: (lon, lat)=>areaAt(lon, lat)?.max_zoom ?? 12
    };
}
