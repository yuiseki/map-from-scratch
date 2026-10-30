# MapLibre "Draw a circle" に対応する専用描画器

[Draw a circle](https://maplibre.org/maplibre-gl-js/docs/examples/draw-a-circle/) は、`turf.circle` で作った半径 50 km の円ポリゴンを GeoJSON ソースとして追加し、半透明の青で塗る例です。

この実装は同じ中心（[-74.5, 40]）と半径（50 km）の円を、ベイク時に Web Mercator のリングへ変換して Canvas 2D で塗ります。ドラッグによるパンとホイールズームを持ち、円は地理座標に固定されて操作に追従します。

## 背景地図の追加（2026-10-30）

最初の版の背景は Natural Earth 110m の陸ポリゴンだけで、ズーム 9 では海岸線がブロック状の一色になり「背景地図がない」状態でした。元例は OSM のラスタタイルの上に円を描きます。

- 実行時に [OSM Carto の 512 px ラスタタイル](https://tile.yuiseki.net/styles/512/osm-carto.json) を、表示範囲と `z=round(zoom)` だけ取得して最下層に描く。
- 初回フレームはタイルを待たずにベイクした陸ポリゴンで描き、到着したタイルが順に重なる（`createImageBitmap` → `drawImage`、再描画は `requestAnimationFrame` で 1 回にまとめる）。
- オフラインや TileJSON 取得失敗時は陸ポリゴンがそのまま残る。
- 帰属表示はパネルに © OpenStreetMap contributors / © OpenMapTiles を出す。

検証は背景と円を分けて行います。下地に道路・地名が入ると、半透明の青のピクセル判定が下地の色で揺れるため、円のチェック中は下地を隠し、下地自体は「画面全体の異なる色数」で別チェック（`basemap-drawn`）にしました。

## データと帰属

- 背景の陸地: Natural Earth 110m land（パブリックドメイン）、タイル到着までの代替。
- 下地タイル: OSM Carto via tile.yuiseki.net（© OpenStreetMap contributors, © OpenMapTiles, ODbL）。
- 円: 元例と同じ中心・半径からベイク時に生成。

## 計測

`bin/mfs bench maplibre-084-draw-a-circle -n 3` を3反復した。画面は1024×768・DPR 1。Canvas 2D なので GPU 時間は取得できない（`gpu: n/a`）。

| 指標 | 結果 | 予算 |
| --- | ---: | ---: |
| 初回表示 p50 | 9.7 ms（タイルは非同期） | 300 ms 以下 |
| 再描画 p95 | 0.82 ms | 2.0 ms 以下 |
| フレーム間隔 p95 | 13.45 ms | 20 ms 以下 |
| コード gzip | 3,852 B | 6,000 B 以下 |
| データ gzip | 31,090 B（land.json + circle.json、タイルは実行時取得） | 38,000 B 以下 |

画面ピクセルと操作の検証6項目は3反復すべてで通った。

## 検証チェック

- `basemap-drawn`: 下地タイルの到着を待ち、表示範囲で ready なタイル ≥ 8、キャンバス全体（4 px 間引き）の異なる色 > 150。
- `circle-data-loaded`: 半径 50,000 m・中心 [-74.5, 40] がベイク済みデータから読まれる。
- `circle-fill-visible`: 下地を隠した状態で円の中心が半透明の青。
- `circle-radius-kept`: 中心から 170 px は内側、260 px は外側。
- `pan-moves-circle`: 40×20 px のパンで円が同じだけ動く。
- `zoom-keeps-circle`: ズーム 10 でも円が中心に残る。

## 実装のメモ

- 円はメートル半径のまま実行時に描かず、ベイク時にメルカトル座標のリングへ変換する。
- 半透明の塗りは背景色と混ざるので、検証は青成分と赤成分の差で行う。
- 結果ファイルには check の合否のみが残り、色数などの detail は保存されないため、evidence はしきい値で書いている。
