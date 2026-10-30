# MapLibre "Fit a map to a bounding box" に対応する専用描画器

[Fit a map to a bounding box](https://maplibre.org/maplibre-gl-js/docs/examples/fit-a-map-to-a-bounding-box/) は、ニューヨーク [-74.5, 40]・ズーム 9 で開き、ボタンのクリックで `map.fitBounds([[32.958984, -5.353521], [43.50585, 5.615985]])` を呼ぶ例です。

この実装は同じ初期表示から、ボタン1回でその範囲（タンザニア〜ケニア）がビューポートに収まるよう中心とズームを計算します。範囲の四隅と中心には赤・青の目印を描き、パンとズームにも追従させます。

## 設計の意図と判断

1. **fitBounds は中点と min だけで再現できる**
   - padding 0 の MapLibre `cameraForBounds` は、中心をバウンディングボックスのメルカトル中点、ズームを `min(幅/経度スパン, 高さ/緯度スパン)` から `log2` で決めます。カメラ行列も反復計算も不要です。
   - 1024×768 ではこの範囲は高さ方向が制約になり、上下マージン 0 px・左右マージン約 344 px でフィットします。
2. **目印でフィット範囲を可視化**
   - 元例は背景地図だけですが、この実装は検証のために四隅（赤）と中心（青）に小さな点を描きます。ピクセル読み戻しで「範囲がどこに落ちたか」を厳密に検査できます。
3. **256 px ズーム基準**
   - リポジトリ共通の投影に合わせ、ズームは 256 px タイル基準です（MapLibre GL JS の 512 px 基準より値が 1 大きい）。画面上のフィット結果は同じです。

## 背景地図

ズーム 9（ニューヨーク）とフィット後のズームの両方で道路・地名が読めるよう、実行時に [OSM Carto の 512 px ラスタタイル](https://tile.yuiseki.net/styles/512/osm-carto.json) を表示範囲だけ取得して最下層に描きます。初回フレームは Natural Earth 110m の陸ポリゴンで描き、到着したタイルが順に重なります。

## 計測結果

`bin/mfs bench maplibre-096-fit-a-map-to-a-bounding-box -n 3`（1024×768、DPR 1）。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 9.43 ms（タイルは非同期） |
| 再描画 redraw_ms p95 | 0.61 ms |
| フレーム間隔 frame_interval_ms p95 | 8.0 ms |
| コード gzip | 4,315 B |
| データ gzip | 30,400 B |
| 検証チェック | 7 / 7 PASS |

## 検証チェック

- `basemap-drawn`: 表示範囲のタイルがすべて到着し、画面に 150 色超。
- `initial-view-is-new-york`: ボタン前は [-74.5, 40]・ズーム 9。
- `fit-sets-camera`: 独立計算した中心（メルカトル中点）・ズーム（6.519）と一致。
- `fit-bounds-flush`: 四隅の投影座標が上下端に接し、左右マージンが対称。
- `fit-corner-markers-drawn`: 四隅 (230,57,70)・中心 (30,111,217) の目印がピクセルで確認できる。
- `pan-moves-bounds`: 80×50 px のパンで範囲と目印が同じ量だけ移動。
- `zoom-keeps-bounds`: 範囲中心を固定して zoom +1 すると四隅のオフセットが2倍。

## データ

- 背景の陸地: Natural Earth 110m land（パブリックドメイン）、タイル到着までの代替。
- 下地タイル: OSM Carto via tile.yuiseki.net（© OpenStreetMap contributors, © OpenMapTiles, ODbL）。

## 実装上の落とし穴

- パンの後に「ビューポート中心」を軸にズームすると、バウンディングボックスの中心は画面中心から動く。検証は範囲中心の投影座標を軸にする（最初はこれで中心の目印を読み違えて FAIL した）。
- フィット後は範囲がビューポートを覆うため、「内側」「外側」の色ではなく四隅と中心の目印の厳密な RGB で位置を確認する。
