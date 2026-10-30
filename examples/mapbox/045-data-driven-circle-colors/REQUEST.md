# Mapbox GL JS "Data driven circle colors" に対応する専用描画器

[Data driven circle colors](https://docs.mapbox.com/mapbox-gl-js/example/data-driven-circle-colors/) は、地震の GeoJSON を円レイヤで描き、`interpolate` 式で `mag`（マグニチュード）から円の色と大きさを連続的に変える例です。

この実装は同じ地震データ（6,107 点、M0.95–M8.1）を、`gl.POINTS` の点スプライトとして 1 ドローコールで描きます。マグニチュードから色と半径を決める補間は頂点シェーダーの uniform ストップで評価し、M1・M3・M6 でそれぞれアンバー・青・赤、半径 3・6・14 px になります。背景の陸地は下に重ねた Canvas 2D レイヤにベクタで描くため、ズームしても海岸線がぼやけません。ドラッグとホイールで操作できます。

元例との同条件の速度・画面比較は未実施です。元例は Mapbox GL JS のベクタタイル地図、この実装はベイクした点データと Natural Earth 110m の陸地です。

## データと帰属

- 地震: USGS（米国政府の著作物、パブリックドメイン）。MapLibre 公式例が配布する固定 GeoJSON を使用。
- 背景の陸地: Natural Earth 110m land（パブリックドメイン）。

## 計測

`bin/mfs bench mapbox-045-data-driven-circle-colors -n 3` を3反復した。画面は1024×768・DPR 1。

| 指標 | 結果 | 予算 |
| --- | ---: | ---: |
| 初回表示 p50 | 66.7 ms | 500 ms 以下 |
| CPU 時間 p95（300 フレーム） | 0.23 ms | 2.0 ms 以下 |
| フレーム時間 p95 | 1.18 ms | 8.3 ms 以下 |
| コード gzip | 5,116 B | 7,000 B 以下 |
| データ gzip | 82,590 B | 120,000 B 以下 |

画面ピクセルと操作の検証8項目は3反復すべてで通った。

## 実装のメモ

- 色・半径の補間はシェーダ内の uniform ストップで行い、頂点バッファは (mercator x, mercator y, mag) の 12 バイト固定長だけにする。
- 円は `gl.POINTS` のスプライトで、`gl_PointCoord` から円形の被覆率を出して縁を滑らかにする。
- 陸地は透明な GL キャンバスの下の Canvas 2D レイヤに描く。テクスチャに焼くとズームでぼやけるため。
- ホイールズームはポインタ位置を基準にする（`zoomAt`）。画面中央を基準にすると、ポインタの下の地点がズームのたびに滑っていく。
