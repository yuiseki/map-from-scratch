# MapLibre: Disable scroll zoom

MapLibre GL JS の公式サンプル「[Disable scroll zoom](https://maplibre.org/maplibre-gl-js/docs/examples/disable-scroll-zoom/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心座標 `[-122.65, 45.52]`（ポートランド）、ズームレベル `zoom: 3` で地図を表示する。
2. `map.scrollZoom.disable()` と同等に、マウスホイールやトラックパッドによる拡大縮小（スクロールズーム）をデフォルトで無効化する。
3. ドラッグによる地図のパン操作は通常どおり許可する。
4. UI ボタンまたはメソッド経由でスクロールズームの有効/無効を切り替え可能にし、ピクセル読み戻しとズーム状態検証で動作を確認する。
