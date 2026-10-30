# MapLibre: Display a popup on hover

MapLibre GL JS の公式サンプル「[Display a popup on hover](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-popup-on-hover/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心座標 `[-96.0, 37.8]`、ズームレベル `zoom: 3` で地図を表示し、その座標に青いマーカーを置く。
2. マーカーにポインタを近づける（14 px 以内）と、先端がマーカーを指す吹き出し型ポップアップ「You hovered here!」を表示する。
3. ポインタが離れるとポップアップを消す。
4. ドラッグでパン、ホイールでズームでき、ホバー中はポップアップがマーカーに追従する。
5. ピクセル読み戻しでホバー表示・非表示・半径・パン/ズーム追従を検証する。

## 設計の意図と判断

1. **ホバー判定は距離 14 px だけ**
   - マーカーのスクリーン座標とポインタの距離を比べる。地物の空間インデックスもレイキャストも持たない。
2. **状態が変わったときだけ再描画**
   - pointermove のたびに draw すると 60 fps を無駄に使う。`hovering` が変化したときだけ描き直す。
3. **吹き出しは Canvas のパス**
   - DOM オーバーレイにせず、角丸矩形 + 突起 + テキストを 1 パスで描く。パン中の位置ずれがない。
4. **背景は Natural Earth 陸地**
   - 大陸スケール（zoom 3）の例なので、ラスタタイルは使わない。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 14.46 ms |
| 再描画 redraw_ms p95 | 0.895 ms |
| フレーム間隔 frame_interval_ms p95 | 4.875 ms |
| コード gzip | 3,174 B |
| データ gzip | 30,400 B |
| 検証チェック | 6 / 6 PASS |

## 検証チェック

- `popup-hidden-until-hover`: ホバー前は吹き出し位置が白くない。
- `hover-opens-popup`: マーカー上で吹き出しが開き、青い点が見える。
- `pointer-leave-hides-popup`: 90 px 離すと消える。
- `hover-radius`: 12 px で表示、16 px で非表示。
- `popup-follows-pan`: 40×25 px のパンで吹き出しも同じ量だけ移動。
- `popup-anchors-on-zoom`: マーカー中心の zoom 5 でも位置が変わらない。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。

## 実装上の落とし穴

- pointermove でドラッグ中かどうかに関係なくホバーを更新する。ドラッグ中にマーカーから離れれば吹き出しは閉じる（地図の移動でマーカーが逃げるため）。
