// Node selection with replacement refinement, as Cesium3DTileset does it in
// outline: a node is refined while its screen space error exceeds the
// maximum, measured from the eye to the nearest point of its box
// (3d-tiles-and-hlod skill: distance to the volume, not its centre). A node
// whose visible children are not all loaded is drawn itself while they
// load, so the view never has a hole where a refinement is pending.
import { FOVY, boxVisible, distanceToBox, frustumPlanes, type View } from './camera.ts';
import type { Tileset } from './format.ts';

export const screenSpaceError = (geometricError: number, distance: number, heightCss: number) =>
  geometricError * heightCss / (Math.max(distance, 1e-7) * 2 * Math.tan(FOVY / 2));

export interface Selection { draw: number[]; want: number[] }

export function select(tileset: Tileset, view: View, heightCss: number, maximumScreenSpaceError: number, loaded: (i: number) => boolean): Selection {
  const planes = frustumPlanes(view.viewProj);
  const draw: number[] = [], want: { i: number; level: number; d: number }[] = [];
  const visible = (i: number) => boxVisible(planes, tileset.nodes[i].min, tileset.nodes[i].max);
  const distance = (i: number) => distanceToBox(view.eye, tileset.nodes[i].min, tileset.nodes[i].max);
  const visit = (i: number) => {
    const node = tileset.nodes[i];
    if (!loaded(i)) { want.push({ i, level: node.level, d: distance(i) }); return; }
    const refine = node.children.length > 0 && screenSpaceError(node.geometricError, distance(i), heightCss) > maximumScreenSpaceError;
    const children = refine ? node.children.filter(visible) : [];
    if (children.length > 0 && children.every(loaded)) { children.forEach(visit); return; }
    draw.push(i);
    for (const c of children) if (!loaded(c)) want.push({ i: c, level: tileset.nodes[c].level, d: distance(c) });
  };
  for (const r of tileset.roots) if (visible(r)) visit(r);
  // Coarse levels first, then nearest first.
  want.sort((a, b) => a.level - b.level || a.d - b.d);
  return { draw, want: want.map((w) => w.i) };
}
