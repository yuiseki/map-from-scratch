# Day 18 · NULL

東京の250 m国勢調査メッシュを使って、75歳以上女性人口の「公表値」「ゼロ」「秘匿」「行なし」を見分けられる地図を作りたい。空白と秘匿値を0人として扱わず、空白には元表にメッシュ行がないこと、`*`には統計的秘匿の意味があることを凡例に明記する。

## Frame measurement definition and status

The intended `frame_ms` is the interval between consecutive `requestAnimationFrame` callback timestamps while the benchmark draws once in each measured frame. `draw_cpu_ms` is the synchronous duration of `renderer.draw()` alone. A focused unit test checks adjacent callback timestamp subtraction; the browser benchmark now uses that definition.

The corrected three-iteration browser run reported frame p50/p95/p99/max of 115.705/132.485/365.370/904.465 ms, exceeding the 16.7 ms p95 budget. Draw CPU p95 was 4.015 ms, first-frame p50 was 80.670 ms, and code/data gzip was 14,312/26,120 B. Nine of ten budgets passed; `frame_ms` p95 was the only failure (132.485 ms > 16.7 ms). All 9/9 functional checks passed. Host load averages 20.56/20.81/20.51 and xvfb display were recorded during the same run; these are contemporaneous context, not proof of the cause of the long callback intervals. The screenshot was reviewed and the four-state legend, map, source and caveat were legible. The historical pre-correction frame/draw p95 pairs (16.215/6.045, 17.19/7.10, 125.555/4.68 ms) remain legacy measurements and are not comparable. The historical third run also recorded load averages 19.53/21.19/20.61 at the same time; no causal claim is made. The frame target remains unmet; a lower-contention rerun is needed before assessing whether that delay persists.
