# maplibre-038-animate-symbol-to-follow-the-mouse: Animate symbol to follow the mouse

## 依頼内容

MapLibre GL JS の [Animate symbol to follow the mouse](https://maplibre.org/maplibre-gl-js/docs/examples/animate-symbol-to-follow-the-mouse/) サンプルと同じ意図で、マウスカーソルの地理座標（経緯度）に追従してシンボルマーカーが滑らかに移動する地図を、外部ライブラリ（MapLibre GL JS 等）なしで最小・最速に再現したい。

## 実装方針

1. **外部依存ゼロの Canvas 2D マウス追従描画**:
   - 背景地図には Natural Earth 110m 陸地境界ポリゴンを事前投影・量子化してベイク。
   - マウス移動時にスクリーン座標から Mercator 経緯度を逆算し、マーカー位置を更新。
   - `requestAnimationFrame` に従う描画ループまたはイベントドリブンで、シンボル（青色円形マーカー + ピン風アイコン）を遅延ゼロで追従描画。
2. **パフォーマンス**:
   - MapLibre GL JS での GeoJSON オブジェクト生成・Worker シリアライズ・GPU アップロードという重厚なパイプラインを排除。
   - メインスレッドの直接 Canvas 2D 描画により、0.2 ms 未満の再描画時間と 60 fps / 120 fps の超低遅延マウス追従を実現。
3. **画面読み戻し検証**:
   - 初期位置でのシンボル描画検証。
   - マウスカーソル移動（プログラムによるマウスイベント発火）後のシンボル移動とピクセル色検証。
   - 現在の追従座標（経緯度表示 HUD）の更新検証。
