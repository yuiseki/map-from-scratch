import { emit, benchFramesGpu } from '../../../harness/page/bench.js';
export async function runBench(map, firstFrameMs) {
    const { canvas } = map;
    await new Promise(requestAnimationFrame);
    emit({
        info: {
            gpu: map.gpuName
        }
    });
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    emit({
        check: 'html-in-canvas-supported',
        pass: map.htmlInCanvas,
        detail: map.htmlInCanvas ? 'canvas.content reflects "drawable"; cards drawn with drawElementImageToTexture' : 'DOM overlay (no HTML-in-Canvas, or SwiftShader)'
    });
    emit({
        check: 'webgpu-initialized',
        pass: Boolean(map.gpuName && map.gpuName.length > 0),
        detail: `GPU: ${map.gpuName}`
    });
    emit({
        check: 'labels-loaded',
        pass: map.landmarks.length === 6,
        detail: `Loaded ${map.landmarks.length} landmarks for GPU instanced rendering`
    });
    const pPos = map.getLabelScreenPos(2);
    const cardPixel = await map.readPixel(pPos.x + 100, pPos.y + 20);
    const badgePixel = await map.readPixel(pPos.x + 40, pPos.y + 10);
    const isCardWhite = cardPixel[0] > 240 && cardPixel[1] > 240 && cardPixel[2] > 240;
    const isBadgeGreen = badgePixel[1] > 140 && badgePixel[0] < 50;
    emit({
        check: 'labels-rendered-on-webgpu',
        pass: isCardWhite && isBadgeGreen,
        detail: `Card background: rgba(${Array.from(cardPixel).join(',')}), Badge: rgba(${Array.from(badgePixel).join(',')})`
    });
    const uploadsBefore = map.textureUploadCount;
    for(let step = 0; step < 5; step++){
        await map.panBy(30, -20);
    }
    await map.zoomBy(0.2);
    const uploadsAfter = map.textureUploadCount;
    emit({
        info: {
            paint_log_before_pan: JSON.stringify(map.paintLog)
        }
    });
    emit({
        check: 'zero-uploads-during-pan',
        pass: uploadsBefore === uploadsAfter && uploadsBefore === map.landmarks.length,
        detail: `Uploads before pan: ${uploadsBefore}, Uploads after pan: ${uploadsAfter}`
    });
    await map.updateLabelContent(0, '東京タワー更新', '人気電波塔', '★ 5.0');
    const uploadsAfterUpdate = map.textureUploadCount;
    emit({
        check: 'texture-updated-on-change',
        pass: uploadsAfterUpdate === uploadsAfter + 1,
        detail: `Uploads after label content update: ${uploadsAfterUpdate} (expected ${uploadsAfter + 1})`
    });
    {
        const box = canvas.getBoundingClientRect();
        const k = box.width / canvas.width;
        const cardAt = (r)=>document.elementFromPoint(box.left + (r.x + r.width / 2) * k, box.top + (r.y + r.height / 2) * k);
        const card = map.labelElements[2];
        const name = (e)=>(e?.closest('.map-label-card')?.id ?? e?.id) || e?.tagName || '-';
        const r0 = map.getLabelScreenPos(2);
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const hit0 = cardAt(r0);
        await map.panBy(-90, 60);
        const r1 = map.getLabelScreenPos(2);
        await new Promise(requestAnimationFrame);
        const hit1 = cardAt(r1), hitOld = cardAt(r0);
        emit({
            check: 'card-hit-where-drawn',
            pass: card.contains(hit0) && card.contains(hit1) && !card.contains(hitOld),
            detail: `elementFromPoint at card 2: ${name(hit0)}; after a pan at its new place: ${name(hit1)}, at its old place: ${name(hitOld)}`
        });
        const uploads = map.textureUploadCount;
        const painted = new Promise((r)=>canvas.addEventListener('paint', ()=>r(), {
                once: true
            }));
        hit1?.click();
        if (map.htmlInCanvas) await painted;
        await map.render();
        const px = await map.readPixel(r1.x + r1.width - 12, r1.y + r1.height - 10);
        const amber = px[0] > 240 && px[1] > 225 && px[2] > 170 && px[2] < 225;
        emit({
            check: 'click-pins-card',
            pass: card.classList.contains('selected') && map.textureUploadCount === uploads + 1 && amber,
            detail: `selected ${card.classList.contains('selected')}, uploads ${uploads} -> ${map.textureUploadCount}, card pixel rgba(${Array.from(px).join(',')})`
        });
    }
    const hasTiles = await map.waitForTile(4000);
    await map.render();
    emit({
        check: 'aerial-tile-rendered',
        pass: hasTiles,
        detail: `GSI Seamlessphoto PMTiles loaded on WebGPU: ${hasTiles}`
    });
    {
        const w = map.canvas.width, h = map.canvas.height;
        const probes = [
            [
                w * 0.2,
                h * 0.88
            ],
            [
                w * 0.8,
                h * 0.88
            ]
        ];
        const isBg = (p)=>Math.abs(p[0] - 11) < 4 && Math.abs(p[1] - 17) < 4 && Math.abs(p[2] - 32) < 4;
        let px = [];
        for(let t = 0; t < 80; t++){
            px = await Promise.all(probes.map(([x, y])=>map.readPixel(x, y)));
            if (!px.some(isBg)) break;
            await new Promise((r)=>setTimeout(r, 100));
        }
        emit({
            check: 'aerial-covers-the-view',
            pass: px.length === 2 && !px.some(isBg),
            detail: `lower left rgba(${Array.from(px[0] ?? []).join(',')}), lower right rgba(${Array.from(px[1] ?? []).join(',')}) at ${w}x${h}`
        });
    }
    await benchFramesGpu(map.device, 60, (i, ts)=>{
        void map.panBy(Math.sin(i * 0.1) * 3, Math.cos(i * 0.1) * 2, ts, true);
    });
    emit({
        done: true
    });
}
