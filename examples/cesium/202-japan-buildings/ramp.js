export const STOPS = [
    [
        0,
        [
            214,
            208,
            196
        ]
    ],
    [
        12,
        [
            236,
            196,
            120
        ]
    ],
    [
        30,
        [
            238,
            146,
            78
        ]
    ],
    [
        80,
        [
            212,
            80,
            74
        ]
    ],
    [
        150,
        [
            166,
            48,
            120
        ]
    ],
    [
        250,
        [
            98,
            40,
            140
        ]
    ]
];
export const SKY = [
    118,
    168,
    222
];
export const LAND = [
    96,
    120,
    84
];
export const OCEAN = [
    28,
    58,
    92
];
const f3 = (v)=>(v / 255).toFixed(4);
export const vec3Of = (c)=>`vec3(${f3(c[0])}, ${f3(c[1])}, ${f3(c[2])})`;
export const rgbOf = (c)=>`rgb(${c[0]},${c[1]},${c[2]})`;
export function rampGlsl() {
    const lines = [
        `vec3 ramp(float h) {`,
        `  vec3 c = ${vec3Of(STOPS[0][1])};`
    ];
    for(let i = 1; i < STOPS.length; i++){
        const h0 = STOPS[i - 1][0], span = STOPS[i][0] - h0;
        lines.push(`  c = mix(c, ${vec3Of(STOPS[i][1])}, clamp((h - ${h0.toFixed(1)}) / ${span.toFixed(1)}, 0.0, 1.0));`);
    }
    lines.push('  return c;', '}');
    return lines.join('\n');
}
export function rampCss(max) {
    return `linear-gradient(to right, ${STOPS.map(([h, c])=>`${rgbOf(c)} ${(Math.min(h, max) / max * 100).toFixed(1)}%`).join(', ')})`;
}
export function rampAt(h) {
    let c = STOPS[0][1].slice();
    for(let i = 1; i < STOPS.length; i++){
        const t = Math.min(1, Math.max(0, (h - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0])));
        c = c.map((v, k)=>v + (STOPS[i][1][k] - v) * t);
    }
    return c;
}
