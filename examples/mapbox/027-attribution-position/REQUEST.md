# Mapbox: Attribution Position

Mapbox GL JS の公式サンプル「[Attribution Position](https://docs.mapbox.com/mapbox-gl-js/example/attribution-position/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心 `[-96.0, 37.8]`、`zoom: 3` の地図を表示する。
2. 出典表示（attribution）を白い角丸の箱と文字で描き、初期位置は左下、余白 12 px。
3. BL / BR / TL / TR ボタンで出典表示を四隅へ移動できる。
4. 地図のパン・ズームでは出典表示は動かず、画面の同じ位置に留まる。

## 設計の意図と判断

1. **出典表示は画面座標で描く**
   - 地理座標に紐づけるとパンで動いてしまう。カメラ更新と独立した矩形を毎フレーム描き直すのが正しい。
2. **矩形は 1 つの関数から**
   - 隅の名前（`bottom-left` など）から `{x, y, width, height}` を求める。描画も検証も同じ定義を使い、検証側はビューポートから独立に期待値を再計算する。
3. **文字まで検証する**
   - 白い箱だけだと「箱は出たが文字が消えた」退行を見逃す。箱の内側の暗色ピクセル数も数える。
4. **パネルは上部中央**
   - 4 隅のどれに出典表示を置いても DOM パネルが隠さないよう、操作パネルは画面中央上に置く。
5. **背景は Natural Earth 陸地**
   - 大陸スケール（zoom 3）なのでラスタタイルは使わない。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 15.95 ms |
| 再描画 redraw_ms p95 | 0.595 ms |
| フレーム間隔 frame_interval_ms p95 | 6.375 ms |
| コード gzip | 3,190 B |
| データ gzip | 30,400 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `attribution-visible-bottom-left`: 左下 (12, 728, 222, 28) に白箱と暗色文字。
- `attribution-moves-to-top-right`: TR クリックで右上へ移動し、旧位置は地図に戻る。
- `attribution-moves-to-bottom-right`: BR クリックで右下へ移動し、旧位置は地図に戻る。
- `attribution-fixed-on-pan`: 120×90 px パンしても矩形は不動。
- `attribution-fixed-on-zoom`: zoom 4.5 でも矩形は不動。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。

## 実装上の落とし穴

- 四隅すべてに出典表示を置ける例なので、操作 UI を隅に置くとその隅の表示確認ができない。パネルは中央上に逃がす。
- 白箱の判定は陸地色（`#f0eee8`）と紛れやすい。全チャンネル 242 以上で判定し、陸地の青成分 232 と区別する。
