# Day 18 · NULL

東京の250 m国勢調査メッシュを使って、75歳以上女性人口の「公表値」「ゼロ」「秘匿」「行なし」を見分けられる地図を作りたい。空白と秘匿値を0人として扱わず、空白には元表にメッシュ行がないこと、`*`には統計的秘匿の意味があることを凡例に明記する。

## Frame measurement definition and status

The intended `frame_ms` is the interval between consecutive `requestAnimationFrame` callback timestamps while the benchmark draws once inside each measured callback. `draw_cpu_ms` is the synchronous duration of `renderer.draw()` alone. The earlier benchmark implementation measured from before a draw until the next callback; its three historical frame/draw CPU p95 pairs were 16.215/6.045 ms, 17.19/7.10 ms, and 125.555/4.68 ms. These are retained as legacy data, not treated as callback intervals or as evidence that the frame budget passes. The benchmark now collects callback timestamps and derives adjacent intervals, with a focused unit test for that calculation. A browser rerun is still required to assess the 16.7 ms target; no browser was launched for this correction.
