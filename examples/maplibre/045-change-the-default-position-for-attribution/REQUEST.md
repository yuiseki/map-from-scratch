# MapLibre "Change the default position for attribution" に対応する専用描画器

[Change the default position for attribution](https://maplibre.org/maplibre-gl-js/docs/examples/change-the-default-position-for-attribution/) は、`attributionControl: false` で地図を作り、`AttributionControl` を `top-left` に追加して既定の右下から左上へ移す例です。

この実装はワシントン DC 周辺 [-77.04, 38.907]・ズーム 2 の地図に、白い角丸の出典表示「© Natural Earth (public domain)」を左上へ余白 12 px で置きます。パン・ズームしても出典表示は画面の同じ位置に留まります。

## 設計の意図と判断

1. **出典表示は画面座標で描く**
   - 地理座標に紐づけるとパンで動いてしまいます。カメラ更新と独立した矩形を毎フレーム描き直します。
2. **矩形は1つの関数から**
   - 隅の名前から `{x, y, width, height}` を求める関数を描画と検証で共有し、検証側はビューポートから独立に期待値を再計算します。
3. **既定の隅が空いていることも検証**
   - 「左上に箱がある」だけでは、既定の右下にも描く退行を見逃します。左右下隅の箱色と暗色文字数も数えます。
4. **パネルは上部中央**
   - 左上の出典表示を隠さないよう、説明パネルは画面中央上に置きます。
5. **背景は Natural Earth 陸地**
   - 世界スケール（ズーム 2）なのでラスタタイルは使わず、Natural Earth 110m の陸地で足ります。

## 計測結果

`bin/mfs bench maplibre-045-change-the-default-position-for-attribution -n 3`（1024×768、DPR 1）。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 12.9 ms |
| 再描画 redraw_ms p95 | 0.445 ms |
| フレーム間隔 frame_interval_ms p95 | 6.34 ms |
| コード gzip | 3,030 B |
| データ gzip | 30,400 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `attribution-visible-top-left`: 左上 (12,12,222,28) に白箱と暗色文字 > 20 px。
- `default-corners-free`: 右下・左下に箱も文字もない。
- `map-rendered-at-target`: 中心は陸地、[-60,30] は海洋。
- `attribution-fixed-on-pan`: 120×90 px パンで地図だけが動き、矩形は完全一致。
- `attribution-fixed-on-zoom`: zoom 3.5 でも矩形は完全一致。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。

## 実装上の落とし穴

- 出典表示の隅を切り替える UI を持たないため、位置の正しさは「左上にある」「既定の隅にない」の両方で確かめる必要がある。
- 箱の白ピクセルだけでは文字の欠落を見逃すので、暗色ピクセルも数える。
