# maplibre-018-add-a-raster-tile-source: TileJSON を読むラスタータイル地図

## 依頼内容

> TileJSON で配信されるラスタータイル地図（512px、XYZ）を表示したい。TileJSON の tiles テンプレート・tileSize・minzoom/maxzoom・attribution を読んで描き、ドラッグでパン、ホイールで拡大縮小、3つのスタイル（osm-carto / osm-liberty / osm-bright）を切り替えられるようにする。地図エンジンは使わず Canvas 2D で実装する。

TileJSON（すべて `https://tile.yuiseki.net/styles/512/` 配信、CORS `*`）:

- `osm-carto.json` → `https://tile.yuiseki.net/styles/osm-carto/512/{z}/{x}/{y}.png`
- `osm-liberty.json` → `https://tile.yuiseki.net/styles/osm-liberty/512/{z}/{x}/{y}.png`
- `osm-bright.json` → `https://tile.yuiseki.net/styles/osm-bright/512/{z}/{x}/{y}.png`

元例: [MapLibre - Add a raster tile source](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/)

## 設計の意図と判断

1. **ベイクしない例**
   - データは実行時に TileJSON とタイルを取得する。ビルド成果物はコードだけ（data_bytes = 0）。`tiles` テンプレート・`tileSize`・`minzoom/maxzoom`・`attribution` はすべて TileJSON から読み、コードには URL 3 本しか埋め込まない。
2. **タイル端は「原点＋整数インデックス」から1式で丸める**
   - `X0 = round(originX + x*tile)`、`X1 = round(originX + (x+1)*tile)`、幅は `X1 − X0`。隣接タイルが同じ境界を共有するので、等倍時は境界に背景色の筋が出ない（OpenLayers/Leaflet が踏んだ 1–2 px の隙間の回避）。
3. **未取得タイルは祖先の部分矩形で埋める**
   - 6 世代上まで遡り、`2^dz` 分割した部分矩形を引き伸ばして置く。ズーム直後でも背景が露出せず、タイルが届いたら差し替える。
4. **decode は createImageBitmap、キャッシュは 200 枚で LRU**
   - `fetch → blob → createImageBitmap` で decode をフレーム外に出す。ImageBitmap は `close()` するまでメモリを保持するので、200 枚を超えたら可視タイル以外を解放する。同時リクエストは 6 本まで。
5. **スタイル切替は TileJSON の差し替え**
   - `setStyle(url)` は TileJSON を読み直してキャッシュを捨て、同じ中心・ズームで描き直す。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 474.5 ms（p95 762.8、4G: 60 ms / 9 Mbps エミュレーション） |
| 再描画 redraw_ms p95 | 0.125 ms |
| フレーム間隔 frame_interval_ms p95 | 6.52 ms |
| コード gzip | 4,399 B |
| データ | 0 B（実行時取得） |
| 初回ビューの通信 | 1,970 KB / 47 リクエスト |
| 検証チェック | 6 / 6 PASS |

## 検証チェック

- `tilejson-loaded`: `tileSize = 512`、tiles が 1 本以上、styleUrl が指定した TileJSON。
- `tiles-cover-viewport`: 8×6 格子の 48 点を読み戻し、背景色 (233,238,242) が 0 件。
- `no-seams-between-tiles`: タイル境界の x 列・y 行を各 5 点読み、背景色 0 件。
- `pan-moves-tiles-exactly`: 6 点の色を控えて panBy(64,48) し、移動先の色が 6/6 一致（等倍・整数パンならピクセル一致）。
- `wheel-zoom-keeps-point`: zoom 5.0→5.6 でカーソル下の地図座標のずれ < 1.5 px。
- `style-switch-repaints`: 16×12 格子を控えて osm-bright に切り替え、20% 以上の点で色差 > 12。

## 補足

- 最初のスタイル切替チェックは 6 点だけを比較し、Carto と Bright で陸地の色が近いため 1/6 しか変わらず FAIL。16×12 格子に広げ、海の色差が拾えるようにして通した。
- 帰属表示は TileJSON の HTML をタグ除去＋主要エンティティ（`&copy;` など）のデコードだけで表示し、リモート HTML を注入しない。
- タイル取得は 4G 相当のネットワークエミュレーション下で計測（`benchmarks.network`）。
