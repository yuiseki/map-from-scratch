import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.js';
import { projectLonLat } from './globe.js';
export async function run(renderer, firstFrame) {
    const gl = renderer.gl;
    gl.canvas.addEventListener('webglcontextlost', (event)=>{
        event.preventDefault();
        emit({
            error: 'webglcontextlost'
        });
    });
    emit({
        info: {
            gpu: glRenderer(gl),
            sphere_triangles: 96 * 192 * 2,
            texture_bytes: 2048 * 1024 * 3
        }
    });
    for(let i = 0; i < 30 && !firstFrame(); i++)await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrame()
    });
    renderer.render(0.15, -0.12, 3.45);
    const center = renderer.readPixel(Math.floor(gl.canvas.width / 2), Math.floor(gl.canvas.height / 2));
    const corner = renderer.readPixel(4, 4);
    const earthVisible = center[3] === 255 && Math.hypot(center[0] - corner[0], center[1] - corner[1], center[2] - corner[2]) > 15;
    emit({
        check: 'earth-visible',
        pass: earthVisible,
        detail: `center=${[
            ...center
        ]}, corner=${[
            ...corner
        ]}`
    });
    const edge = renderer.readPixel(Math.floor(gl.canvas.width * 0.668), Math.floor(gl.canvas.height * 0.5));
    const atmosphereVisible = edge[2] > edge[0] + 8;
    emit({
        check: 'blue-atmosphere',
        pass: atmosphereVisible,
        detail: `rim=${[
            ...edge
        ]}`
    });
    const mean = (lon, lat)=>{
        const [x, y] = projectLonLat(lon, lat, 0.15, -0.12, 3.45, gl.canvas.width, gl.canvas.height);
        const sum = [
            0,
            0,
            0
        ];
        for(let dy = -2; dy <= 2; dy++)for(let dx = -2; dx <= 2; dx++){
            const p = renderer.readPixel(Math.round(x) + dx, Math.round(y) + dy);
            for(let i = 0; i < 3; i++)sum[i] += p[i] / 25;
        }
        return sum.map(Math.round);
    };
    const sahara = mean(5, 25);
    const atlantic = mean(5, -25);
    const northUp = sahara[0] > atlantic[0] + 40 && sahara[0] > sahara[2] && atlantic[2] > atlantic[0];
    emit({
        check: 'north-up',
        pass: northUp,
        detail: `sahara(5E,25N)=${sahara}, atlantic(5E,25S)=${atlantic}`
    });
    renderer.render(0.70, -0.12, 3.45);
    const rotated = renderer.readPixel(Math.floor(gl.canvas.width / 2), Math.floor(gl.canvas.height / 2));
    const rotationDifference = Math.hypot(center[0] - rotated[0], center[1] - rotated[1], center[2] - rotated[2]);
    emit({
        check: 'globe-rotates',
        pass: rotationDifference > 12,
        detail: `center color distance after yaw change=${rotationDifference.toFixed(1)}`
    });
    renderer.render(0.15, -0.12, 3.45);
    const nearEdge = renderer.readPixel(Math.floor(gl.canvas.width / 2) + 160, Math.floor(gl.canvas.height / 2));
    renderer.render(0.15, -0.12, 5.5);
    const farEdge = renderer.readPixel(Math.floor(gl.canvas.width / 2) + 160, Math.floor(gl.canvas.height / 2));
    emit({
        check: 'zoom-changes-scale',
        pass: nearEdge[3] > 200 && farEdge[3] < 32,
        detail: `near edge alpha=${nearEdge[3]}, far edge alpha=${farEdge[3]}`
    });
    await benchFrames(gl, 40, (i)=>renderer.render(i * Math.PI / 20, -0.12, 3.45));
    emit({
        done: true
    });
}
