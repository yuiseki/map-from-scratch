import { FOVY, boxVisible, distanceToBox, frustumPlanes } from './camera.js';
export const screenSpaceError = (geometricError, distance, heightCss)=>geometricError * heightCss / (Math.max(distance, 1e-7) * 2 * Math.tan(FOVY / 2));
export function select(tileset, view, heightCss, maximumScreenSpaceError, loaded) {
    const planes = frustumPlanes(view.viewProj);
    const draw = [], want = [];
    const visible = (i)=>boxVisible(planes, tileset.nodes[i].min, tileset.nodes[i].max);
    const distance = (i)=>distanceToBox(view.eye, tileset.nodes[i].min, tileset.nodes[i].max);
    const visit = (i)=>{
        const node = tileset.nodes[i];
        if (!loaded(i)) {
            want.push({
                i,
                level: node.level,
                d: distance(i)
            });
            return;
        }
        const refine = node.children.length > 0 && screenSpaceError(node.geometricError, distance(i), heightCss) > maximumScreenSpaceError;
        const children = refine ? node.children.filter(visible) : [];
        if (children.length > 0 && children.every(loaded)) {
            children.forEach(visit);
            return;
        }
        draw.push(i);
        for (const c of children)if (!loaded(c)) want.push({
            i: c,
            level: tileset.nodes[c].level,
            d: distance(c)
        });
    };
    for (const r of tileset.roots)if (visible(r)) visit(r);
    want.sort((a, b)=>a.level - b.level || a.d - b.d);
    return {
        draw,
        want: want.map((w)=>w.i)
    };
}
