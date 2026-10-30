# MapLibre: Add a pattern to a polygon

MapLibre GL JS の公式サンプル「[Add a pattern to a polygon](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-pattern-to-a-polygon/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心 `[-105.5, 39]`、`zoom: 6` で地図を表示する。
2. 背景には OSM Carto のラスタタイルを敷く（地域スケールで平坦な陸地塗りだけにしない）。
3. コロラド州を覆う矩形ポリゴン（経度 -109–-102、緯度 37–41）を、画像ではなく生成したパターンで塗る。
4. パターンはポリゴンの輪郭でクリップされ、画面座標に固定される（パンしても位相が動かない）。
5. ドラッグでパン、ホイールでズームできる。
6. ピクセル読み戻しで背景の色数・2色の分布・周期・パン/ズーム追従を検証する。

## 設計の意図と判断

1. **24×24 のチェッカーを一度だけ生成**
   - オフスクリーンに 12 px の2色チェッカーを描き、`createPattern(tile, 'repeat')` をポリゴンの fillStyle にする。画像の取得もデコードもない。
2. **矩形だけで作るパターン**
   - 斜めストライプはタイル境界でアンチエイリアスの継ぎ目が出る。チェッカーなら境界の画素値が完全一致し、周期の検証を厳密等号で行える。
3. **画面固定のパターン**
   - CanvasPattern は塗り時の変換で画面座標に固定される。パンするとポリゴンだけが動き、パターンの位相は動かない。MapLibre の fill-pattern と同じ挙動。
4. **背景は OSM Carto のラスタタイル**
   - zoom 6 のコロラドは 110m 陸地の内側なので、陸地塗りだけでは一面ベージュになる。Natural Earth 陸地はタイル到着までのプレースホルダに格下げし、到着後は道路・地名・土地利用が見える背景にする。タイルは 512 px PNG を `256*2^(zoom-zi)` CSS px で描く。
   - 帰属: © OpenStreetMap contributors · © OpenMapTiles · OSM Carto（ODbL）。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 9.49 ms |
| 再描画 redraw_ms p95 | 0.395 ms |
| フレーム間隔 frame_interval_ms p95 | 9.595 ms |
| コード gzip | 4,028 B |
| データ gzip | 30,400 B |
| 検証チェック | 6 / 6 PASS |

## 検証チェック

- `basemap-drawn`: 可視タイルがすべて ready になり、画面の異なる色数が 40 超。
- `pattern-fill-visible`: 内部 40×40 px に黄と青がそれぞれ 50 サンプル以上。
- `pattern-is-periodic`: +24 px で同色、+12 px で別色。
- `pattern-follows-polygon-on-pan`: 24×6 px パン後、左辺の内側はパターン色、外側は背景色。
- `pattern-anchors-on-zoom`: zoom 7 でも輪郭の内外が正しい。
- `wheel-zoom-keeps-point`: ポリゴン中心のズームで中心が動かない。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）。ポリゴンの矩形は依頼から直接定数で持つ。

## 実装上の落とし穴

- チェッカーの位相はキャンバス原点基準。検証のサンプル点は 12 px の格子線上を避け、421 のような半端な座標から取る。
- ポリゴンの辺は lineWidth 2 のストロークが中心線上に乗るため、内外の判定は辺から 4–6 px 離す。
