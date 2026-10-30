# maplibre-025-add-an-icon-to-the-map: 生成スプライトのアイコン

## 依頼内容

> 経度0・緯度0の地点に、画像ファイルを読み込まずに生成した猫のアイコンスプライトを描き、ドラッグでパン、ホイールで拡大縮小できる地図を表示したい。外部ライブラリなしで、最速・最小で。

元例: [MapLibre - Add an icon to the map](https://maplibre.org/maplibre-gl-js/docs/examples/add-an-icon-to-the-map/)

## 設計の意図と判断

1. **画像リクエストの代わりに手続き的スプライト**
   - 元例は `cat.png` を `loadImage` して `addImage` する。本実装は起動時に 48×48 のオフスクリーン Canvas へ猫の顔（耳・目・口・ひげ）を一度だけ描き、毎フレームは `drawImage` で1回ブリットする。画像の取得・デコード・CORS の考慮がすべて不要になり、初回フレームにアイコンが揃う。
2. **DPR に追従するスプライト**
   - スプライトは `devicePixelRatio` 倍の解像度で生成し、CSS サイズ（48 px）でブリットする。resize 時に DPR が変われば作り直すため、高 DPI でも滲まない。
3. **MapLibre と同じ世界コピー**
   - 経度方向に世界を繰り返し描き、パンで端まで行っても陸地が途切れない。
4. **カーソル基準のホイールズーム**
   - ズーム前にカーソル下の地図座標を求め、ズーム後に同じ画面位置へ戻すよう中心を補正する。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 12.23 ms |
| 再描画 redraw_ms p95 | 0.43 ms |
| フレーム間隔 frame_interval_ms p95 | 0.85 ms |
| コード gzip | 2,857 B |
| データ gzip | 30,400 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `icon-sprite-visible` / `icon-sprite-details-visible`: 顔の橙色と目の濃色を画面ピクセルで確認（スプライトが実際に描かれている）。
- `icon-moves-with-pan`: 60×40 px パンでアイコンが同じ量だけ動き、移動先でも橙色が検出される。
- `icon-anchors-on-zoom`: zoom 5 でもアイコンが [0, 0] に留まる。
- `wheel-zoom-keeps-point`: ズーム前後でカーソル下の点のずれ < 1.5 px。
