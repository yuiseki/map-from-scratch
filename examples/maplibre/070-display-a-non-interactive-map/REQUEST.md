# MapLibre: Display a non-interactive map

MapLibre GL JS の公式サンプル「[Display a non-interactive map](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-non-interactive-map/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心座標 `[74.5, 40.0]`（中央アジア）、ズームレベル `zoom: 3` で静的地図を表示する。
2. `interactive: false` と同等に、パン・ズーム・回転などのユーザー操作ハンドラーを無効化し、ドラッグやホイールによる誤操作が起きない静的ビューを提供する。
3. ポインターイベントやホイールイベントを送信してもカメラ位置・ズームレベルが不変であることをピクセル読み戻しと状態検証で確認する。
