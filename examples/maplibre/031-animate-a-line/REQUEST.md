# maplibre-031-animate-a-line: Animate a line

## 依頼内容

MapLibre GL JS の [Animate a line](https://maplibre.org/maplibre-gl-js/docs/examples/animate-a-line/) サンプルと同じ意図で、経度 0〜360度、緯度 -40〜40度の正弦波（Sine wave）経路を毎フレーム成長させながらアニメーション描画する地図を、外部ライブラリ（MapLibre GL JS 等）なしで最小・最速に再現したい。

## 実装方針

1. **外部依存ゼロの Canvas 2D レンダラー**:
   - 背景地図には Natural Earth 110m 陸地境界ポリゴンを事前投影・量子化してベイク。
   - 成長する正弦波ラインを Canvas 2D のパス描画で鮮明（アンチエイリアス・round cap/join）かつ超軽量（数KB）に描画。
2. **フレームごとの正弦波進行**:
   - `requestAnimationFrame` に従い、毎フレーム進捗 `step` を進め、計算された正弦波座標を配列に追加して再描画。
   - 全360ステップに達した後はリセットまたはループ可能。
3. **画面読み戻し検証**:
   - 初期フレームにおける開始地点（経度0付近）のピクセル検証。
   - アニメーション進行後の描画ピクセル変化検証。
   - 陸地背景およびアニメーションラインが正弦波形状に描かれていることの幾何・色検証。
