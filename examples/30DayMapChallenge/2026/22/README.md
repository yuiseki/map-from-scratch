# 地球を、平面にする。

30DayMapChallenge 2026 Day 22「Projections」。同じNatural Earthの国境線を
Equirectangular、Mercator、Equal Earth、Winkel Tripelの4つで切り替えて
見比べます。どの平面図も地球のすべての性質は保てません。

開発時はリポジトリルートから `bin/mfs bake 30DayMapChallenge-2026-22`
を実行してください。詳細な出典、式、処理と現在の検証状況は
[REQUEST.md](./REQUEST.md) に記録しています。

修正前の3回計測では8/8予算・6/6ブラウザチェックに合格。first frame p50
30.3 ms、描画 CPU p95 6.01 ms、frame p95 16.31 ms。1280×800の画面を確認済みです。

2026-11-06: projection pixel checks now use `readBack()` on an OffscreenCanvas copy, and the renderer no longer requests `willReadFrequently`, which selected a readback-oriented canvas path. The previous frame and draw measurements are historical; repeat the three-run browser benchmark for the updated renderer.
