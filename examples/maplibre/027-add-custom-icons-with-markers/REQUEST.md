# maplibre-027-add-custom-icons-with-markers: 3色のカスタムピンと OSM 背景

## 依頼内容

> マンハッタン周辺の3地点に、画像ファイルを読み込まずに描いた緑・橙・紅のピンアイコンを置き、OpenStreetMap のラスター地図を背景に、ドラッグでパン、ホイールで拡大縮小できる地図を表示したい。外部ライブラリなしで、最速・最小で。

元例: [MapLibre - Add custom icons with Markers](https://maplibre.org/maplibre-gl-js/docs/examples/add-custom-icons-with-markers/)

## 設計の意図と判断

1. **ピンは色ごとに1枚のスプライト**
   - 36×48 のピンを DPR 倍で3枚描き、毎フレームは `drawImage` を3回。先端（tip）を地理座標に合わせて置くので、ズームしても頭が北へずれない。
2. **都市スケールには実背景地図**
   - Natural Earth 110m だけでは z10 のマンハッタンが単色の面になる。012/084 と同じ OSM Carto 512 px タイル（`tile.yuiseki.net`）を実行時に取得し、陸地はタイル到着までのプレースホルダにする。
3. **描画順は「陸地 → タイル → ピン」**
   - ピンを最後に描くため、タイルの到着やパンでピンが隠れず、ピクセル色の検証も背景内容に依存しない。
4. **タイルが揃ったら陸地の塗りを省略**
   - 全可視タイルが ready のフレームは 127 ポリゴンのパス塗りをスキップし、`drawImage` 20回だけにする。

## 計測結果

`bin/mfs bench maplibre-027-add-custom-icons-with-markers -n 3`、1024×768・DPR 1。タイル取得を含む。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 51.64 ms（3回の p95 81.9 ms） |
| 再描画 redraw_ms p95 | 0.11 ms |
| フレーム間隔 frame_interval_ms p95 | 2.88 ms |
| コード gzip | 4,182 B |
| データ gzip | 30,396 B |
| 検証チェック | 6 / 6 PASS |

初回フレームはラスター20枚の取得開始と重なるが、ピンと陸地は同期的に描かれる。計測はタイル取得完了後、全タイルが揃った状態で行っている。

## 検証チェック

- `basemap-drawn`: 画面全体を 8 px 間隔で色数え、可視タイルがすべて ready かつ異なる色 > 200 種であることを確認。
- `custom-icons-visible`: 3本のピン頭部が緑・橙・紅それぞれの RGB（差 10 以内）で描かれている。
- `markers-move-with-pan`: 40×25 px パンで3本とも同じ量だけ動く。
- `marker-spacing-scales`: z10→z11 でピン0-1間の画面距離が 2 ± 0.05 倍になる（地理座標に固定されている）。
- `markers-anchor-on-zoom`: ズーム後も3色が新しい位置で検出される。
- `wheel-zoom-keeps-point`: ズーム前後でピン0のずれ < 1.5 px。

## データと帰属

- 背景の陸地: Natural Earth 110m land（パブリックドメイン）。タイル到着前のプレースホルダ。
- 背景タイル: OpenStreetMap データ © OpenStreetMap contributors（ODbL）、© OpenMapTiles、OSM Carto。`https://tile.yuiseki.net/styles/512/osm-carto.json` を実行時に取得（CORS `*`、z0–20）。
- ピン: 実行時に Canvas で生成。

## 実装のメモ

- タイルは 512 px PNG を 256 CSS px に縮小して描く。描画矩形の端を `Math.round` で共有するため、タイル間に継ぎ目が出ない。
- ベンチの最後に `resetView()` して全タイル到着を待つ。これをしないとスクリーンショットが「ズーム12の未取得タイル＝陸地プレースホルダ」になる（実際に一度そうなった）。
