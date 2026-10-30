# MapLibre "Get coordinates of the mouse pointer" に対応する専用描画器

[Get coordinates of the mouse pointer](https://maplibre.org/maplibre-gl-js/docs/examples/get-coordinates-of-the-mouse-pointer/) は、ニューヨーク [-74.5, 40]・ズーム 3 の地図で `mousemove` の `e.point` と `e.lngLat.wrap()` をパネルに表示する例です。

この実装は同じ初期表示で、ポインタの画面座標と緯度経度をリアルタイムに表示し、カーソル位置に 1 px の赤い十字線と点を描きます。パンやズームで地図が動いても、カーソルの下にある地点の座標を計算し直します。

## 設計の意図と判断

1. **逆投影は4演算**
   - 画面中心からの差分を `256·2^zoom` で割って中心のメルカトル座標に足し、経度はそのまま、緯度は `atan(exp(...))` で戻します。レイキャストもカメラ行列も不要です。
2. **画面座標だけを状態に持つ**
   - 地理座標を pointermove のときだけ計算すると、パン・ズームでカーソル下の地点が変わったときに表示が古くなります。画面座標だけを保持し、描画のたびに逆投影し直します。
3. **十字線は fillRect**
   - 整数座標に 1 px の stroke を引くと半ピクセルに落ちて 2 行にアンチエイリアスされます。`fillRect(x, y, 1, 1)` なら検証点の色が厳密に一致します。
4. **大陸スケールの背景**
   - ズーム 3 は大陸スケールなので、Natural Earth 110m の陸地ポリゴン（陸 `#f0eee8` / 海 `#aad3df`）で陸海の区別が付きます。都市・地域スケールの例のようにラスタタイルは取得しません。

## 計測結果

`bin/mfs bench maplibre-102-get-coordinates-of-the-mouse-pointer -n 3`（1024×768、DPR 1）。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 9.36 ms |
| 再描画 redraw_ms p95 | 0.575 ms |
| フレーム間隔 frame_interval_ms p95 | 5.88 ms |
| コード gzip | 3,295 B |
| データ gzip | 30,400 B |
| 検証チェック | 8 / 8 PASS |

## 検証チェック

- `no-readout-before-move`: ポインタが入る前は座標なし・十字線なし。
- `map-rendered-at-target`: 中心は陸地、[-40,30] は海洋。
- `readout-matches-projection`: (700,300) の緯度経度が独立計算と 1e-6 以内。
- `crosshair-drawn-at-pointer`: 交点・縦線・横線が (230,57,70) で厳密一致。
- `readout-matches-geography`: 逆投影した大西洋の点は海洋、米国内陸の点は陸地。
- `crosshair-clears-when-moved`: 古い十字線が消え、新しい位置に描かれる。
- `readout-follows-pan`: カーソル固定のまま 100×50 px パンすると座標が更新され、十字線は同じ画面位置。
- `readout-anchors-on-zoom`: カーソル軸の zoom 4 で座標が不変。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。

## 実装上の落とし穴

- `pointerleave` で十字線と表示を消さないと、カーソルが外れた後も古い座標が残る。
- 経度は MapLibre の `lngLat.wrap()` に合わせて [-180, 180) に折り返す。折り返さないと世界を何周もパンしたときに値が発散する。
- 合成 PointerEvent では `setPointerCapture` が例外になるので try/catch で包む。
