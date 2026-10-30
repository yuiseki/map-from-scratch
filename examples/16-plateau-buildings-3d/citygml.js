import { emit, glRenderer } from '../../harness/page/bench.js';
import { TAIL, endRecord, entries, dataStart, meshOf, memberRange } from './zip.js';
import { GmlReader } from './gml.js';
import { place, buildTile, areaMeshes, NT } from './mesh.js';
import { Archive, Loader, decodeGround, inflate } from './plb.js';
import { createView } from './render.js';
import { VIEWS } from './camera.js';
const RAW = '../../data/raw/plateau/', BASE = '../../data/baked/16-plateau-buildings-3d/';
const PLB = BASE + 'tokyo-station-2km.v1.plb';
export async function run(canvas) {
    let requests = 0, bytes = 0;
    const progress = [];
    const watchdog = setTimeout(()=>emit({
            error: `citygml mode stalled: ${progress.join(' ')}`
        }), 200000);
    const get = async (url, range)=>{
        requests++;
        progress.push(`get${requests}@${Math.round(performance.now())}`);
        const r = await fetch(url, {
            headers: {
                Range: range
            }
        });
        progress.push(`hdr${requests}@${Math.round(performance.now())}`);
        if (r.status !== 206) throw new Error(`${url} ${range}: HTTP ${r.status}`);
        const b = new Uint8Array(await r.arrayBuffer());
        bytes += b.byteLength;
        return {
            b,
            size: Number(r.headers.get('content-range').split('/')[1])
        };
    };
    const zips = await Promise.all([
        'chiyoda.zip',
        'chuo.zip'
    ].map(async (name)=>{
        const url = RAW + name, tail = await get(url, `bytes=-${TAIL}`), end = endRecord(tail.b, tail.size);
        return {
            url,
            list: entries((await get(url, `bytes=${end.cdOff}-${end.cdOff + end.cdLen - 1}`)).b)
        };
    }));
    const cdDone = performance.now();
    const members = areaMeshes().map((m)=>{
        for (const z of zips){
            const e = z.list.find((x)=>meshOf(x.name) === m);
            if (e) return {
                url: z.url,
                e
            };
        }
        throw new Error(`mesh ${m} in neither zip`);
    });
    const placed = [];
    let parseMs = 0, xml = 0;
    const queue = [
        ...members
    ];
    await Promise.all(Array.from({
        length: 6
    }, async ()=>{
        for(let m = queue.shift(); m; m = queue.shift()){
            const [a, b] = memberRange(m.e);
            const buf = (await get(m.url, `bytes=${a}-${b - 1}`)).b, start = dataStart(buf);
            const t = performance.now();
            const text = new Blob([
                buf.subarray(start, start + m.e.compSize)
            ]).stream().pipeThrough(new DecompressionStream('deflate-raw')).pipeThrough(new TextDecoderStream()).getReader();
            const reader = new GmlReader((bl)=>{
                const p = place(bl);
                if (p) placed.push(p);
            });
            for(let r = await text.read(); !r.done; r = await text.read()){
                reader.push(r.value);
                xml += r.value.length;
            }
            reader.end();
            parseMs += performance.now() - t;
            progress.push(`${meshOf(m.e.name)}:fetched@${Math.round(t)},parsed@${Math.round(performance.now())}`);
        }
    }));
    const parsed = performance.now();
    const byTile = new Map();
    for (const p of placed)byTile.set(p.tile, [
        ...byTile.get(p.tile) ?? [],
        p
    ]);
    const built = [
        ...byTile
    ].map(([t, items])=>buildTile(t, items));
    const meshed = performance.now();
    const ar = new Archive(PLB), h = await ar.open(), g0 = h.ground[0];
    const ground = decodeGround(await inflate(ar.head.subarray(g0 + 8, g0 + h.ground[1])), ar.head.subarray(g0, g0 + 8));
    const view = await createView(canvas, Promise.resolve({
        h,
        ground
    }), {
        sync: true
    });
    for (const tm of built){
        const i = h.tiles.findIndex((t)=>t.tx === tm.tile % NT && t.ty === Math.floor(tm.tile / NT));
        tm.levels.forEach((l, k)=>view.add(i, k, l));
    }
    Object.assign(view.cam, VIEWS.V1);
    const gl = view.gl, W = gl.canvas.width, H = gl.canvas.height;
    view.draw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    emit({
        metric: 'citygml_first_frame_ms',
        value: performance.now()
    });
    emit({
        metric: 'citygml_range_bytes',
        value: bytes
    });
    emit({
        metric: 'citygml_range_requests',
        value: requests
    });
    emit({
        metric: 'citygml_ground_bytes',
        value: ar.bytes
    });
    emit({
        info: {
            gpu: glRenderer(gl),
            citygml_directories_ms: Math.round(cdDone),
            citygml_members_parsed_ms: Math.round(parsed),
            citygml_inflate_parse_ms_sum: Math.round(parseMs),
            citygml_xml_chars: xml,
            citygml_triangulate_ms: Math.round(meshed - parsed),
            buildings: placed.length
        }
    });
    const px = ()=>{
        const p = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, p);
        return p;
    };
    const a = px();
    const truth = await (await fetch(BASE + 'truth.json')).json();
    const want = [
        0,
        1
    ].map((l)=>Object.values(truth.tiles).reduce((s, t)=>s + t.tri[l], 0));
    const got = [
        0,
        1
    ].map((l)=>built.reduce((s, t)=>s + t.levels[l].idx.length / 3 + t.levels[l].dropped, 0));
    view.reset();
    const whole = new Archive(PLB);
    await whole.open(true);
    const all = new Loader(whole, h, (t, l, m)=>view.add(t, l, m));
    all.want(h.tiles.flatMap((_, i)=>[
            2 * i,
            2 * i + 1
        ]));
    while(all.inflight || h.tiles.some((_, i)=>!view.has(2 * i) || !view.has(2 * i + 1)))await new Promise((r)=>setTimeout(r, 20));
    view.draw();
    const b = px();
    let diff = 0;
    for(let i = 0; i < a.length; i += 4)if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
    const same = placed.length === truth.buildings && got[0] === want[0] && got[1] === want[1] && diff / (W * H) < 0.01;
    const detail = `buildings ${placed.length}/${truth.buildings}, triangles+dropped ${got.join('+')} vs ${want.join('+')}, ${(100 * diff / (W * H)).toFixed(3)}% pixels differ from PLB`;
    emit({
        check: 'citygml-same-scene',
        pass: same,
        detail
    });
    emit({
        info: {
            citygml_same_scene: `${same ? 'PASS' : 'FAIL'} ${detail}`
        }
    });
    clearTimeout(watchdog);
    emit({
        info: {
            citygml_progress: progress.join(' ')
        }
    });
    emit({
        done: true
    });
}
