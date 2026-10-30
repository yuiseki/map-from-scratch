# MapLibre: Change a layer's color with buttons

MapLibre GL JS の公式サンプル「[Change a layer's color with buttons](https://maplibre.org/maplibre-gl-js/docs/examples/change-a-layers-color-with-buttons/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. エチオピア周辺を覆う矩形ポリゴンをティール `#008888` で塗った地図を中心 `[37.5, 7.5]`、`zoom: 4` で表示する。
2. Teal / Orange / Purple / Random の4ボタンでレイヤーの塗り色を切り替える。
3. ドラッグによるパン、ホイールによるズームに対応し、色を変えた後もポリゴンが地理座標に固定される。
4. ピクセル読み戻しで初期色・ボタンごとの色・ランダム色・パン/ズーム追従を検証する。

## 設計の意図と判断

1. **レイヤーの色は状態変数1個**
   - スタイル式もレイヤーツリーも持たず、`fillColor` を差し替えて再描画するだけ。ボタンは `data-color` を読んで `setFillColor` を呼ぶ。
2. **不透明な塗り**
   - 検証で背景の陸海に関係なく指定色そのものを 1 px で読み戻せるよう、fill-opacity は 1 にした。元例の半透明スタイルより検証が単純で、描画コストも1パスで済む。
3. **矩形はベイク済み**
   - 経度30–45・緯度0–15 の矩形を Web Mercator に投影して `box.json` に保存。実行時は4点をパスに流すだけ。
4. **背景は Natural Earth 陸地**
   - この例は大陸スケール（zoom 4）で、元例も陸地の塗り分けのみなので、ラスタタイルは使わない。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 10.72 ms |
| 再描画 redraw_ms p95 | 0.625 ms |
| フレーム間隔 frame_interval_ms p95 | 7.72 ms |
| コード gzip | 3,132 B |
| データ gzip | 30,450 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `default-fill-teal`: (38.75, 9.0) のピクセルが (0,136,136)。
- `button-sets-orange`: Orange クリック後 (255,136,0)。
- `button-sets-purple`: Purple クリック後 (136,0,136)。
- `random-button-recolours`: Random クリック後の `fillColor` とピクセル色が一致し、紫と異なる。
- `recoloured-layer-anchors`: 50×30 px パンで同じ量だけ移動し、zoom 5 でも同じ色。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）。
- 矩形は依頼から直接ベイク（外部データなし）。

## 実装上の落とし穴

- ランダム色は `crypto.getRandomValues` で作る。`#880088` と一致する確率は無視できるが、検証では「紫と異なる」ことも確認している。
