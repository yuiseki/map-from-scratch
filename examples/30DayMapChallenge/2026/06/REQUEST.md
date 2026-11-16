# Day 06 · Vintage

Natural Earthの国境を紙地、控えめな国別配色、経緯線、彫版風ハッチで描くCanvas 2D地図です。小国を簡略化で消さず、地図帳の古い印刷表現を専用描画器で構成します。

## Data and limits

Natural Earth 1:10mの258か国を使用します。データはpublic domain（credit appreciated）です。国境線はNatural Earthの収録内容に依存し、現況の法的境界を保証するものではありません。加工と帰属は [spec.yaml](./spec.yaml) に記録しています。

## Verification

テストは `vintage.test.ts`、描画計測は `bench.ts` です。Chrome 156で3反復し、3/3 checks・5/5 budgetsに合格しました。frame p95は2.20 ms、初回描画p50は79.665 ms。スクリーンショットは `results/30DayMapChallenge-2026-06/screenshot.png` です。

```sh
bin/mfs test
bin/mfs bench 30DayMapChallenge-2026-06 -n 3
```
