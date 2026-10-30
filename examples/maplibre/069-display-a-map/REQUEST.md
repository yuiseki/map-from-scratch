# MapLibre: Display a map

MapLibre GL JS の公式サンプル「[Display a map](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-map/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 初期表示位置を `center: [0, 0]`、ズームレベルを `zoom: 1` として、世界地図をウェブページ上に描画する。
2. 左下に MapLibre のブランドバッジを表示する。
3. ドラッグによる地図のパン、ホイールによるズーム、およびナビゲーションボタン（+/-/リセット）による拡大縮小に対応する。
4. ピクセル読み戻しによって、初期位置の海洋・陸地ピクセル、パンおよびズーム時の追従が正確に行われていることを検証する。
