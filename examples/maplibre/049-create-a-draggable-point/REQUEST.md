# MapLibre: Create a draggable point

MapLibre GL JS の公式サンプル「[Create a draggable point](https://maplibre.org/maplibre-gl-js/docs/examples/create-a-draggable-point/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. `[0, 0]`、`zoom: 3` で地図を表示し、その座標に青い点を置く。
2. 点をドラッグすると、掴んだ位置のオフセットを保ったまま移動する。
3. 点以外の場所のドラッグは地図のパンになる。
4. ホイールでズームでき、点は地理座標に固定されたまま追従する。
5. ピクセル読み戻しと逆投影値で、表示・ドラッグ・パン・ズームを検証する。

## 設計の意図と判断

1. **掴んだ位置のオフセットを保存**
   - pointerdown 時に「点の中心 - ポインタ」を覚え、pointermove では `ポインタ + オフセット` を地理座標へ逆投影する。これがないと点がポインタへ飛ぶ。
2. **ヒット判定を先に**
   - 点の中心から 14 px 以内なら点のドラッグ、それ以外はパン。1 つの pointerdown で分岐する。
3. **点はスプライト1枚**
   - DPR 倍のオフスクリーンに一度だけ円を描き、毎フレームは drawImage でブリットする。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 12.63 ms |
| 再描画 redraw_ms p95 | 0.45 ms |
| フレーム間隔 frame_interval_ms p95 | 0.76 ms |
| コード gzip | 3,031 B |
| データ gzip | 30,400 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `draggable-point-visible`: (0,0) に青い点。
- `point-drags-to-pointer`: 80×50 px のドラッグで点と緯度経度が一致。
- `point-drag-does-not-pan`: 点のドラッグで地図は動かない。
- `map-pans-away-from-point`: 30×20 px のパンで点が追従。
- `wheel-zoom-keeps-point`: 点を中心としたズームで点が動かない。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。

## 実装上の落とし穴

- ドラッグの開始位置は点の中心そのものとは限らない。オフセットを保存しないと、クリックした瞬間に点がポインタへ吸い寄せられる。
- 緯度はメルカトル座標の [0,1] にクランプしてから逆投影する。
