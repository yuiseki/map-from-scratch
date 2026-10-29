# deck.gl GeoJsonLayer (Paths) に対応する専用描画器

[元例](https://deck.gl/examples/geojson-layer-paths)と同じ [道路形状](https://github.com/visgl/deck.gl-data/blob/1cce5f323fb2d7f8a93fd1443cf83076d5daae40/examples/highway/roads.json)と[事故集計](https://github.com/visgl/deck.gl-data/blob/1cce5f323fb2d7f8a93fd1443cf83076d5daae40/examples/highway/accidents.csv)を固定版として使います。事故集計の元データは [NHTSA FARS](https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars)です。道路形状のより前の作成経路は確認できていません。deck.gl-data のリポジトリは MIT ライセンスです。

道路線分を一度 GPU に転送し、年を変えるときだけ道路ごとの色と幅の表を更新します。道路約2万件、線分約27万本を描画し、1990〜2015年の事故件数と死亡者数を表示します。ホバーは別のフレームバッファに道路IDを描きます。

元例の OpenFreeMap 背景地図は含めていません。量子化で端点の位置にも差があります。背景と画面条件を揃えた比較が終わるまでは速度の優劣を主張しません。

## 計測

`bin/mfs bench deckgl-008-geojson-layer-paths --site` を3反復した。画面は1280×800・DPR 1、GPUは NVIDIA GeForce RTX 3060（Vulkan）。20,592道路、272,317量子化線分、26年分の事故値を配信した。公開用ビルドのスクリーンショットも確認した。

| 指標 | 結果 | 予算 |
| --- | ---: | ---: |
| 初回表示 p50 | 100.8 ms | 1000 ms 以下 |
| パン・ズーム中のフレーム p95 | 1.365 ms | 8.3 ms 以下 |
| 固定画面のフレーム p95 | 0.435 ms | 8.3 ms 以下 |
| GPU p95 | 0.2232 ms | 参考値 |
| 年変更・GPU完了 p95 | 3.135 ms | 20 ms 以下 |
| 5px範囲の道路選択 p95 | 1.895 ms | 16 ms 以下 |
| コード gzip | 6,885 B | 18,000 B 以下 |
| データ gzip | 約 1.85 MB | 4 MB 以下 |

全道路・線分の読み込み、表示、年変更での画面変化、道路IDからの事故値取得が3反復すべてで通った。元例との同条件比較は未実施で、速度の優劣は判定していない。
