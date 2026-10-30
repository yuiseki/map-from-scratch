# mapbox-019-animate-ant-path: 流れる破線のルート

## 依頼内容

> サンフランシスコからワシントンD.C.へのルートを、破線のダッシュ（アリの行進）が流れ続ける「ant path」としてアニメーション表示したい。ドラッグでパン、ホイールで拡大縮小でき、外部ライブラリなし・Canvas 2D で最速・最小に実装する。

元例: [Mapbox GL JS - Animate an ant path](https://docs.mapbox.com/mapbox-gl-js/example/animate-ant-path/)

## 設計の意図と判断

1. **`setLineDash` + `lineDashOffset` だけでアニメーション**
   - 元例は SVG の `stroke-dashoffset` を毎フレーム更新する。本実装は同じ 501 点の大圏経路を Canvas の1本のパスとして描き、`lineDashOffset` を 1 フレームあたり 0.6 px 進めるだけ。ジオメトリの再構築はない。
2. **実線ベースの下敷き**
   - 破線だけだと隙間でルートが途切れて見えるため、同じ経路に太い青の実線を先に描く。ダッシュが流れても「1本のルート」として読める。
3. **端点マーカーも Canvas**
   - 始点（緑）・終点（赤）の円とラベルを同じフレームで描く。画像も DOM も不要で、パン・ズームと完全同期する。
4. **カーソル基準のホイールズーム**
   - ズーム前にカーソル下の地図座標を求め、ズーム後に同じ画面位置へ戻す。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 12.39 ms |
| 再描画 redraw_ms p95 | 0.61 ms |
| フレーム間隔 frame_interval_ms p95 | 4.92 ms |
| コード gzip | 3,015 B |
| データ gzip | 38,880 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `route-line-visible`: ルート中点にベース線（青）かダッシュ（白）が描かれている。
- `ants-march`: `dashOffset` を 13 px 動かすと中点周辺 36×36 px のうち 30 px 超が変化する（アニメーションしている）。
- `origin-marker-visible` / `destination-marker-visible`: 始点の緑・終点の赤を画面ピクセルで確認。
- `wheel-zoom-keeps-point`: ズーム前後でカーソル下の点のずれ < 1.5 px。
