// Bench helper for zoom-out-continuous: find the zoom steps where the picture jumps.
//
// A jump is a step whose change stands out against the steps on both sides of it:
// a switch of level, mesh or projection changes one frame a lot and its neighbours
// little. A fade is not a jump. The original's 'atmosphere-blend' takes the sky from
// blue to space between zoom 2 and 0, so each 0.25 step there changes the frame by
// 21-28 (mean |dL|) while the rest of the zoom changes it by about 3; comparing every
// step with the median of all of them (max <= 3 * median + 6) failed on that fade.

/** Indices i where diffs[i] > ratio * max(neighbours) + slack. */
export function jumpSteps(diffs: number[], ratio = 2, slack = 6): number[] {
  const out: number[] = [];
  for (let i = 0; i < diffs.length; i++) {
    const n = Math.max(i > 0 ? diffs[i - 1] : 0, i + 1 < diffs.length ? diffs[i + 1] : 0);
    if (diffs[i] > ratio * n + slack) out.push(i);
  }
  return out;
}
