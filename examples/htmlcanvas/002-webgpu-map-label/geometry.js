export function labelScreenRect(mx, my, centerMx, centerMy, zoom, viewWidth, viewHeight, width = 150, height = 60, gap = 12) {
    const scale = 256 * 2 ** zoom;
    const screenX = viewWidth / 2 + (mx - centerMx) * scale;
    const screenY = viewHeight / 2 + (my - centerMy) * scale;
    return {
        x: Math.round(screenX - width / 2),
        y: Math.round(screenY - height - gap),
        width,
        height
    };
}
