# MapLibre: Add a GeoJSON line

MapLibre GL JS の公式サンプル「[Add a GeoJSON line](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-geojson-line/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. サンフランシスコ・ゴールデンゲート北側のマリンヘッドランズにあるトレイルルート（GeoJSON LineString）を、背景地図上に描画する。
2. 線幅 8px、色 `#888888`、先端および結合部を丸め（round cap / round join）で描画する。
3. ドラッグによる地図のパン、ホイールによるズーム操作に対応する。
4. 線の色や太さを動的に変更可能にし、ピクセル読み戻しによって正しく描画・スタイル変更・追従が行われていることを検証する。
