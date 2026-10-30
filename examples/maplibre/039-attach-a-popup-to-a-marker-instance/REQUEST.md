# MapLibre "Attach a popup to a marker instance" に対応する専用描画器

[Attach a popup to a marker instance](https://maplibre.org/maplibre-gl-js/docs/examples/attach-a-popup-to-a-marker-instance/) は、ワシントン記念塔の座標にカスタム DOM 要素のマーカーを置き、マーカーに紐づけたポップアップをクリックで開閉する例です。

この実装では、記念塔 [-77.0353, 38.8895] を中心・ズーム 5 で表示し、50 px の丸いマーカー（空・石塔・地面を Canvas で描いた写真風アイコン）を置きます。マーカーのクリックで「Construction on the Washington Monument began in 1848.」の吹き出しが開き、先端はマーカー中心から MapLibre と同じ 25 px 上に固定されます。× で閉じ、もう一度クリックすると再び開きます。

## 背景地図

ズーム 5 でも海岸線・州境・道路・地名が読めるよう、実行時に [OSM Carto の 512 px ラスタタイル](https://tile.yuiseki.net/styles/512/osm-carto.json) を表示範囲だけ取得して最下層に描きます。初回フレームはベイクした Natural Earth 110m の陸ポリゴンで描き、到着したタイルが順に重なります。タイル取得に失敗しても陸ポリゴンが残ります。

## 設計の意図と判断

1. **offset 25 px を1つの定数にする**
   - ポップアップの先端は `マーカー中心 - 25 px`。吹き出しの外接矩形は先端から幅 200 px・高さ 68 px・突起 10 px を引くだけで求まり、DOM の transform 同期は不要です。
2. **マーカーのヒット判定は距離だけ**
   - ポインタとマーカー中心の距離が 25 px 以内ならクリック。GeoJSON のシンボルレイヤーやヒットバッファは持ち込みません。
3. **描画は2パスで検証を分離**
   - 背景タイルの道路・地名が検証点に重なると色判定が揺れるため、マーカーとポップアップの RGB 検証中は下地を隠します。下地自体は画面全体の異色数で別チェックにします。
4. **ドラッグとクリックの分離**
   - pointerdown からの移動量が 3 px を超えたらパンとみなし、マーカーのクリック扱いにしません。

## 計測結果

`bin/mfs bench maplibre-039-attach-a-popup-to-a-marker-instance -n 3`（1024×768、DPR 1）。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 11.32 ms（タイルは非同期） |
| 再描画 redraw_ms p95 | 0.625 ms |
| フレーム間隔 frame_interval_ms p95 | 5.42 ms |
| コード gzip | 4,946 B |
| データ gzip | 30,400 B |
| 検証チェック | 7 / 7 PASS |

## 検証チェック

- `basemap-drawn`: 表示範囲のタイルがすべて到着し、画面に 150 色超。
- `marker-on-monument`: 記念塔の投影位置に丸マーカー（中心=石、右上=空、36 px 外=陸地）。
- `popup-hidden-initially`: クリック前はポップアップなし。
- `marker-click-opens-popup`: マーカー中心クリックで先端が中心-25 px、吹き出し内が白。
- `close-button-closes-popup`: × で閉じ、元の位置に白が残らない。
- `popup-follows-pan`: 60×40 px のパンでマーカーと吹き出しが同じ量だけ移動。
- `popup-anchors-on-zoom`: zoom 6 でもマーカーの画面位置と 25 px オフセットが不変。

## データ

- 背景の陸地: Natural Earth 110m land（パブリックドメイン）、タイル到着までの代替。
- 下地タイル: OSM Carto via tile.yuiseki.net（© OpenStreetMap contributors, © OpenMapTiles, ODbL）。

## 実装上の落とし穴

- 吹き出しの中心付近は3行のテキストに当たる。検証は右端寄りの (x+188, y+34) を読む。
- マーカー中心の石色 (239,233,220) は下地なしの陸地色 (242,239,233) に近いため、石色だけでは弱い。空色 (+12,-14) と外側の陸地色 (+36,0) を併せて判定する。
- 合成 PointerEvent では `setPointerCapture` が例外になるので try/catch で包む。
