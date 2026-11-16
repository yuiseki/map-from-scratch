# Day 04 · Clusters

東京23区のOpenStreetMap施設点を、飲食・買い物・交通・公共観光の4分類で画面上のセルに集約します。地図移動・ズームとカテゴリ切り替えに応じてGPUで再集約する専用WebGL2描画器です。

## Data and limits

2026-08-31の `yuiseki/osm-tokyo23-src-2026-08` スナップショットから境界内の141,092施設を抽出しました。データと派生出力はODbL 1.0です。OSMはタグ付けされた施設点の分布であり、網羅性や現況を保証しません。カテゴリ規則、抽出処理、帰属表示は [spec.yaml](./spec.yaml) に記録しています。

## Verification

専用テストは `clusters.test.ts`、ブラウザ計測と画面検査は `bench.ts` です。Chrome 156で3反復し、3/3 checks・7/7 budgetsに合格しました。frame p95は0.455 ms、初回描画p50は511.79 ms、GPU時間p95は0.237 ms。スクリーンショットは `results/30DayMapChallenge-2026-04/screenshot.png` です。

```sh
bin/mfs test
bin/mfs bench 30DayMapChallenge-2026-04 -n 3
```
