# Day 09 · Urban-rural

GHSL 2020人口推計を明るさ、建成地面積比を色相に対応させ、日本の都市・農村分布を連続色で描きます。2製品の格子原点が異なるため、格子番号の一致ではなく地理的包含で対応付けるWebGL2専用描画器です。

## Data and limits

GHSL R2023A E2020のGHS-POPとGHS-BUILT-Sを選択した5タイルから抽出し、Natural Earth日本ポリゴンを表示範囲のマスクに用います。331,296セル（人口あり321,955、建成のみ9,341）、うち311,442セルを空間対応付けしました。モデル推計値であり国勢調査の実数ではありません。また南西側はタイル範囲外のため29.0995°N以南が含まれません。ライセンス、DOI、加工は [spec.yaml](./spec.yaml) に記録しています。

## Verification

テストは `urban.test.ts`、ブラウザ計測は `bench.ts` です。Chrome 156で3反復し、5/5 checks・9/9 budgetsに合格しました。frame p95は0.295 ms、draw CPU p95は0.035 ms、初回描画p50は457.145 ms。gzipデータは2,025,074 Bです。スクリーンショットは `results/30DayMapChallenge-2026-09/screenshot.png` です。

```sh
bin/mfs test
bin/mfs bench 30DayMapChallenge-2026-09 -n 3
```
