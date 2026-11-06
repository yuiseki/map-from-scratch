export function jumpSteps(diffs, ratio = 2, slack = 6) {
    const out = [];
    for(let i = 0; i < diffs.length; i++){
        const n = Math.max(i > 0 ? diffs[i - 1] : 0, i + 1 < diffs.length ? diffs[i + 1] : 0);
        if (diffs[i] > ratio * n + slack) out.push(i);
    }
    return out;
}
