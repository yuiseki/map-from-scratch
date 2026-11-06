const SIZE = 512;
const roadWidth = {
    motorway: 5,
    trunk: 4.5,
    primary: 4,
    secondary: 3.2,
    tertiary: 2.6,
    minor: 1.7,
    service: 1.2,
    path: 0.8,
    track: 0.8,
    rail: 1.2
};
const major = new Set([
    'motorway',
    'trunk',
    'primary',
    'secondary'
]);
const namedPlaces = new Set([
    'country',
    'state',
    'city',
    'town',
    'village',
    'suburb',
    'neighbourhood',
    'quarter'
]);
const placeMinZoom = {
    country: 0,
    state: 5,
    city: 6,
    town: 8,
    village: 10,
    suburb: 11,
    neighbourhood: 12,
    quarter: 12
};
function pathOf(feature, scale) {
    const path = new Path2D();
    for (const points of feature.paths){
        if (!points.length) continue;
        path.moveTo(points[0][0] * scale, points[0][1] * scale);
        for(let i = 1; i < points.length; i++)path.lineTo(points[i][0] * scale, points[i][1] * scale);
        if (feature.type === 3) path.closePath();
    }
    return path;
}
export function paintTile(layers, zoom) {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d', {
        alpha: false
    });
    if (!ctx) throw new Error('Canvas 2D が使えません');
    ctx.fillStyle = '#f2f0e9';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const byName = new Map(layers.map((layer)=>[
            layer.name,
            layer
        ]));
    const water = byName.get('water');
    if (water) {
        ctx.fillStyle = '#acd6e5';
        for (const feature of water.features)if (feature.type === 3) ctx.fill(pathOf(feature, SIZE / water.extent), 'evenodd');
    }
    const transportation = byName.get('transportation');
    if (transportation) {
        const scale = SIZE / transportation.extent;
        const groups = new Map();
        for (const feature of transportation.features){
            if (feature.type !== 2) continue;
            const kind = feature.properties.class || 'minor';
            if (!(kind in roadWidth)) continue;
            let path = groups.get(kind);
            if (!path) {
                path = new Path2D();
                groups.set(kind, path);
            }
            for (const points of feature.paths){
                if (!points.length) continue;
                path.moveTo(points[0][0] * scale, points[0][1] * scale);
                for(let i = 1; i < points.length; i++)path.lineTo(points[i][0] * scale, points[i][1] * scale);
            }
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const order = [
            'path',
            'track',
            'service',
            'minor',
            'tertiary',
            'secondary',
            'primary',
            'trunk',
            'motorway',
            'rail'
        ];
        for (const kind of order){
            const path = groups.get(kind);
            if (!path) continue;
            const width = roadWidth[kind] * (zoom < 8 ? 0.65 : zoom < 11 ? 0.8 : 1);
            if (major.has(kind)) {
                ctx.strokeStyle = '#bfc4bd';
                ctx.lineWidth = width + 2;
                ctx.stroke(path);
            }
            ctx.strokeStyle = kind === 'rail' ? '#90969b' : kind === 'path' || kind === 'track' ? '#cabdaa' : '#fffdf6';
            ctx.lineWidth = width;
            ctx.stroke(path);
        }
    }
    const places = byName.get('place');
    if (places) {
        const scale = SIZE / places.extent, occupied = new Set();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const feature of places.features){
            if (feature.type !== 1 || !feature.paths.length) continue;
            const kind = feature.properties.class;
            if (!namedPlaces.has(kind) || zoom < placeMinZoom[kind]) continue;
            const name = feature.properties['name:ja'] || feature.properties.name;
            if (!name) continue;
            const [gx, gy] = feature.paths[0][0], x = gx * scale, y = gy * scale;
            if (x < 12 || x > SIZE - 12 || y < 12 || y > SIZE - 12) continue;
            const cellWidth = zoom < 5 ? 130 : zoom < 8 ? 90 : 75;
            const cellHeight = zoom < 5 ? 80 : zoom < 8 ? 50 : 36;
            const cell = `${Math.floor(x / cellWidth)},${Math.floor(y / cellHeight)}`;
            if (occupied.has(cell)) continue;
            occupied.add(cell);
            ctx.font = `${kind === 'city' || kind === 'town' ? '600 14px' : '12px'} system-ui, sans-serif`;
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#f2f0e9';
            ctx.strokeText(name, x, y);
            ctx.fillStyle = '#354e55';
            ctx.fillText(name, x, y);
        }
    }
    return canvas.transferToImageBitmap();
}
