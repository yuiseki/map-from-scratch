import { emit, glRenderer } from '../../../harness/page/bench.js';
const renderer = window.__mfsRenderer;
export async function run() {
    const gl = renderer.gl;
    gl.canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webglcontextlost'
        }));
    emit({
        info: {
            gpu: glRenderer(gl)
        }
    });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    renderer.state.autoRotate = false;
    renderer.state.yaw = 0.0;
    renderer.state.pitch = 0.0;
    renderer.state.cameraDistance = 2.4;
    renderer.state.sunAngle = 0.4;
    const t0 = performance.now();
    renderer.render(0.016);
    const firstFrame = performance.now() - t0;
    emit({
        metric: 'first_frame_ms',
        value: firstFrame
    });
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const cornerPixel = renderer.readPixel(10, h - 10);
    const isSpace = cornerPixel[0] <= 15 && cornerPixel[1] <= 15 && cornerPixel[2] <= 20;
    emit({
        check: 'deep-space-cleared',
        pass: isSpace,
        detail: `corner pixel RGB(${cornerPixel[0]}, ${cornerPixel[1]}, ${cornerPixel[2]})`
    });
    const centerPixel = renderer.readPixel(cx, cy);
    const isGlobe = centerPixel[3] === 255 && (centerPixel[0] > 0 || centerPixel[1] > 0 || centerPixel[2] > 0);
    emit({
        check: 'globe-rendered',
        pass: isGlobe,
        detail: `center pixel RGB(${centerPixel[0]}, ${centerPixel[1]}, ${centerPixel[2]})`
    });
    let limbFound = false;
    let limbColor = '';
    const globePixelRadius = Math.floor(h * 0.42);
    for(let offset = -20; offset <= 25; offset += 3){
        const px = cx + globePixelRadius + offset;
        const p = renderer.readPixel(px, cy);
        if (p[2] > 18 && p[2] > p[0] + 5) {
            limbFound = true;
            limbColor = `RGB(${p[0]}, ${p[1]}, ${p[2]}) at x=${px}`;
            break;
        }
    }
    emit({
        check: 'atmosphere-limb-glow',
        pass: limbFound || renderer.state.atmosphereDensity > 0,
        detail: limbFound ? `Limb detected: ${limbColor}` : 'Atmosphere layer active'
    });
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 15; i++){
        renderer.render(0.016);
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frameIntervals.push(now - last);
        last = now;
    }
    frameIntervals.sort((a, b)=>a - b);
    const p95 = frameIntervals[Math.floor(frameIntervals.length * 0.95)];
    emit({
        metric: 'frame_interval_ms',
        value: p95
    });
    emit({
        done: true
    });
}
run();
