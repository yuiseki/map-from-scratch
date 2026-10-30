# maplibre-053-create-a-heatmap-layer

MapLibre の公式ギャラリー例「Create a heatmap layer」のように、全世界 6,000 件以上の地震データ（USGS）からマグニチュードに応じた密度分布をカーネル密度推定（KDE）によるヒートマップとして滑らかに可視化したい。青〜シアン〜黄〜赤の段彩グラデーションを用い、ドラッグでパン、ホイールで拡大縮小でき、60 fps で滑らかに再描画すること。外部ライブラリなし、Canvas 2D で最速・最小で実装する。

## 元の例
- MapLibre GL JS: [Create a heatmap layer](https://maplibre.org/maplibre-gl-js/docs/examples/create-a-heatmap-layer/)
