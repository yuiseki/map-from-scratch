# mapbox-018-animate-a-line

Mapbox GL JS の公式ギャラリー例「Animate a line」のように、サンフランシスコからワシントンD.C.を結ぶ大圏航路ルートラインを、毎フレームの頂点ストリーミングにより時間経過とともに滑らかに伸長アニメーション描画したい。先頭にはパルス発光マーカー、軌跡にはグロー発光エフェクトを備え、ドラッグでパン、ホイールで拡大縮小中も 60 fps で途切れることなく追従すること。外部ライブラリなし、Canvas 2D で最速・最小で実装する。

## 元の例
- Mapbox GL JS: [Animate a line](https://docs.mapbox.com/mapbox-gl-js/example/animate-a-line/)
