# Mapbox: Disable scroll zoom

Mapbox GL JS の公式サンプル「[Disable scroll zoom](https://docs.mapbox.com/mapbox-gl-js/example/disable-scroll-zoom/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心 `[-96.0, 37.8]`、`zoom: 3` の地図を表示する。
2. ホイールによるズームを無効にする（ページ自体もスクロールさせない）。
3. ドラッグによるパンは有効、ダブルクリックによるズームは有効のまま。
4. ホイール前後のカメラ状態と画面ピクセルで、無効化と他の操作の生存を検証する。

## 設計の意図と判断

1. **無効化は「ズームを計算しない」だけ**
   - wheel イベントで `preventDefault()` を呼び、カメラの更新は行わない。ハンドラを外すとページがスクロールしてしまう。
2. **ダブルクリックズームは同じ式を再利用**
   - `zoomAtPoint(x, y, zoom+1)` はホイールズームと同じ。入力だけが違う。
3. **再描画ゼロのホイール**
   - ズームを計算しないので、ホイール連打でも描画は起きない。カメラの比較は完全一致で行える。
4. **背景は Natural Earth 陸地**
   - 大陸スケール（zoom 3）なのでラスタタイルは使わない。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 15.54 ms |
| 再描画 redraw_ms p95 | 0.425 ms |
| フレーム間隔 frame_interval_ms p95 | 6.425 ms |
| コード gzip | 2,563 B |
| データ gzip | 30,400 B |
| 検証チェック | 4 / 4 PASS |

## 検証チェック

- `wheel-does-not-zoom`: ホイール 2 回で zoom・中心・ピクセルが不変。
- `double-click-zooms`: (700,300) のダブルクリックで zoom 4、カーソル下の座標は不動。
- `wheel-stays-disabled`: ズーム後のホイールも無効。
- `drag-still-pans`: 40×20 px のドラッグでパンする。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。

## 実装上の落とし穴

- Chrome はキャンセル可能な wheel イベントでのみ `preventDefault()` を尊重する。`{ passive: false }` を忘れるとホイールがページスクロールに流れる。
