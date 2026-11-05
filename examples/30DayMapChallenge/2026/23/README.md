# Day 23 · Senses: Taste

東京の実在店が記録されたOSMタグを、味の評価ではなく「街の食の語彙」として見るためのCanvas 2D地図です。道路や建物を背景にせず、浅草から上野の飲食関連地点だけを描きます。

## データと読み方

- 元データ: [`osm-tokyo23-src-2026-08`](https://huggingface.co/datasets/yuiseki/osm-tokyo23-src-2026-08)、2026-08-31時点の固定スナップショット。GeoParquet 1.1 / EPSG:3857（メートル）。
- 範囲: Web Mercator `x=15,559,600..15,566,400`, `y=4,256,800..4,263,800`。WGS84では概ね東経139.765–139.825度、北緯35.685–35.735度の浅草–上野周辺。矩形は行政界を意味しません。
- 抽出: `planet_osm_point` と `planet_osm_polygon` のbboxが範囲と交差する行から、許可リストの `amenity` / `shop` を持つ場所を選びます。面は範囲と交差する形状を切り取り、中心点には `ST_PointOnSurface` を用います。
- 対象範囲にあるsource rowsはpoint 40,350 / polygon 115,617。そのうち `amenity` または `shop` があるのはpoint 13,904 / polygon 3,498です。表示グループに合わない12,497件は除外し、4,905地物を描きます: point 4,794、polygon 111。描画グループは食事2,312、喫茶566、酒場1,080、食料品店947。元データの `cuisine` タグあり1,909、未指定2,996。220m四方のoccupied cellは643です。これらはスナップショットと抽出条件に対する件数です。
- 1セルは約220m四方です。引いた範囲の全タグ付き地点を4グループの小区画に分けて概観し、拡大すると個々の店・地点へ切り替えます。カテゴリ色やグループ名は、この表示のための便宜的整理です。
- 選択した地点のOSM要素IDと、利用できた `amenity`, `shop`, `cuisine`, `name`, `diet:*`, `takeaway`, `delivery` タグのみを表示します。`cuisine` がない地点の料理ジャンルを推測しません。
- このデータから分かるのは記録時点のタグだけです。味、品質、人気、営業状況、価格、食の好み、文化的真正性は評価しません。地域全体の網羅でもありません。

## 描画器

- `bake.ts` でbbox選択、面の範囲切り取り、OSM IDと関連タグの保持、4,905地物の220mカテゴリ集約を行います。
- `renderer.ts` はCanvas 2Dで集約セルと拡大時の各地点・面輪郭を描きます。地図エンジン、ベースマップ、実行時外部通信は使いません。
- チェックボックス、ズーム操作、矢印キー移動、`+` / `-` ズーム、ポインタドラッグ、地点選択に対応します。

## 出典とライセンス

**© OpenStreetMap contributors** · [著作権と帰属表示](https://www.openstreetmap.org/copyright)。元データと派生データはODbL 1.0の条件に従い、共有する派生データベースにはshare-alike条件が適用されます。スナップショットはコミュニティにより編集され、情報が不完全または古い場合があります。

データライセンス: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。出典カードとスキーマの記録: ローカルコピー `/sata_hdd_24tb/hf_data/__published/osm-tokyo23-src-2026-08/README.md`, `data/README.md`, `data/LICENSE`, `docs/schema-parquet.md`。

## 検証状況

`taste.test.ts` の8テストが通過しています。3回のブラウザ計測は10/10予算・6/6チェックに合格。first frame p50 70.09ms、描画CPU p95 2.035ms、frame p95 8.855ms、gzip data 207,700Bです。1280×800の画面も確認しました。
