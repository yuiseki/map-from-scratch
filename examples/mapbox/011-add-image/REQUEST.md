# Mapbox: Add an image

Mapbox GL JS の公式サンプル「[Add an image](https://docs.mapbox.com/mapbox-gl-js/example/add-image/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心 `[-75.789, 41.874]`、`zoom: 5` のニューイングランド周辺の地図を表示する。
2. 4 隅 `[-80.425, 37.936]`〜`[-71.516, 46.437]` の矩形に 1 枚の画像を貼る。
3. パン・ズームすると画像は地図に固定されて一緒に動く。

## 元例との差分

- 元例は Mapbox の `image` ソースに GIF のレーダー画像を指定する。ここではベイク時に Node の zlib で 256×256 の PNG を生成し、4 象限を色分けした円を描く（向きの検証のため）。
- 元例の背景は Mapbox のベクター地図。ここでは OSM Carto のラスタタイル（512 px）を描き、届くまで Natural Earth 陸地で埋める。

## 設計の意図と判断

1. **画像は全画素不透明にする**
   - 半透明だと下の地図と合成され、検証の期待色が背景に依存する。alpha 255 なら画面上の色が厳密に一致し、向き・位置の誤りを 1 ピクセル単位で検出できる。
2. **軸平行の 4 隅なら drawImage 1 回**
   - 経度・緯度の矩形は Web Mercator でも矩形のまま。回転した四隅は Canvas の transform が必要になるが、この例では不要。
3. **背景を隠してから色を読む**
   - 厳密色の検証はラスタ背景を隠した状態で行う。背景そのものは別チェック（色数 > 150）で検証する。
4. **向きは 4 象限の色で証明する**
   - 緑 NW・黄 NE・橙 SW・赤 SE。反転・転置・回転のどれが起きても別の色が来る。
5. **ベイクで PNG を生成**
   - 画像の用意に外部ツールを使わず、IHDR/IDAT/IEND と CRC32 を最小実装。ランタイム側は `createImageBitmap` だけで読む。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 12.88 ms |
| 再描画 redraw_ms p95 | 0.515 ms |
| フレーム間隔 frame_interval_ms p95 | 7.225 ms |
| コード gzip | 3,999 B |
| データ gzip | 31,670 B |
| 検証チェック | 6 / 6 PASS |

## 検証チェック

- `basemap-drawn`: 画像の下にラスタ地図（タイル全 ready、色数 > 150）。
- `image-loaded`: 画像の読み込み完了。
- `image-cells-in-place`: 画像内 25%/75% の 4 象限が期待 RGB と完全一致。
- `image-clipped-to-bounds`: 西端の内側 4 px が画像背景色、外側 12 px が陸地色。
- `image-follows-pan`: 150×60 px パンで 4 隅がちょうど +150/+60 px 動き、旧位置は陸地に戻る。
- `image-anchors-on-zoom`: 画像中心を軸に zoom 6 で幅が 2 倍、4 象限の色が維持される。

## データ

- 貼る画像: ベイク時に生成した 256×256 RGBA PNG（4 象限に色分けした円、全画素不透明）。
- Natural Earth 110m 陸地（パブリックドメイン）を Web Mercator へ投影。
- 背景タイル: OSM Carto（© OpenStreetMap contributors、ODbL / © OpenMapTiles）。

## 実装上の落とし穴

- 半透明の画像だと厳密色の検証が成り立たない。alpha を 255 に統一してから検証を書く。
- タイル到着前に色を読むと陸地色が返る。`baseReady() === baseVisible()` を待ってから数える。
