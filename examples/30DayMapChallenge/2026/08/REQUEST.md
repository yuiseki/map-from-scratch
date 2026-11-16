# Day 08 · Utopia

練馬駅周辺の2020年250 m人口メッシュに、公園ポリゴンと学校点への近さを重ねます。両方400 m以内の居住メッシュを「理想的近隣」の条件として示し、人口、施設、距離条件を調べられる専用Canvas 2D地図です。

## Data and limits

e-Statの国勢調査、国土交通省の都市計画GIS公園、国土数値情報の学校データを使用します。対象は737人口メッシュ、109公園、106学校です。公園境界・学校位置への直線距離であり、入口、徒歩経路、利用可能性、住民の評価は表しません。各データの年、ライセンス、帰属と加工は [spec.yaml](./spec.yaml) に記録しています。

## Verification

テストは `utopia.test.ts`、ブラウザ計測は `bench.ts` です。修正後のChrome 156・3反復で5/5 checks・8/8 budgetsに合格しました。frame p95は3.145 ms、draw CPU p95は2.555 ms、初回描画p50は76.175 ms。両施設条件を満たすメッシュは328件です。スクリーンショットは `results/30DayMapChallenge-2026-08/screenshot.png` です。

```sh
bin/mfs test
bin/mfs bench 30DayMapChallenge-2026-08 -n 3
```
