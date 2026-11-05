# Day 07 · 10 minute map

上野駅を起点に、OSM道路グラフ上を徒歩速度1.2 m/sと仮定してDijkstra探索し、10分以内に到達できる道路を所要時間別に描きます。圏外道路も暗色で残し、到達範囲を地理的に位置付けます。

## Data and limits

道路網は2026-08-31の東京OSMスナップショットから作成し、ODbL 1.0帰属を表示します。12,780ノード・16,080辺のグラフから1,376道路区間が到達可能と判定されました。速度は一律のモデル仮定で、勾配、信号、通行規制、歩行者の実測速度は考慮しません。詳細は [spec.yaml](./spec.yaml) に記録しています。

## Verification

テストは `walk.test.ts`、ブラウザ計測は `bench.ts` です。Chrome 156で3反復し、4/4 checks・8/8 budgetsに合格しました。frame p95は1.715 ms、初回描画p50は79.88 ms、draw CPU p95は0.085 ms。スクリーンショットは `results/30DayMapChallenge-2026-07/screenshot.png` です。

```sh
bin/mfs test
bin/mfs bench 30DayMapChallenge-2026-07 -n 3
```
