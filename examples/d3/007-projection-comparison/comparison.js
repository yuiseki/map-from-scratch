export function splitViewport(width, height, gap = 1) {
    const left = Math.floor((width - gap) / 2);
    const rightX = left + gap;
    return [
        [
            0,
            0,
            left,
            height
        ],
        [
            rightX,
            0,
            width - rightX,
            height
        ]
    ];
}
