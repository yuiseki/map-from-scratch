export function morphProjection(a, b, t) {
    const k = Math.max(0, Math.min(1, t));
    return [
        a[0] + (b[0] - a[0]) * k,
        a[1] + (b[1] - a[1]) * k
    ];
}
export function orthographicDirection(x, y) {
    return [
        Math.sqrt(Math.max(0, 1 - x * x - y * y)),
        x,
        y
    ];
}
