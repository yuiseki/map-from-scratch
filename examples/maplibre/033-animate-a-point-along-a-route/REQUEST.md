# maplibre-033-animate-a-point-along-a-route: Animate a point along a route

## 依頼内容

MapLibre GL JS の [Animate a point along a route](https://maplibre.org/maplibre-gl-js/docs/examples/animate-a-point-along-a-route/) サンプルと同じ意図で、サンフランシスコからワシントンD.C.への大圏航路（大圏アーク）上にルートラインを描画し、その経路上をポイントシンボルがスムーズに移動・アニメーションする地図を、外部ライブラリ（MapLibre GL JS, Turf.js）なしで最小・最速に再現したい。

## 実装方針

1. **外部依存ゼロ（Turf.js / MapLibre 排除）**:
   - ベイク時に大圏補間（Slerp）によりサンフランシスコ（-122.414, 37.776）からワシントンD.C.（-77.032, 38.913）への500分割の測地線アーク座標を事前計算。
   - 自然な大圏航路として Web Mercator [0..1] 座標系に投影してベイク。
2. **Canvas 2D 直接描画**:
   - 背景地図（北米大陸を含む Natural Earth 110m land）をベイク。
   - ルートライン（#4882c5）と移動ポイント（円形マーカー #3887be、白枠付き）を Canvas 2D で軽量に直接描画。
3. **画面読み戻し検証**:
   - 初期位置（サンフランシスコ）でのポイントマーカー描画検証。
   - アニメーション進行後のポイント移動および軌跡ピクセル検証。
   - 終点（ワシントンD.C.）到達後のリプレイ動作検証。
