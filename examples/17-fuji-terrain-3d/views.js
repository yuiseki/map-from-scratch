const SUMMIT_PX = [
    1233.5,
    1739.5
];
const CELL = 15.578601873;
const sx = (SUMMIT_PX[0] - 1536) * CELL, sy = (1536 - SUMMIT_PX[1]) * CELL;
export const TAU = 1.5;
export const VIEWS = {
    default: {
        tx: sx,
        ty: sy,
        tz: 1800,
        yaw: 200,
        pitch: 28,
        dist: 40000
    },
    far: {
        tx: sx,
        ty: sy,
        tz: 1800,
        yaw: 200,
        pitch: 30,
        dist: 60000
    },
    close: {
        tx: sx,
        ty: sy,
        tz: 3000,
        yaw: 200,
        pitch: 25,
        dist: 12000
    },
    low: {
        tx: sx,
        ty: sy,
        tz: 1800,
        yaw: 200,
        pitch: 10,
        dist: 30000
    },
    top: {
        tx: 0,
        ty: 0,
        tz: 800,
        yaw: 0,
        pitch: 89,
        dist: 70000
    }
};
