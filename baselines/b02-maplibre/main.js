const Z0 = Math.log2(innerWidth / 512);
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            c: {
                type: 'geojson',
                data: '../../data/baked/b02-maplibre/countries.geojson'
            }
        },
        layers: [
            {
                id: 'sea',
                type: 'background',
                paint: {
                    'background-color': '#d9e8f2'
                }
            },
            {
                id: 'fill',
                type: 'fill',
                source: 'c',
                paint: {
                    'fill-color': [
                        'step',
                        [
                            'get',
                            'pop'
                        ],
                        '#fff7ec',
                        1e5,
                        '#fee8c8',
                        1e6,
                        '#fdd49e',
                        5e6,
                        '#fdbb84',
                        1e7,
                        '#fc8d59',
                        3e7,
                        '#e34a33',
                        1e8,
                        '#b30000',
                        3e8,
                        '#7f0000'
                    ]
                }
            },
            {
                id: 'line',
                type: 'line',
                source: 'c',
                paint: {
                    'line-color': '#ffffff',
                    'line-opacity': 0.6,
                    'line-width': 0.5
                }
            }
        ]
    },
    center: [
        0,
        0
    ],
    zoom: Z0,
    minZoom: Z0,
    maxZoom: Z0 + 5,
    renderWorldCopies: false,
    attributionControl: false,
    fadeDuration: 0
});
const info = document.getElementById('info');
map.on('click', (e)=>{
    const f = map.queryRenderedFeatures(e.point, {
        layers: [
            'fill'
        ]
    })[0];
    info.textContent = f ? `${f.properties.name}  人口 ${f.properties.pop.toLocaleString('ja-JP')} 人` : '';
});
await new Promise((r)=>map.once('idle', r));
const idle = performance.now();
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.js')).run(map, Z0, idle);
