# Day 05 · Senses: Sight

富士山周辺の実標高格子を、照明付きWebGL2地形として立体表示します。視点はドラッグとズームで操作でき、陰影と視点移動で地形の起伏を読み取れます。

## Data and limits

GSI DEM10B由来の256×256、65,536格子を使用します。標高値を間引いて地形メッシュを作り、標高や格子を新たに測量したデータとして扱いません。GSIコンテンツ利用規約・政府標準利用規約（第1.0版）の条件と帰属、「編集済み・非公式」の表示を [spec.yaml](./spec.yaml) に記録しています。

## Verification

テストは `terrain.test.ts` と `camera.test.ts`、ブラウザ計測は `bench.ts` です。Chrome 156で3反復し、3/3 checks・8/8 budgetsに合格しました。frame p95は0.675 ms、初回描画p50は553.47 ms、GPU時間p95は0.326 ms。スクリーンショットは `results/30DayMapChallenge-2026-05/screenshot.png` です。

```sh
bin/mfs test
bin/mfs bench 30DayMapChallenge-2026-05 -n 3
```
