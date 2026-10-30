# MapLibre: Add a GeoJSON polygon

MapLibre GL JS の公式サンプル「[Add a GeoJSON polygon](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-geojson-polygon/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. アメリカ・メイン州（Maine）の境界ポリゴン（GeoJSON Polygon）を、背景地図上に半透明の塗りつぶし（fill-color: `#008888`、fill-opacity: 0.8）として描画する。
2. ドラッグによる地図のパン、ホイールによるズーム操作に対応する。
3. ポリゴンの塗りつぶし色や不透明度を動的に変更可能にし、ピクセル読み戻しによって正しく描画・スタイル変更・追従が行われていることを検証する。
