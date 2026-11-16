import { decodePanels, formatPeople, formatPercent, valueAt } from './data.js';
import { applyCss, cameraEye, clipMatrix, cssTransform, drag, facing, multiply, panelModel, toClip, unitVector, zoom } from './geometry.js';
import { Globe } from './globe.js';
const DATA = '../../../data/baked/htmlcanvas-003-globe-html-panels/';
export const PANEL_W = 232, PANEL_H = 172, WORLD_PER_PX = 1 / 450;
const MIN_FACING = 0.09;
const query = new URLSearchParams(location.search);
const scene = document.getElementById('scene');
const canvas = document.getElementById('globe');
const overlay = document.getElementById('overlay');
const status = document.getElementById('status');
const list = document.getElementById('bookmarks');
const goto = document.getElementById('goto');
if (!query.has('fallback')) canvas.setAttribute('content', 'drawable');
const drawable = canvas.content === 'drawable' && 'texElementSubImage2D' in WebGL2RenderingContext.prototype;
if (!drawable) canvas.removeAttribute('content');
status.textContent = drawable ? 'HTML-in-Canvas: パネルは canvas の子要素。texElementSubImage2D で貼り、updateElementGeometry で当たり判定を描いた位置へ' : 'フォールバック: このブラウザに HTML-in-Canvas が無いので、パネルは canvas の上の DOM (CSS matrix3d)';
status.className = drawable ? '' : 'fallback';
const [panels, image] = await Promise.all([
    fetch(DATA + 'panels.json').then((r)=>r.json()).then(decodePanels),
    new Promise((resolve, reject)=>{
        const img = new Image();
        img.onload = ()=>resolve(img);
        img.onerror = reject;
        img.src = DATA + 'earth.jpg';
    })
]);
const globe = new Globe(canvas, image, panels.places);
let cam = {
    lon: -25,
    lat: 22,
    distance: 2.8
};
const bookmarks = new Set();
let uploads = 0, reorders = 0;
const uploadMs = [];
const geometryMs = [];
let firstFrameMs = 0;
const h = (tag, cls, text = '')=>{
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.textContent = text;
    return e;
};
const views = panels.places.map((place)=>{
    const el = h('div', 'panel');
    el.dataset.id = place.id;
    const card = h('div', 'card');
    const head = h('div', '');
    head.append(h('span', 'name', place.name_ja), ' ', h('span', 'en', place.name));
    const pop = h('b', ''), urban = h('b', ''), out = h('output', '');
    const stat = (label, b)=>{
        const d = h('div', 'stat');
        d.append(h('span', '', label), b);
        return d;
    };
    const range = h('input', '');
    Object.assign(range, {
        type: 'range',
        min: String(panels.years[0]),
        max: String(panels.years.at(-1)),
        step: '5',
        value: '2020'
    });
    range.setAttribute('aria-label', `${place.name_ja}の年`);
    const row = h('div', 'year-row');
    row.append(range, out);
    const button = h('button', 'bookmark');
    const link = h('a', '', 'Wikidata ↗');
    Object.assign(link, {
        href: `https://www.wikidata.org/wiki/${place.wikidata}`,
        target: '_blank',
        rel: 'noopener'
    });
    const actions = h('div', 'actions');
    actions.append(button, link);
    card.append(head, h('div', 'country', `${place.country_ja} · ${place.iso3}`), stat('都市圏人口', pop), stat('国の都市人口率', urban), row, h('div', 'src', 'UN WUP (Natural Earth) · World Bank WDI'), actions);
    el.append(card, h('div', 'arrow'));
    const show = ()=>{
        const y = Number(range.value);
        out.textContent = String(y);
        pop.textContent = formatPeople(valueAt(panels, place.pop, y));
        urban.textContent = formatPercent(valueAt(panels, place.urban, y));
    };
    range.addEventListener('input', show);
    show();
    const view = {
        place,
        el,
        button,
        link,
        range,
        css: null,
        depth: 0,
        visible: false,
        texture: null,
        uploads: 0,
        model: panelModel(place.lon, place.lat, PANEL_W, PANEL_H, WORLD_PER_PX)
    };
    button.addEventListener('click', ()=>{
        if (bookmarks.has(place.id)) bookmarks.delete(place.id);
        else bookmarks.add(place.id);
        showBookmarks();
    });
    if (drawable) el.setAttribute('drawable', '');
    (drawable ? canvas : overlay).append(el);
    goto.append(new Option(place.name_ja, place.id));
    return view;
});
const byEl = new Map(views.map((v)=>[
        v.el,
        v
    ]));
function showBookmarks() {
    list.replaceChildren(...views.filter((v)=>bookmarks.has(v.place.id)).map((v)=>h('li', '', v.place.name_ja)));
    for (const v of views){
        const on = bookmarks.has(v.place.id);
        v.button.textContent = on ? '★ 保存済み' : '☆ 保存';
        v.button.setAttribute('aria-pressed', String(on));
    }
}
showBookmarks();
let dpr = 1;
function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
}
function box(t) {
    const c = [
        [
            0,
            0
        ],
        [
            PANEL_W,
            0
        ],
        [
            0,
            PANEL_H
        ],
        [
            PANEL_W,
            PANEL_H
        ]
    ].map(([x, y])=>applyCss(t, x, y));
    return [
        Math.min(...c.map((p)=>p[0])),
        Math.min(...c.map((p)=>p[1])),
        Math.max(...c.map((p)=>p[0])),
        Math.max(...c.map((p)=>p[1]))
    ];
}
function order(shown) {
    const parent = drawable ? canvas : overlay;
    const index = new Map([
        ...parent.children
    ].map((e, i)=>[
            e,
            i
        ]));
    const boxes = shown.map((v)=>box(v.css));
    for(let a = 0; a < shown.length; a++)for(let b = a + 1; b < shown.length; b++){
        const p = boxes[a], q = boxes[b];
        const overlap = p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3];
        if (overlap && index.get(shown[a].el) > index.get(shown[b].el)) {
            reorders++;
            for (const v of shown)parent.append(v.el);
            return;
        }
    }
}
export function render() {
    pending = 0;
    const w = canvas.clientWidth, hh = canvas.clientHeight;
    const m = clipMatrix(cam, w / hh);
    const t0 = performance.now();
    let moved = false;
    const shown = [];
    for (const v of views){
        const visible = facing(cam, v.place.lon, v.place.lat) > MIN_FACING;
        if (visible) {
            v.css = cssTransform(m, v.model, w, hh);
            v.depth = toClip(m, unitVector(v.place.lon, v.place.lat))[3];
            if (drawable) {
                canvas.updateElementGeometry(v.el, {
                    canvasTransform: new DOMMatrix(Array.from(v.css))
                });
                moved = true;
            } else v.el.style.transform = `matrix3d(${v.css.join(',')})`;
            shown.push(v);
        } else if (v.visible || v.css) {
            if (drawable) {
                canvas.clearElementGeometry(v.el);
                moved = true;
            }
            v.css = null;
        }
        if (!drawable) v.el.style.visibility = visible ? 'visible' : 'hidden';
        v.visible = visible;
    }
    if (moved) stamp.dataset.v = String(++geometryVersion);
    geometryMs.push(performance.now() - t0);
    shown.sort((a, b)=>b.depth - a.depth);
    order(shown);
    const quads = drawable ? shown.filter((v)=>v.texture && v.uploads) : [];
    globe.draw(m, cameraEye(cam), quads.map((v)=>({
            matrix: multiply(m, v.model.matrix),
            cssWidth: PANEL_W,
            cssHeight: PANEL_H,
            texture: v.texture
        })), dpr);
    if (!firstFrameMs && (!drawable || shown.every((v)=>v.uploads))) firstFrameMs = performance.now() - window.__mfsPageStart;
}
let pending = 0, geometryVersion = 0;
const stamp = document.createElement('i');
const schedule = ()=>{
    if (!pending) pending = requestAnimationFrame(render);
};
if (drawable) {
    canvas.addEventListener('paint', (ev)=>{
        for (const el of ev.changedElements){
            const v = byEl.get(el);
            if (!v) continue;
            const size = canvas.getElementImageDefaultSize(el);
            if (!v.texture || v.texture.width !== size.width || v.texture.height !== size.height) {
                if (v.texture) globe.deletePanelTexture(v.texture);
                v.texture = globe.createPanelTexture(size.width, size.height);
            }
            const t0 = performance.now();
            globe.upload(v.texture, el);
            uploadMs.push(performance.now() - t0);
            v.uploads++;
            uploads++;
        }
        render();
    });
}
resize();
new ResizeObserver(()=>{
    resize();
    schedule();
}).observe(canvas);
let dragging = null;
scene.addEventListener('pointerdown', (e)=>{
    if (e.target !== canvas) return;
    dragging = {
        x: e.clientX,
        y: e.clientY
    };
    scene.setPointerCapture(e.pointerId);
});
scene.addEventListener('pointermove', (e)=>{
    if (!dragging) return;
    cam = drag(cam, e.clientX - dragging.x, e.clientY - dragging.y, canvas.clientHeight);
    dragging = {
        x: e.clientX,
        y: e.clientY
    };
    schedule();
});
const stop = ()=>{
    dragging = null;
};
scene.addEventListener('pointerup', stop);
scene.addEventListener('pointercancel', stop);
scene.addEventListener('wheel', (e)=>{
    e.preventDefault();
    cam = {
        ...cam,
        distance: zoom(cam.distance, e.deltaY)
    };
    schedule();
}, {
    passive: false
});
const show = (v)=>{
    cam = {
        lon: v.place.lon,
        lat: Math.min(80, v.place.lat + 8),
        distance: cam.distance
    };
    schedule();
};
goto.addEventListener('change', ()=>show(views.find((x)=>x.place.id === goto.value)));
for (const v of views)v.el.addEventListener('focusin', ()=>{
    if (!v.visible) show(v);
});
render();
export const app = {
    canvas,
    gl: globe.gl,
    drawable,
    views,
    bookmarks,
    panels,
    camera: ()=>cam,
    setCamera: (c)=>{
        cam = c;
    },
    render,
    uploads: ()=>uploads,
    reorders: ()=>reorders,
    uploadMs,
    geometryMs,
    firstFrame: ()=>firstFrameMs
};
if (query.has('bench')) void import('./bench.js').then(({ run })=>run(app));
