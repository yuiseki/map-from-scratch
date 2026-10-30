# deck.gl ScatterplotLayer に対応する専用描画器

[deck.gl ScatterplotLayer](https://deck.gl/docs/api-reference/layers/scatterplot-layer) のドキュメント例は、マンハッタンの 13,987 点を `ScatterplotLayer` のインスタンスとして GPU に送り、重みに応じた半径と色で描きます。

この実装は同じ deck.gl-data の Manhattan 点データ（`[lng, lat, weight]`、重みは 1 か 2）を使い、WebGL も deck.gl も使わずに Canvas 2D で描きます。ベイク時に Web Mercator 座標と重みを Float32 の 16 bytes/点に詰め、実行時は画面内の点だけを重みごとのパスにまとめて埋めます。重み 1 は青、重み 2 は橙で、重い点が上に来るよう 2 パスで描きます。点は円ではなく、ピクセルにスナップした小さな正方形です（円弧のテッセレーションが 60 Hz に収まらなかったため）。

パンとホイールズームを持ちます。クリックやホバーのピッキング、背景地図は実装していません。

元例との同条件の速度・画面比較は未実施です。元例は WebGL、この実装は Canvas 2D で、フレーム時間をそのまま比べられません。

## データと帰属

- deck.gl-data の `examples/scatterplot/manhattan.json`（visgl/deck.gl-data、MIT）。元例と同じファイルです。

## 計測

`bin/mfs bench deckgl-016-scatterplot-layer -n 3` を3反復した。画面は1280×800・DPR 1。Canvas 2D なので GPU 時間は取得できない（`gpu: n/a`）。

| 指標 | 結果 | 予算 |
| --- | ---: | ---: |
| 初回表示 p50 | 28.2 ms | 300 ms 以下 |
| 再描画 p95 | 3.63 ms | 8.3 ms 以下 |
| フレーム間隔 p95 | 17.27 ms | 20 ms 以下 |
| コード gzip | 2,439 B | 6,000 B 以下 |
| データ gzip | 76,410 B | 260,000 B 以下 |

画面ピクセルとパン・ズームの検証4項目は3反復すべてで通った。

## 実装のメモ

- 点は重みのバケットごとに1つのパスにまとめ、fill は2回だけ。点ごとの fill や円弧のままだと、ソフトウェアラスタライザでフレーム間隔 p95 が 25〜29 ms に落ちた。
- 点を正方形にし、座標と辺長を整数に丸めると、アンチエイリアスが消えて p95 17.3 ms まで戻った。
- 画面外の点は投影後の座標比較だけで捨てる。
- 検証は点の読み込み数、初期表示の色、パン・ズーム後の再投影を画面ピクセルで行う。
