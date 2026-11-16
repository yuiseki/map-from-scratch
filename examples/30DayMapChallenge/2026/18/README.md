# Day 18 · NULL

2020年国勢調査の250 m地域メッシュについて、東京都心の固定範囲で「75歳以上人口・女性」を表示します。セルを選ぶと公表状態、値、メッシュコード、座標を確認できます。

## 4つの状態

- 正の公表値は人数に応じた青緑から淡い色の塗り分けです。
- `0` は元表に明記されたゼロです。
- `*` は総務省統計局の定義書でいう秘匿対象項目で、斜線を付けています。人数は推定しません。秘匿された小地域の値が合算先メッシュに加算される場合があるため、内訳の合計と秘匿されない人口総数は一致しません。
- 行なしは人口が存在しないメッシュについて元表にレコードがない状態です。固定AOIの250 m格子からそのコードが欠けている場所を暗色の点線枠で示します。これは水域や土地利用を示すマスクではありません。

調査範囲は `139.65–139.78°E / 35.62–35.72°N`、格子中心が範囲内の2,016セルです。内訳は正値1,716、明示ゼロ27、秘匿49、行なし224。AOI外・範囲境界付近の格子を含めた東京都全体の集計ではありません。

## 再生成

```sh
systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- bin/mfs bake 30DayMapChallenge-2026-18
systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- bin/mfs bench 30DayMapChallenge-2026-18 -n 3
```

この例は専用のCanvas 2D描画器を使い、外部地図タイルやランタイム統計APIに接続しません。再生成時はメモリ・CPU上限付きで実データを処理してください。

## 計測

旧方式のframe計測（描画開始から次のrequestAnimationFrameまで）と、表示Canvasの直接読戻しを含む2026-11-05の値は履歴値です。frame計測方法も「連続するrequestAnimationFrameコールバック間の時刻差」に統一しました。現行値は下記のOffscreenCanvas検査を使った2026-11-06の再計測です。


## 出典

出典：政府統計の総合窓口(e-Stat)「令和2年国勢調査」(総務省統計局)を加工して作成。利用条件はe-Statの利用規約に基づくCC BY 4.0互換の条件です。地域メッシュの結果表示、秘匿値`*`、人口がないメッシュのレコードなしという意味は、総務省統計局の[ダウンロードデータの留意事項](https://www.stat.go.jp/data/mesh/pdf/ryuijikou.pdf)とe-Statの[T001142定義書](https://www.e-stat.go.jp/help/data-definition-information/downloaddata/T001142.pdf)を参照しています。

2026-11-06 corrected three-run Chrome 156 measurement after pixel checks were moved to an OffscreenCanvas copy: all 10 budgets and all 9 browser checks passed. Using callback-to-callback RAF intervals, frame p95 was 6.100 ms, draw CPU p95 3.130 ms, and first-frame p50 77.330 ms; gzip code/data 14,308/26,120 B. Host load averages were 23.84/22.02/21.75. This replaces the prior provisional measurement. See `results/30DayMapChallenge-2026-18/latest.json`.
