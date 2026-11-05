# Day 15 · Inside out

北緯42.25度、北海道東方の実在する東西地形断面を「裏返す」地図です。GEBCO_2026 の符号付き標高を反転し、海底を海面より上へ、陸地を下へ描きます。同じ経度軸には、断面緯度の前後0.25度に入る2025年USGS M4.5以上の震源を別の深度パネルで示します。

## データと処理

- GEBCO_2026 Grid の北海道東方 3° GeoParquetから、北緯42.25°に最も近い15秒角セル列720件を選択しました。セル中心標高は平均海面基準、単位はmです。15秒角は格子間隔であり、元データの観測解像度を保証するものではありません。
- USGS ComCat 2025年M4.5以上の8,502イベントから、東経143–146度、北緯42.00–42.50度の震源を選択しました。点は緯度方向に幅約56 kmの帯をまとめたもので、断面上の同一線上で起きた地震ではありません。
- 上段の標高は意図的に符号反転し、下段の震源深度は深いほど下へ進む別の軸です。両者の垂直尺度を同一視せず、地震活動と地形の因果関係も主張しません。
- ブラウザーには小さなJSON断面だけを配布し、実行時に地図エンジンや外部データサービスを使いません。

## 描画と計測

Canvas 2Dで固定断面の水面基準、地形帯、経度グリッド、深度パネルを直接描画します。垂直強調、経度方向のドラッグと拡大縮小、矢印キー、震源選択を実装します。`bin/mfs bench 30DayMapChallenge-2026-15` の画面ピクセル検査と、複数回の first-frame / frame / draw-CPU 計測を記録します。

## 出典と利用条件

GEBCO Bathymetric Compilation Group 2026 (2026), *The GEBCO_2026 Grid - a continuous terrain model for oceans and land at 15 arc-second intervals*, NERC British Oceanographic Data Centre, 23 April 2026. doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa. [配布ページ](https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid)。配布はOpen Government Licence v3.0に基づき、GEBCO条件に従って出典表示と非誤認表示を付しています。

USGS ComCatの地震カタログは米国政府の著作物としてパブリックドメインで、USGSへのクレジットを付しています。地震カタログの選択条件は年・マグニチュード・緯度経度範囲によるもので、すべての地震や断層を示すものではありません。
