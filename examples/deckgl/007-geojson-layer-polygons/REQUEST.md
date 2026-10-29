# deck.gl GeoJsonLayer (Polygons) に対応する専用描画器

[元例](https://deck.gl/examples/geojson-layer-polygons)と同じ [4,627区画の固定版データ](https://github.com/visgl/deck.gl-data/blob/0535921160bdcd57ef55c712669c5a4d5eedbb3c/examples/geojson/vancouver-blocks.json)を使い、土地面積あたりの平均評価額を高さ、前回評価からの伸び率を色にします。出典は City of Vancouver です。[Open Government Licence – Vancouver](https://opendata.vancouver.ca/pages/licence/)に従い、出典とデータ加工を画面に表示します。

元例の GeoJSON を事前に屋根と壁へ三角形分割し、量子化した頂点を1本のバッファとして GPU へ送ります。ホバー時だけ区画 ID を別のフレームバッファへ描き、評価額と伸び率を取り出します。元例の影、OpenFreeMap 背景地図、投影と光源の細部は再現していません。同条件の比較が終わるまで速度の優劣は主張しません。

## 計測

`bin/mfs bench deckgl-007-geojson-layer-polygons --site` を3反復した。画面は1280×800・DPR 1、GPUは NVIDIA GeForce RTX 3060（Vulkan）。4,627区画を278,076頂点の屋根・壁メッシュとして配信し、公開用ビルドのスクリーンショットも確認した。

| 指標 | 結果 | 予算 |
| --- | ---: | ---: |
| 初回表示 p50 | 54.78 ms | 1000 ms 以下 |
| パン・回転・ズーム中のフレーム p95 | 1.48 ms | 8.3 ms 以下 |
| 固定画面のフレーム p95 | 0.375 ms | 8.3 ms 以下 |
| GPU p95 | 0.4229 ms | 参考値 |
| コード gzip | 5,347 B | 15,000 B 以下 |
| データ gzip | 590,400 B | 1,500,000 B 以下 |

全区画の読み込み、立体区画の表示、カメラ操作による画面変化、区画IDからの属性取得が3反復すべてで通った。元例との同条件比較は未実施で、速度の優劣は判定していない。
