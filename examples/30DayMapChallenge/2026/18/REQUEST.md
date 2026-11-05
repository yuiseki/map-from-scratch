# Day 18 · NULL

東京の250 m国勢調査メッシュを使って、75歳以上女性人口の「公表値」「ゼロ」「秘匿」「行なし」を見分けられる地図を作りたい。空白と秘匿値を0人として扱わず、空白には元表にメッシュ行がないこと、`*`には統計的秘匿の意味があることを凡例に明記する。

## Frame measurement definition and status

The intended `frame_ms` is the interval between consecutive `requestAnimationFrame` callback timestamps while the benchmark draws once in each measured frame. `draw_cpu_ms` is the synchronous duration of `renderer.draw()` alone. A focused unit test checks adjacent callback timestamp subtraction; the browser benchmark now uses that definition.


The earlier frame miss was measured before removing visible-canvas readback and is superseded. On 2026-11-06, after the OffscreenCanvas fix, three Chrome 156 runs passed all 10 budgets and 9/9 functional checks. Frame p95 was 6.100 ms, draw CPU p95 3.130 ms, and first-frame p50 77.330 ms. Host load averages 23.84/22.02/21.75 and xvfb display were recorded; no causal claim is made. The screenshot was reviewed and the four-state legend, map, source and caveat were legible. See `results/30DayMapChallenge-2026-18/latest.json`.

After the OffscreenCanvas pixel-readback change, the corrected 2026-11-06 three-run Chrome 156 benchmark passed all 10 budgets and all 9 browser checks. Frame p95 was 6.100 ms, draw CPU p95 3.130 ms, and first-frame p50 77.330 ms. Host load averages were 23.84/22.02/21.75. The prior direct-canvas-readback result is superseded; see `results/30DayMapChallenge-2026-18/latest.json`.
