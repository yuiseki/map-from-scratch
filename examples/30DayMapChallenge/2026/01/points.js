const X_EXTENT = 2.7066;
const Y_EXTENT = 1.3174;
const RAD = Math.PI / 180;
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;
export function projectEarth(lon, lat) {
    const t = Math.asin(M * Math.sin(lat * RAD));
    const t2 = t * t, t6 = t2 * t2 * t2;
    const x = 2 * Math.sqrt(3) * lon * RAD * Math.cos(t) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
    const y = t * (A4 * t6 * t2 + A3 * t6 + A2 * t2 + A1);
    return [
        x,
        y
    ];
}
export function projectPoint(lon, lat, width, height, zoom = 1, centerX = 0, centerY = 0) {
    const [x, y] = projectEarth(lon, lat);
    const scale = Math.min(width / (2 * X_EXTENT), height / (2 * Y_EXTENT)) * zoom;
    return [
        width / 2 + (x - centerX) * scale,
        height / 2 - (y - centerY) * scale
    ];
}
export function markerRadius(magnitude) {
    return Math.min(14, 2 * 2 ** (magnitude - 4.5));
}
export function depthColor(depthKm) {
    if (depthKm < 70) return '#ff624d';
    if (depthKm <= 300) return '#ffc857';
    return '#67b7ff';
}
export function encodePoints(points) {
    const ordered = points.slice().sort((a, b)=>a.magnitude - b.magnitude);
    const buffer = new ArrayBuffer(4 + ordered.length * 8);
    const view = new DataView(buffer);
    view.setUint32(0, ordered.length, true);
    ordered.forEach((point, i)=>{
        const [x, y] = projectEarth(point.lon, point.lat);
        const offset = 4 + i * 8;
        view.setUint16(offset, Math.round((x + X_EXTENT) / (2 * X_EXTENT) * 65535), true);
        view.setUint16(offset + 2, Math.round((Y_EXTENT - y) / (2 * Y_EXTENT) * 65535), true);
        view.setUint8(offset + 4, Math.round(markerRadius(point.magnitude) * 4));
        view.setUint8(offset + 5, point.depthKm < 70 ? 0 : point.depthKm <= 300 ? 1 : 2);
    });
    return buffer;
}
