# deck.gl HexagonLayer に対応する専用描画器

## 依頼

> 英国の交通事故約14万件を六角セルへ集計し、件数を立体の高さと色で見たい。地図を動かし、集計半径・列の幅・上位分位を操作したい。

[元例](https://deck.gl/examples/hexagon-layer) と同じ [英国の交通事故データ](https://github.com/visgl/deck.gl-data/tree/master/examples/3d-heatmap) を使う。元データは [Department for Transport の Road Safety Data](https://www.data.gov.uk/dataset/cb7ae6f0-4be6-4935-9277-47e5ce24a11f/road-accidents-safety-data) に由来し、UK Open Government Licence で公開されている。

## 設計

- 有効な経緯度をベイク時に Web Mercator へ変換し、各点を4バイトの座標に量子化する。
- 半径を変えたときだけ点を六角格子へ再集計する。カメラ操作中はセルごとのインスタンスバッファを再利用する。
- WebGL2 で六角柱をインスタンス描画する。高さと色は事故件数に基づき、上位分位で上限を調節する。
- 元の deck.gl 版との同条件比較は今後実施する。比較が完了するまで速度の優劣を主張しない。

## 計測

`bin/mfs bench deckgl-012-hexagon-layer --site` を3回反復した。GPUは NVIDIA GeForce RTX 3060（Vulkan）、画面は1280×800・DPR 1。

| 指標 | 結果 | 予算 |
| --- | ---: | ---: |
| 初回描画 p50 | 97.6 ms | 1000 ms 以下 |
| カメラ操作中のフレーム p95 | 1.29 ms | 8.3 ms 以下 |
| カメラ操作中の GPU p95 | 0.164 ms | 参考値 |
| 固定画角フレーム p95 | 0.43 ms | 8.3 ms 以下 |
| 半径変更時の再集計 p95 | 20.27 ms | 200 ms 以下 |
| 上位分位変更時の更新 p95 | 3.175 ms | 50 ms 以下 |
| コード gzip | 6,035 B | 14,000 B 以下 |
| データ gzip | 494,900 B | 500,000 B 以下 |

有効な事故140,029件のセルへの割り当て、柱の表示、半径・列幅・上位分位による変化の5チェックは各反復で通った。上位分位の変更では元の点を再集計せず、既存セルから柱を作り直す。量子化による座標刻みはこのデータ範囲で東西約9.6m、南北約19.8mで、最小集計半径500mより小さい。元の deck.gl 版との同条件比較はまだ行っていないため、速度の優劣は主張しない。
