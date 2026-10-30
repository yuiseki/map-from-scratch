# MapLibre: Create a hover effect

MapLibre GL JS の公式サンプル「[Create a hover effect](https://maplibre.org/maplibre-gl-js/docs/examples/create-a-hover-effect/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心 `[37.5, 7.5]`、`zoom: 4` で地図を表示する。
2. エチオピア周辺を覆う矩形ポリゴン（経度 30–45、緯度 0–15）をティール `#008888` で塗る。
3. ポインタがポリゴンの上にある間だけオレンジ `#ff8800` に変え、外れるとティールへ戻す。
4. ドラッグでパン、ホイールでズームできる。
5. ピクセル読み戻しで初期色・ホバー・復帰・パン/ズーム後のホバーを検証する。

## 設計の意図と判断

1. **ホバーは真偽値 1 個**
   - ポインタをメルカトル座標へ逆変換し、ポリゴンの矩形の内側かどうかだけを見る。フィーチャーステートやレイヤーツリーは持たない。
2. **変化したときだけ再描画**
   - 内外が変わらない pointermove では何もしない。ホバー中の連続移動でも再描画は最初の 1 回だけ。
3. **ピクセルではなく地理座標で当たり判定**
   - `getImageData` を pointermove ごとに呼ぶと同期ストールになるため、矩形比較で済ませる。
4. **背景は Natural Earth 陸地**
   - zoom 4 で紅海・アデン湾の海岸線が見える範囲なので、陸地塗りで地図として読める。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 12.72 ms |
| 再描画 redraw_ms p95 | 0.775 ms |
| フレーム間隔 frame_interval_ms p95 | 6.74 ms |
| コード gzip | 3,105 B |
| データ gzip | 30,450 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `default-fill-teal`: 初期状態の中心ピクセルがティール、hovering=false。
- `hover-highlights-polygon`: 中心への pointermove でオレンジ、hovering=true。
- `leave-restores-fill`: pointerleave でティールへ復帰。
- `hover-follows-pan`: 60×40 px パン後の中心でホバーが効く。
- `hover-anchors-on-zoom`: zoom 5 でも地理座標どおりにホバーが効く。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。
- エチオピア周辺の矩形（経度 30–45、緯度 0–15）をベイク時に投影。

## 実装上の落とし穴

- 矩形の上下はメルカトル y が北で小さくなるため、`boxMinY = mercY(NORTH)`、`boxMaxY = mercY(SOUTH)` と取り違えない。
- パン中は pointermove をホバー判定に使わない（ドラッグとホバーが競合する）。ボタンを離した後に改めて pointermove が来た時点で判定する。
