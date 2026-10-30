# forge3d-002-mount-fuji-labels

富士山の地形を 3D で表示し、山頂と登山道の五合目・各合目・麓の地名をラベルで載せる。ドラッグで回り、ホイールで寄れる。山の向こう側に隠れた地名と、重なってしまう地名は出さない。外部ライブラリなし。

## 元の例

- forge3d: [Mount Fuji Labels](https://milos-agathon.github.io/forge3d/gallery/02-mount-fuji-labels.html)
- 元の例は Fuji の DEM と地名データ `mount-fuji-places` を読み、ビューアに `add_label` で山頂の「Mount Fuji」を足して静止画を撮る。forge3d のラベルは LabelPlan という計画で、地点ごとに置くか、理由付きで外すかを決める (docs の Deterministic LabelPlan)。

## 設計

1. 地形は forge3d-001 と同じ作り。
   - terrarium z11 の 4 タイルを接続して、山頂を中心に 384x384 (約 24 km、62 m/px) を切り出す。
   - 16 bit の標高を R16UI テクスチャにし、頂点シェーダが `gl_VertexID` から格子を作って変位させる。
   - 太陽 315°/35° の陰影と標高の段彩 (森、上部の赤茶けたスコリア、山頂の灰色と雪) は色テクスチャに焼く。
   - 地形全体が 1 ドローコール。
2. ラベルは毎フレーム CPU で計画を立て、WebGL の上に重ねた Canvas 2D に描く。
   - 地名は 39 地点で、forge3d の `Mount_Fuji_places.gpkg` (OpenStreetMap) をそのまま使う。山頂のラベルは、元の例と同じく地名データにはなく、DEM の最高点に置く。
   - 優先順はベイクで決める。山頂、五合目、登山道の各合目を高い順、その他の地点、地区の順。
   - 計画では、優先順に 1 件ずつ次を確かめる。
     - 投影して画面に入るか。入らなければ `behind-camera` か `offscreen`。
     - 地点から目までの直線の下に地形がはみ出さないか。DEM を 0.75 セルごとに引き、はみ出せば `occluded`。
     - 右、左、上、下の順に置いてみて、置いた箱と重ならない最初の向き。どこも重なれば `collision`。
   - 文字は Canvas 2D に描くので、日本語もブラウザのフォントでそのまま出る。グリフのアトラスもテキスト用のシェーダも持たない。
3. 地名の点と文字は、回転とズームのたびに計画ごと作り直す。同じ視点なら同じ計画になる。

## 計測結果

`bin/mfs bench forge3d-002-mount-fuji-labels -n 3` (1024x768、DPR 1、ANGLE / NVIDIA RTX 3060)。

| 項目 | 値 | 予算 |
| --- | --- | --- |
| 初回描画 first_frame_ms p50 | 63.8 ms | 500 ms |
| 再描画 redraw_ms p95 (地形の描画命令とラベルの計画・描画) | 0.53 ms | 8 ms |
| ラベル label_ms p95 | 0.49 ms (p50 0.21 ms) | 3 ms |
| フレーム間隔 frame_interval_ms p95 | 4.4 ms | 20 ms |
| コード gzip | 7,849 B | 9,000 B |
| データ gzip | 392,400 B (fuji.bin 737 KB、labels.json 3.5 KB) | 650,000 B |
| 検証チェック | 7 / 7 PASS (3 回とも) | |

redraw_ms は CPU が描画命令を出し終えるまでで、GPU の実行時間は含まない。

最初の視点 (方位 18°、仰角 36°、24 km 先) では 40 件中 18 件が置かれ、22 件が外れる。外れるのは、五合目から山頂までの登山道に各合目が数百 m おきに並んでいて、この距離では重なるため。寄れば出てくる。

## 検証チェック

- `terrain-fills-view`: 上端は空 (alpha < 10)、画面中央は地形 (alpha > 200)。
- `every-label-accounted`: 40 件すべてが置かれたか理由付きで外れ、最初の視点で 10 件以上置かれる。
- `summit-label-on-summit`: 山頂のラベルの点が DEM の最高点 (+20 m) の投影位置と 0.5 px 未満で一致し、ラベル用キャンバスのその画素が赤。
- `labels-do-not-overlap`: 置いた箱が総当たりで重ならず、どの箱にも描かれた文字の画素がある。
- `far-side-occluded`: 南斜面の富士宮口五合目が、北から低く (仰角 10°) 見ると `occluded`、南から見ると外れない。
- `plan-is-deterministic`: 同じ視点で取り直した計画が、置いたラベル・向き・位置まで一致する。
- `labels-follow-orbit`: 方位を 40° 回すと須走五合目の点が 30 px 以上動き、移った先に描かれている。

## 元の例との違い

- 元の例は静止画 1 枚。ここでは回転とズームのたびにラベルを選び直す。
- 元の例の DEM (`Mount_Fuji_30m.tif`、30 m) は出典が書かれていないので使わず、出典のはっきりした terrarium (62 m) にした。そのため山頂は 3,744 m で、実際の 3,776 m より低い。
- 元の例の画像には、地名データにない見出し (「HIGH Priority」「Distant Peak 1」など) も出ている。どこで足されたかは確かめていない。ここでは地名データの 39 地点と山頂だけを出す。
- MapLibre などの汎用ライブラリや forge3d 本体とは、同じ条件で並べて測っていない。
