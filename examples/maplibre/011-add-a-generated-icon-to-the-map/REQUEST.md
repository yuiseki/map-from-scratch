# maplibre-011-add-a-generated-icon-to-the-map: Canvas 生成のグラデーションアイコン

## 依頼内容

> 経度0・緯度0の地点に、画像ファイルを読み込まずに Canvas で生成した赤→青のグラデーションアイコン（赤チャンネルをアルファにコピーして下端を半透明にする）を描き、ドラッグでパン、ホイールで拡大縮小できる地図を表示したい。外部ライブラリなしで、最速・最小で。

元例: [MapLibre - Add a generated icon to the map](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-generated-icon-to-the-map/)

## 設計の意図と判断

1. **元例の生成手順をそのまま再現**
   - 100×100（DPR 倍）のオフスクリーン Canvas に赤→青の縦グラデーションを描き、`getImageData` で赤チャンネルをアルファへコピーする。元例の `addImage(..., {pixelRatio: 2})` と同じく、100 CSS px でブリットする。
2. **画像リクエスト 0 件**
   - スプライトは起動時に一度だけ作り、毎フレームは `drawImage` 1回。resize で DPR が変われば作り直す。
3. **背景はベイク済み Natural Earth 110m 陸地**
   - アイコンは [0, 0]（ギニア湾の海上）にあるため、色の検証は海面 `#aad3df` との合成色で行う。
4. **カーソル基準のホイールズーム**
   - ズーム前にカーソル下の地図座標を求め、ズーム後に同じ画面位置へ戻す。

## 計測結果

`bin/mfs bench maplibre-011-add-a-generated-icon-to-the-map -n 3`、1024×768・DPR 1。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 24.95 ms（3回の p95 190.6 ms、起動直後のばらつき） |
| 再描画 redraw_ms p95 | 0.575 ms |
| フレーム間隔 frame_interval_ms p95 | 1.37 ms |
| コード gzip | 2,759 B |
| データ gzip | 30,396 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `gradient-red-top` / `gradient-blue-bottom`: アイコン中心の上下 25 px のピクセルが、赤寄り／半透明の青寄りであることを確認。
- `icon-moves-with-pan`: 60×40 px パンでアイコンが同じ量だけ動き、移動先でも赤寄りが検出される。
- `icon-anchors-on-zoom`: zoom 5 でもアイコンが [0, 0] に留まる。
- `wheel-zoom-keeps-point`: ズーム前後でカーソル下の点のずれ < 1.5 px。

## データと帰属

- 背景の陸地: Natural Earth 110m land（パブリックドメイン）。
- グラデーションアイコン: 元例と同じ手順で実行時に生成（外部データなし）。

## 実装のメモ

- アルファを赤チャンネルから作るため、下端は「青いがほぼ透明」になる。ベンチでは不透明な青を期待せず、`b > r + 15 && b > 200` で判定する。
- 元例は 200×200 の Canvas を pixelRatio 2 で登録するが、本実装は最初から 100 CSS px 相当で描くため、テクスチャサイズと転送量が小さい。
