export function projectWorld(x, y, centerX, centerY, width, height) {
    return {
        x: width / 2 + (x - centerX),
        y: height / 2 + (y - centerY)
    };
}
export function unprojectWorld(px, py, centerX, centerY, width, height, worldSize) {
    const mx = centerX + (px - width / 2), my = centerY + (py - height / 2);
    return {
        lon: mx / worldSize * 360 - 180,
        lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * my / worldSize))) * (180 / Math.PI)
    };
}
export function popupRectAtAnchor(x, y, width, height) {
    return {
        x: Math.round(x - width / 2),
        y: Math.round(y - height - 14),
        width,
        height
    };
}
