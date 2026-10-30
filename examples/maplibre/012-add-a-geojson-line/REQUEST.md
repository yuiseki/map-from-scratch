# MapLibre: Add a GeoJSON line

MapLibre GL JS の公式サンプル「[Add a GeoJSON line](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-geojson-line/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. サンフランシスコ・ゴールデンゲート北側のマリンヘッドランズにあるトレイルルート（GeoJSON LineString）を、背景地図上に描画する。
2. 線幅 8px、色 `#888888`、先端および結合部を丸め（round cap / round join）で描画する。
3. ドラッグによる地図のパン、ホイールによるズーム操作に対応する。
4. 線の色や太さを動的に変更可能にし、ピクセル読み戻しによって正しく描画・スタイル変更・追従が行われていることを検証する。

## 背景地図の追加（2026-10-30）

最初の版の背景は海色＋Natural Earth 110m の陸ポリゴンだけで、初期ズーム 15 では画面全体が一色のベージュになり、道路も地名もない「背景地図がない」状態でした。元例は `https://tiles.openfreemap.org/styles/bright` の上に線を描きます。

- 実行時に [OSM Carto の 512 px ラスタタイル](https://tile.yuiseki.net/styles/512/osm-carto.json) を、表示範囲と `z=round(zoom)` だけ取得して最下層に描く（ラスタタイルの例と同じ TileJSON の読み方）。
- タイルは `256 * 2^(zoom-zi)` CSS px で描くので、z タイルは同じ z の 256 px タイルと同じ地面を覆い、DPR 1 では 2 倍解像度から縮小される。
- 初回フレームはタイルを待たずにベイクした陸ポリゴンで描き、到着したタイルが順に重なる（`createImageBitmap` → `drawImage`）。タイルごとに `requestAnimationFrame` を 1 回にまとめて再描画する。
- オフラインや TileJSON 取得失敗時は陸ポリゴンがそのまま残る。
- 帰属表示はパネルに © OpenStreetMap contributors / © OpenMapTiles を出す。

検証は背景と線を分けて行います。背景地図に道路・地名が入ると、グレーの線のピクセル色が下地の道路と偶然一致して「線がある」と誤判定しうるため、線のチェック中は下地を隠し、下地は「画面全体の異なる色数」で別チェック（`basemap-drawn`）にしました。

## 計測結果

計測は `bin/mfs bench maplibre-012-add-a-geojson-line -n 3`（1024×768、DPR 1）。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 10.0 ms（タイルは非同期、p95 97.8） |
| 再描画 redraw_ms p95 | 0.57 ms（max 1.0、下地 20 枚込み） |
| フレーム間隔 frame_interval_ms p95 | 12.5 ms |
| コード gzip | 4,422 B |
| データ gzip | 30,560 B（land.json + route.json、タイルは実行時取得） |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `basemap-drawn`: 下地タイルの到着を待ち、表示範囲で ready なタイル ≥ 8、キャンバス全体（4 px 間引き）の異なる色 > 200。
- `line-rendered-gray`: 下地を隠した状態でルート上のピクセルが #888888（各成分 ±20）。
- `line-moves-with-pan`: 60×40 px のパンで線が正確に移動し、移動先がグレー。
- `line-restyled`: `setLineStyle('#3887be', 12)` で青くなる。
- `line-anchors-on-zoom`: z16 でもルート座標のピクセルが青いまま。

## 補足

- マリンヘッドランズは公園で、OSM Carto の z15 タイルは緑の landcover・遊歩道・海岸線が見える程度です。中心から東のサウサリート側には市街の道路と地名が入ります。
- 結果ファイル（`results/maplibre-012-add-a-geojson-line/latest.json`）には check の合否のみが残り、色数などの detail は保存されないため、evidence はしきい値で書いています。
- データの出典: ルートは MapLibre 公式例、陸は Natural Earth（パブリックドメイン）、下地は OSM Carto（ODbL）。
