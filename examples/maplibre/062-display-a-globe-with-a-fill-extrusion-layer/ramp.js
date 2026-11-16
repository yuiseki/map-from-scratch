export const STOPS = [
    [
        68,
        1,
        84
    ],
    [
        59,
        82,
        139
    ],
    [
        33,
        145,
        140
    ],
    [
        94,
        201,
        98
    ],
    [
        253,
        231,
        37
    ]
];
export const H_MIN = 0.004;
export const H_MAX = 0.16;
export function scaleT(pop, popMax) {
    return Math.sqrt(Math.max(0, pop) / popMax);
}
export function heightOf(pop, popMax) {
    return H_MIN + H_MAX * scaleT(pop, popMax);
}
export function ramp(t) {
    const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i;
    const a = STOPS[i], b = STOPS[i + 1];
    return [
        0,
        1,
        2
    ].map((k)=>Math.round(a[k] + (b[k] - a[k]) * f));
}
export function legendTicks(popMax) {
    return [
        0,
        0.25,
        0.5,
        0.75,
        1
    ].map((t)=>({
            t,
            pop: t * t * popMax
        }));
}
