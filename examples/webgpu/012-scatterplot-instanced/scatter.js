export function decodePoints(buffer) {
    if (buffer.byteLength % 16 !== 0) {
        throw new Error(`buffer length must be a multiple of 16, got ${buffer.byteLength}`);
    }
    const floats = new Float32Array(buffer);
    const count = floats.length / 4;
    const points = new Array(count);
    for(let i = 0; i < count; i++){
        const offset = i * 4;
        points[i] = {
            x: floats[offset],
            y: floats[offset + 1],
            weight: floats[offset + 2]
        };
    }
    return points;
}
export function mercatorToScreen(x, y, centerMercator, zoom, viewWidth, viewHeight) {
    const worldPx = 256 * Math.pow(2, zoom);
    const screenX = viewWidth * 0.5 + (x - centerMercator[0]) * worldPx;
    const screenY = viewHeight * 0.5 + (y - centerMercator[1]) * worldPx;
    return {
        x: screenX,
        y: screenY
    };
}
export function weightToColor(weight) {
    if (weight <= 1.0) {
        return [
            0.12,
            0.53,
            0.90,
            0.85
        ];
    } else if (weight >= 2.0) {
        return [
            1.00,
            0.70,
            0.25,
            0.85
        ];
    } else {
        const t = weight - 1.0;
        return [
            0.12 + (1.00 - 0.12) * t,
            0.53 + (0.70 - 0.53) * t,
            0.90 + (0.25 - 0.90) * t,
            0.85
        ];
    }
}
export function circleCoverage(dist, radius, smoothWidth = 1.0) {
    if (dist <= radius - smoothWidth) return 1.0;
    if (dist >= radius + smoothWidth) return 0.0;
    const t = Math.max(0.0, Math.min(1.0, (radius + smoothWidth - dist) / (2.0 * smoothWidth)));
    return t * t * (3.0 - 2.0 * t);
}
