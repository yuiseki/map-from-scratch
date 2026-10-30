# MapLibre: Display a popup on click

MapLibre GL JS の公式サンプル「[Display a popup on click](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-popup-on-click/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心座標 `[-96.0, 37.8]`、ズームレベル `zoom: 3` で地図を表示する。
2. 地図をクリックした位置に、先端がその座標を指す吹き出し型ポップアップ（白背景、影、下部突起、閉じるボタン「×」、内容「You clicked here!」）を表示する。
3. 別の場所をクリックするとポップアップはその位置へ移り、× をクリックすると閉じる。
4. ドラッグによるパンやホイールによるズームの間も、ポップアップの先端は同じ地理座標に固定される。
5. ピクセル読み戻しで、クリック位置・閉じる・移動・パン・ズームを検証する。

## 設計の意図と判断

1. **クリック位置の逆投影を直接計算**
   - クリック点と画面中心の差分を `256·2^zoom` で割り、中心のメルカトル座標に足して緯度経度へ戻す。カメラ行列もレイキャストも持たず、先端をクリック点に 0.5 px 以内で一致させる。
2. **ドラッグとクリックの分離**
   - pointerdown からの移動量が 3 px を超えたらパンとみなす。これがないと、地図をドラッグするたびにポップアップが開いてしまう。
3. **吹き出しも Canvas 2D のパス**
   - 角丸矩形・突起・× を 1 つのパスで描き、DOM オーバーレイの translate 同期を持ち込まない。パン中も地図と吹き出しが 1 フレームで揃う。
4. **ヒット判定はスクリーン矩形**
   - × は吹き出しのバウンズから求めた 16×16 px の矩形で判定する。DOM 要素を持たないので、パン中も座標系が 1 つで済む。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 15.32 ms |
| 再描画 redraw_ms p95 | 0.645 ms |
| フレーム間隔 frame_interval_ms p95 | 5.95 ms |
| コード gzip | 3,379 B |
| データ gzip | 30,400 B |
| 検証チェック | 6 / 6 PASS |

## 検証チェック

- `popup-hidden-initially`: クリック前は中心が白くない。
- `click-opens-popup-at-pointer`: (680,280) のクリックで先端がクリック点に一致し、吹き出し内が白。
- `close-button-closes-popup`: × で閉じ、元の位置に白が残らない。
- `click-elsewhere-reanchors`: (400,520) へクリックで全体が移動。
- `popup-follows-pan`: 40×25 px のパンで吹き出しも同じ量だけ移動。
- `popup-anchors-on-zoom`: zoom 5 でも先端が同じ地理座標。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。

## 実装上の落とし穴

- 吹き出し中心のピクセルは「You clicked here!」の文字に当たることがある。検証は角丸とテキストを避けた (bubble.x+16, bubble.y+9) を読む。
- benchmark のクリックは合成 PointerEvent で送るため、`setPointerCapture` は try/catch で包む（合成ポインタでは例外になる）。
