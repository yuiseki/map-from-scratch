# 01 · Points

2025 年の M4.5 以上の地震を、Equal Earth 図法の世界地図上にすべて表示します。点の大きさはマグニチュード、色は震源の深さを表します。ドラッグで平行移動し、ホイールで拡大縮小できます。

## Data and preparation

- `usgs-quakes-2025`: USGS ComCat の 2025 年 M4.5 以上の地震 8,502 件。Public Domain。表示上に USGS ComCat の出典リンクを置いています。
- `ne-countries`: Natural Earth 10m Admin 0。背景の陸地に使用し、Public Domain と表示しています。
- `bake.ts` は陸を Equal Earth に投影し、16-bit 座標と三角形にして保存します。地震は同じ座標範囲へ量子化し、規模順の 8-byte GPU レコードにします。
- 生成物は `land.bin` 243,040 bytes、`points.bin` 68,020 bytes。再生時に外部データ通信はありません。

## Renderer

WebGL2 で陸地を一回、地震点を一回の draw call で描きます。地震は円形 point sprite としてフラグメントシェーダで描画し、点ごとの DOM 要素や Canvas path を作りません。全件を表示する題材なので、重なりを避けるクラスタリングや間引きはしません。

ポイントサイズは画面上のピクセルで一定にし、拡大しても地理座標からずれないようにします。地図の投影とカメラは Equal Earth のワールド座標を使い、ポイントの画面位置検証は USGS の実際の震央座標から独立に計算します。

## Verification and measurement

自動確認では、陸と海の実画面色差、既知のミャンマー M7.7 震央付近の赤い画素、GPU に渡す件数 8,502 を確認します。最初の画面で円形マーカーの実画面サイズが小さすぎた際、フラグメントシェーダの円境界式を直し、震央位置でのピクセル検査を通しました。

NVIDIA GeForce RTX 3060、Xvfb 上の Chromium で計測しました。1280×800、3 runs / 240 camera frames では、first frame p50 524.5 ms、frame p95 0.515 ms、GPU p95 0.1516 ms、JS heap p50 1.277 MB、code gzip 5,188 bytes、data gzip 170,300 bytes でした。すべての予算と画面チェックに合格しました。1920×1021 でも画面を確認し、ドラッグで地図がポインター方向へ移動し、ホイールでカーソル位置を基準に拡大することを実ブラウザーで確認しました。
