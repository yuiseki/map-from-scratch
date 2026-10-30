import { origTile } from './terrain.js';
import { createRenderer } from './gl.js';
const PLANET = '../../data/raw/mapterhorn/planet.pmtiles';
function varints(u8) {
    let pos = 0;
    return ()=>{
        let v = 0, shift = 1, b;
        do {
            b = u8[pos++];
            v += (b & 0x7f) * shift;
            shift *= 128;
        }while (b & 0x80)
        return v;
    };
}
function directory(u8) {
    const next = varints(u8), n = next(), e = [];
    let last = 0;
    for(let i = 0; i < n; i++){
        last += next();
        e.push({
            tileId: last,
            offset: 0,
            length: 0,
            runLength: 0
        });
    }
    for (const x of e)x.runLength = next();
    for (const x of e)x.length = next();
    e.forEach((x, i)=>{
        const v = next();
        x.offset = v === 0 && i > 0 ? e[i - 1].offset + e[i - 1].length : v - 1;
    });
    return e;
}
function find(entries, id) {
    let lo = 0, hi = entries.length - 1, hit = 0;
    while(lo <= hi){
        const mid = lo + hi >> 1;
        if (entries[mid].tileId <= id) {
            hit = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return entries[hit];
}
function tileId(z, x, y) {
    let acc = 0;
    for(let t = 0; t < z; t++)acc += 4 ** t;
    const n = 2 ** z;
    let d = 0;
    for(let s = n / 2; s >= 1; s /= 2){
        const rx = x & s ? 1 : 0, ry = y & s ? 1 : 0;
        d += s * s * (3 * rx ^ ry);
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
    return acc + d;
}
const gunzip = async (u8)=>new Uint8Array(await new Response(new Blob([
        u8
    ]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
export const HEIGHT_TERRARIUM = (t)=>`uniform highp sampler2DArray u_tiles;
uniform highp usampler2DArray u_lut;
uniform ivec2 u_lutOrg[4];
uint layerOf(ivec2 tile) {
  ivec2 l = tile - u_lutOrg[g_level];
  if (any(lessThan(l, ivec2(0))) || any(greaterThan(l, ivec2(7)))) return 0u;
  return texelFetch(u_lut, ivec3(l, g_level), 0).r;
}
float H(int u, int v) {
  ivec2 base = (ivec2(${t.x0}, ${t.y0}) >> g_level) + g_org, g = base + ivec2(u, v), own = base >> 9;
  uint layer = layerOf(g >> 9);
  if (layer == 0u) { g = clamp(g, own * 512, own * 512 + 511); layer = layerOf(own); }
  vec3 c = round(texelFetch(u_tiles, ivec3(g & 511, int(layer) - 1), 0).rgb * 255.0);
  return c.r * 256.0 + c.g + c.b / 256.0 - 32768.0;
}`;
export async function origReader(gl, t) {
    const net = {
        requests: 0,
        bytes: 0
    };
    const read = async (start, length)=>{
        net.requests++;
        const r = await fetch(PLANET, {
            headers: {
                Range: `bytes=${start}-${start + length - 1}`
            }
        });
        if (r.status !== 206) throw new Error(`planet.pmtiles: HTTP ${r.status}`);
        const u8 = new Uint8Array(await r.arrayBuffer());
        net.bytes += u8.length;
        return u8;
    };
    let tiles = gl.createTexture(), layers = new Map();
    const lut = gl.createTexture();
    const lutOrg = new Int32Array(8);
    for(let k = 0; k < 4; k++){
        lutOrg[2 * k] = (t.x0 >> k >> 9) - 1;
        lutOrg[2 * k + 1] = (t.y0 >> k >> 9) - 1;
    }
    const renderer = createRenderer(gl, HEIGHT_TERRARIUM(t), (p)=>{
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tiles);
        gl.uniform1i(gl.getUniformLocation(p, 'u_tiles'), 1);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, lut);
        gl.uniform1i(gl.getUniformLocation(p, 'u_lut'), 2);
        gl.uniform2iv(gl.getUniformLocation(p, 'u_lutOrg'), lutOrg);
        gl.activeTexture(gl.TEXTURE0);
    });
    async function load(ids) {
        net.requests = net.bytes = 0;
        const t0 = performance.now();
        const head = await read(0, 16384), dv = new DataView(head.buffer);
        const u64 = (o)=>Number(dv.getBigUint64(o, true));
        const [rootOff, rootLen, leafOff, dataOff] = [
            u64(8),
            u64(16),
            u64(40),
            u64(56)
        ];
        if (head[97] !== 2 || head[99] !== 4) throw new Error('planet.pmtiles: expected gzip directories and WebP tiles');
        const root = directory(await gunzip(head.subarray(rootOff, rootOff + rootLen)));
        const want = new Map();
        for (const id of ids)want.set(origTile(t, t.chunks[id]).join('/'), origTile(t, t.chunks[id]));
        const leafOf = new Map(), leaves = new Map();
        for (const [key, [z, x, y]] of want){
            const e = find(root, tileId(z, x, y));
            if (e.runLength !== 0) throw new Error('expected a leaf directory');
            leafOf.set(key, e);
            if (!leaves.has(e.offset)) leaves.set(e.offset, read(leafOff + e.offset, e.length).then(gunzip).then(directory));
        }
        gl.deleteTexture(tiles);
        tiles = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tiles);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 512, 512, want.size);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        layers = new Map();
        let decodeMs = 0, tileBytes = 0;
        await Promise.all([
            ...want
        ].map(async ([key, [z, x, y]], layer)=>{
            const e = find(await leaves.get(leafOf.get(key).offset), tileId(z, x, y));
            const webp = await read(dataOff + e.offset, e.length);
            tileBytes += webp.length;
            const d0 = performance.now();
            const bmp = await createImageBitmap(new Blob([
                webp
            ], {
                type: 'image/webp'
            }), {
                colorSpaceConversion: 'none',
                premultiplyAlpha: 'none'
            });
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, tiles);
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, 512, 512, 1, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
            bmp.close();
            decodeMs += performance.now() - d0;
            layers.set(key, layer);
        }));
        const l = new Uint8Array(8 * 8 * 4);
        for (const [key, layer] of layers){
            const [z, x, y] = key.split('/').map(Number), k = 12 - z;
            l[k * 64 + (y - lutOrg[2 * k + 1]) * 8 + x - lutOrg[2 * k]] = layer + 1;
        }
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, lut);
        gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8UI, 8, 8, 4, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, l);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return {
            ms: performance.now() - t0,
            decodeMs,
            tileBytes,
            tiles: want.size,
            requests: net.requests,
            bytes: net.bytes
        };
    }
    function texel(gx, gy) {
        const layer = layers.get(`12/${gx >> 9}/${gy >> 9}`);
        if (layer === undefined) return null;
        const fb = gl.createFramebuffer(), px = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tiles, 0, layer);
        gl.readPixels(gx & 511, gy & 511, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
        return px[0] * 65536 + px[1] * 256 + px[2];
    }
    const draw = (view, ids, target, clear)=>renderer.draw(t, view, ids, target, clear);
    return {
        load,
        draw,
        texel,
        release: ()=>{
            gl.deleteTexture(tiles);
            tiles = gl.createTexture();
        }
    };
}
