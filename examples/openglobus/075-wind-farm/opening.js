export const OPENING = {
    anchor: 7483531471,
    target: [
        -159,
        -224,
        27
    ],
    heading: 203,
    pitch: 10,
    distance: 600
};
export function openingView(turbines, groundAt, shot = OPENING) {
    const a = turbines.find((t)=>t.id === shot.anchor);
    if (!a) throw new Error(`opening anchor ${shot.anchor} is not among the turbines`);
    const x = a.x + shot.target[0], y = a.y + shot.target[1];
    return {
        target: [
            x,
            y,
            groundAt(x, y) + shot.target[2]
        ],
        heading: shot.heading,
        pitch: shot.pitch,
        distance: shot.distance
    };
}
