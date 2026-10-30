# maplibre-034-animate-a-point: 20° の軌道を回る点

## 依頼内容

> 経度0・緯度0を中心とする半径20°の円周上を、青い点が毎秒60°で回り続ける地図を表示したい。ドラッグでパン、ホイールで拡大縮小でき、点は常に地理座標に固定される。外部ライブラリなしで、最速・最小で。

元例: [MapLibre - Animate a point](https://maplibre.org/maplibre-gl-js/docs/examples/animate-a-point/)

## 設計の意図と判断

1. **タイムスタンプ駆動の角度**
   - `requestAnimationFrame` の時刻差から角速度 60°/s を積分する。フレーム回数ではなく経過時間で決まるため、タブ停止や低フレームレートでも角速度が保たれる。
2. **点は地理座標（経緯度）で保持**
   - 位置を `[cosθ·20°, sinθ·20°]` で持ち、描画時に Web Mercator へ投影する。パン・ズームしても地理座標からずれない。
3. **検証用の決定論的 API**
   - `setAnimating(false)` / `resetAngle()` / `advance(ms)` を公開し、ベンチは自動アニメーションを止めてから角度を進める。実行タイミングに依存せず画素を検証できる。
4. **背景はベイク済み Natural Earth 110m 陸地**
   - 世界スケール（z4）なのでラスタータイルは不要。

## 計測結果

`bin/mfs bench maplibre-034-animate-a-point -n 3`、1024×768・DPR 1。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 11.86 ms（3回の p95 62.7 ms） |
| 再描画 redraw_ms p95 | 0.675 ms |
| フレーム間隔 frame_interval_ms p95 | 6.955 ms |
| コード gzip | 2,859 B |
| データ gzip | 30,396 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `point-starts-east`: 開始時 lng≈20, lat≈0、投影式の期待座標との差 < 1.5 px、青い点の色。
- `point-orbits-north`: 1.5 秒後に lng≈0, lat≈20、移動 > 200 px、青い点の色。
- `point-moves-with-pan`: 50×30 px パンで点が同じ量だけ動く。
- `point-anchors-on-zoom`: z4.5 でも投影式の期待座標に描画されている。
- `wheel-zoom-keeps-point`: ズーム前後で点のずれ < 1.5 px。

## データと帰属

- 背景の陸地: Natural Earth 110m land（パブリックドメイン）。
- 軌道・点: 元例と同じ半径20°・角速度60°/s をコードで生成。

## 実装のメモ

- 地理座標の円は Web Mercator では楕円になる。z4 で東端は中心から 227.6 px、北端は約 232 px なので、「画面上の半径一定」ではなく投影式から期待座標を計算して検証する。
- ベンチでは自動アニメーションを止めないと、最初の画素読み戻しの角度が実行ごとに変わる。
