# maplibre-037-animate-map-camera-around-a-point: Animate map camera around a point

## 依頼内容

MapLibre GL JS の [Animate map camera around a point](https://maplibre.org/maplibre-gl-js/docs/examples/animate-map-camera-around-a-point/) サンプルと同じ意図で、特定の中心点（シカゴ市街地）の周囲をカメラの方位角（Bearing）を毎フレーム滑らかに360度旋回させながら、背景地図を連続回転描画するアニメーションを、外部ライブラリ（MapLibre GL JS 等）なしで最小・最速に再現したい。

## 実装方針

1. **外部依存ゼロの Canvas 2D 回転カメラ描画**:
   - 背景地図には Natural Earth 110m 陸地境界ポリゴンを事前投影・量子化してベイク。
   - カメラ角度 $\theta$ に応じて `ctx.translate()`, `ctx.rotate(-theta)`, `ctx.translate()` の 2D アフィン変換行列を直接適用。
   - `requestAnimationFrame` に従い、毎フレーム滑らかに方位角を回転させて 60 fps で描画。
2. **パフォーマンス**:
   - 汎用 3D エンジンのマトリクス再計算やタイル再投影を排し、Canvas 2D のハードウェアアクセラレーションされた 2D コンテキスト変換で 0.3 ms 未満の再描画を実現。
3. **画面読み戻し検証**:
   - 初期フレームにおける中央および周辺ピクセルの検証。
   - 60フレーム回転後の周辺ピクセル明度・色変化の検証（回転による描画変化の確認）。
   - 中心点が固定されたまま回転していることの幾何検証。
