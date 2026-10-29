# deck.gl PointCloudLayer に対応する専用描画器

[元例](https://deck.gl/examples/point-cloud-layer)の室内 LiDAR 点群を全件表示し、回転・拡大縮小して観察します。[固定版の LAZ](https://github.com/visgl/deck.gl-data/blob/0535921160bdcd57ef55c712669c5a4d5eedbb3c/examples/point-cloud-laz/indoor.0.1.laz)は 808,042 点で、元例のコードはデータ源を Kaarta.com と記しています。deck.gl-data リポジトリは MIT ライセンスですが、この点群固有の再配布許諾は確認できていません。公開画面にも出典を表示します。

元例はブラウザで LAZ を展開し、PointCloudLayer で白色の点を描き、視点を自動回転します。この例はベイク時に LAZ を展開し、各座標を10ビットへ量子化して1点4バイトで保存します。WebGL2 の `GL_POINTS` で全点を1回の描画命令で描き、回転中はカメラのユニフォームだけを更新します。点の色、法線、背景地図は含みません。

## 比較条件

データと全点数は元例に合わせました。元例の `OrbitView` の座標、点サイズ、透過率、カメラ補間と完全には一致していません。元例と同じ端末・経路での比較計測は未実施で、速度の優劣は判定していません。

## 計測

`bin/mfs bench deckgl-015-point-cloud-layer --site` を3反復しました。1280×800・DPR 1、GPU は NVIDIA GeForce RTX 3060（Vulkan）です。全 808,042 点を描画し、画面の表示、回転、平行移動、拡大の画面変化を読み戻して確認しました。

| 指標 | 結果 | 予算 |
| --- | ---: | ---: |
| 初回表示 p50 | 57.57 ms | 1000 ms 以下 |
| 回転中のフレーム p95 | 1.65 ms | 8.3 ms 以下 |
| 固定画面のフレーム p95 | 0.595 ms | 8.3 ms 以下 |
| GPU p95 | 0.450 ms | 参考値 |
| コード gzip | 3,915 B | 20,000 B 以下 |
| データ gzip | 2,020,259 B | 2,500,000 B 以下 |

点を Morton 順に並べると、元の点順の約2.56 MBから約2.02 MBへ gzip サイズが下がりました。元例との同条件比較は未実施です。
