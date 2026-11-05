# 地球を、平面にする。

30DayMapChallenge 2026 Day 22「Projections」。同じNatural Earthの国境線を
Equirectangular、Mercator、Equal Earth、Winkel Tripelの4つで切り替えて
見比べます。どの平面図も地球のすべての性質は保てません。

開発時はリポジトリルートから `bin/mfs bake 30DayMapChallenge-2026-22`
を実行してください。詳細な出典、式、処理と現在の検証状況は
[REQUEST.md](./REQUEST.md) に記録しています。

修正前の3回計測では8/8予算・6/6ブラウザチェックに合格。first frame p50
30.3 ms、描画 CPU p95 6.01 ms、frame p95 16.31 ms。1280×800の画面を確認済みです。

2026-11-06 corrected three-run Chrome 156 measurement after switching pixel checks to an OffscreenCanvas copy and removing the readback-oriented context option: 8/8 budgets and 6/6 checks passed. Frame p95 15.125 ms, draw CPU p95 5.915 ms, first-frame p50 27.130 ms; gzip code/data 6,745/177,694 B. Host load averages were 23.69/22.02/21.75. See `results/30DayMapChallenge-2026-22/latest.json`.
