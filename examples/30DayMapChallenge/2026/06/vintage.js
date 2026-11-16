const PALETTE = [
    '#c4aa78',
    '#a9b982',
    '#d1a181',
    '#88a8a0',
    '#c9bd91',
    '#b88f79'
];
export function projectVintage(lon, lat) {
    return [
        (lon + 180) / 360,
        (90 - lat) / 180
    ];
}
export function countryTint(index) {
    return PALETTE[(index % PALETTE.length + PALETTE.length) % PALETTE.length];
}
export function splitAtDateline(points) {
    const parts = [];
    let part = [];
    for (const point of points){
        if (part.length && Math.abs(point[0] - part.at(-1)[0]) > 180) {
            if (part.length > 1) parts.push(part);
            part = [];
        }
        part.push(point);
    }
    if (part.length > 1) parts.push(part);
    return parts;
}
export function unwrapRing(ring) {
    if (!ring.length) return [];
    const result = [
        [
            ...ring[0]
        ]
    ];
    for (const [lon, lat] of ring.slice(1)){
        let adjusted = lon;
        const previous = result.at(-1)[0];
        while(adjusted - previous > 180)adjusted -= 360;
        while(adjusted - previous < -180)adjusted += 360;
        result.push([
            adjusted,
            lat
        ]);
    }
    return result;
}
