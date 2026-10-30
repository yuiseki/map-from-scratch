# d3-010-web-mercator-tiles: タイル格子と z/x/y を重ねるラスタータイル地図

## 依頼内容

> D3 の tile / geo のデモと同じ意図で、Web Mercator のラスタータイル地図にタイル境界と z/x/y のアドレスを重ねて表示したい。TileJSON（https://tile.yuiseki.net/styles/512/osm-carto.json）の tiles テンプレート・tileSize・minzoom/maxzoom・attribution を読んで描き、ポインタ下のタイルの z/x/y を読み出せるようにする。ドラッグでパン、ホイールでズーム。地図エンジンも D3 本体も使わず Canvas 2D で実装する。

元例: [D3 - Web Mercator tiles](https://observablehq.com/@d3/web-mercator-tiles)、
[D3 - Raster tiles](https://observablehq.com/@d3/raster-tiles)

## 設計の意図と判断

1. **ベイクしない例**
   - データは実行時に TileJSON とタイルを取得する（data_bytes = 0）。`tiles` テンプレート・`tileSize`（512）・`minzoom/maxzoom`・`attribution` はすべて TileJSON から読み、コードには URL 1 本しか埋め込まない。
2. **格子は描画と同じ式から引く**
   - タイル境界は `X = round(originX + x*tileDev)`（配置と同じ式）で求め、線は +0.5 px に引く。線・ラベル・ポインタ下の z/x/y の当たり判定がすべて同じ整数ズーム・同じ原点から出るので、線が隙間や別のタイルを指すことがない。
3. **タイル端は「原点＋整数インデックス」から1式で丸める**
   - `X0 = round(originX + x*tile)`、`X1 = round(originX + (x+1)*tile)`、幅は `X1 − X0`。隣接タイルが同じ境界を共有し、等倍時は背景色の筋が出ない。
4. **未取得タイルは祖先の部分矩形で埋める**
   - 6 世代上まで遡り、`2^dz` 分割した部分矩形を引き伸ばす。ズーム直後でも背景が露出しない。
5. **decode は createImageBitmap、キャッシュは 200 枚で LRU**
   - `fetch → blob → createImageBitmap` で decode をフレーム外に出す。ImageBitmap は `close()` するまでメモリを保持するので、200 枚を超えたら可視タイル以外を解放する。同時リクエストは 6 本まで。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 475.3 ms（p95 974.5、4G: 60 ms / 9 Mbps エミュレーション） |
| 再描画 redraw_ms p95 | 0.305 ms（max 0.435） |
| フレーム間隔 frame_interval_ms p95 | 7.18 ms |
| コード gzip | 4,617 B |
| データ | 0 B（実行時取得） |
| 初回ビューの通信 | 1,305 KB / 27 リクエスト |
| JS ヒープ | 1.459 MB |
| 検証チェック | 6 / 6 PASS |

## 検証チェック

- `tilejson-loaded`: `tileSize = 512`、tiles が `{z}/{x}/{y}` 形式。
- `tiles-cover-viewport`: 8×6 格子の 48 点を読み戻し、背景色 (233,238,242) が 0 件。
- `grid-lines-visible`: 各タイル縦境界の 4 点で、境界の青さ (b−r) が左右 6 px より 40 以上大きい点が 70% 以上。半透明線は下地で合成色が変わるため、絶対色ではなく近傍との差で判定する。
- `tile-address-follows-geography`: 中心の lon/lat から Web Mercator の式で z/x/y を計算し `tileAddressAt` と一致。1 タイル幅パンで x が 1 減る。
- `pan-moves-tiles-exactly`: 6 点の色を控えて panBy(64,48) し、移動先の色が 6/6 一致（等倍・整数パンならピクセル一致）。
- `zoom-keeps-point-and-tile-set`: zoom 5.0→5.6 でカーソル下の地図座標のずれ < 1.5 px、タイルの z が 5→6 に切り替わる。

## 補足

- スクリーンショットの最終ビューはパン計測ループ後の状態（z6、日本付近）。格子のラベルが右下の帰属表示と少し重なるが、地図の読み取りには影響しない。
- ポインタ下のアドレス表示は `pointermove` と描画後（`onDraw`）の両方で更新する。ズームはポインタを動かさずに格子を動かすため、描画後の更新が要る。
- タイル取得は 4G 相当のネットワークエミュレーション下で計測（`benchmarks.network`）。
