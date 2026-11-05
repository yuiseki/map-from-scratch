# Request and design record

## Request

30DayMapChallenge 2026 の Day 26「Water」に、実際の日本の浸水想定区域と水深ランクを主題にした地図を作ります。地図が示すものは、選んだ河川・想定規模におけるモデル上の浸水想定です。実際に起きた洪水やこれから起きる洪水として描きません。

## Source selection

MLIT 国土数値情報 A31a FY2025 の5カテゴリから「想定最大規模」だけを選びました。さらに単一の河川（荒川）と河川管理者（関東地方整備局）に限定し、東経139.79–139.85度、北緯35.70–35.76度の小さな連続範囲を選択しています。範囲は見せるための矩形で、行政境界ではありません。

`A31a_205` を深さランクとして直接読みます。時間区分や家屋倒壊等氾濫想定区域を結合せず、複数シナリオ間で深さを合成もしません。空間順序と bbox を持つ `z:ksj/A31a/A31a-25_83_10_GEOJSON-part*.parquet` を使用します。これらはEPSG:6668 (JGD2011) のGeoParquetで、元データのパーティションと範囲を `stats.json` に保存します。

選択矩形との空間交差で切り出し、source file、河川、管理者、元ランク、形状を保持します。描画しない場所を「水深0」と解釈しません。元ランクが未設定の値も0に変換せず `null` として扱う検証モデルを用意しましたが、選択した想定最大規模ポリゴンにクラスなしの地物は含めません。

## Renderer

この用途では地図タイルや汎用地図エンジンよりも、クリップ済み固定データを色ランク別に一度だけラスター化する Canvas 2D が適しています。2,264個、124,919頂点の形状を初期ロード時に高さ2048ピクセル、bboxの地理的縦横比を保つオフスクリーン画像へ描きます。カメラのパンとズームでは画像だけを再配置し、クリック調査はベイク済みfeature bboxで候補を絞った後、元のポリゴン座標に対するpoint-in-polygonで実行します。これにより、操作ごとの頂点走査を避けながら出典属性を残します。

座標表示と500 mスケールバーは、矩形中心での局所的な正距円筒近似を使います。この小範囲では表示用の近似であり、測量用途の距離や測位精度を主張しません。画面上のグリッドは表示領域を示すだけで、行政界や河道を表すデータではありません。

## Limits and attribution

浸水想定は水防法に基づき河川管理者から提供されたモデル資料です。元の国土数値情報は、指定区域外でも浸水しうること、現実の水深が想定を上回りうること、想定条件が全要因を網羅しないことを説明しています。この表示から住所ごとの安全や危険を判断できません。

出典: 「国土数値情報（洪水浸水想定区域データ（河川単位））」（国土交通省）を加工して作成。CC BY 4.0。ページには出典、公式データページ、利用規約、ライセンスを表示します。

## Verification results

The capped model test suite passes all 8 tests, including rank definitions and ordering, unknown vs rank zero, coordinate conversion, clipping invariants, serialization, wheel-delta normalization, and polygon picking with holes and multipolygons. Node and isolated strict Web TypeScript checks pass.

The capped Chrome 156 browser harness ran three iterations at 1280×800. All 14 budgets and all 8 browser checks passed. It measured 2,264 unique polygons with source rank counts 163 / 423 / 757 / 919 / 2 / 0, 391,402 inundation-color pixels, first-frame p50 213.5 ms, frame p95 4.48 ms, draw CPU p95 0.205 ms, code gzip 9,678 B, data gzip 534,524 B, and zero external requests. Results are recorded in `results/30DayMapChallenge-2026-26/latest.json`.

The desktop 1280×800 screenshot at `results/30DayMapChallenge-2026-26/screenshot.png` was visually reviewed. The Arakawa river corridor and ranked flood areas are distinct; the selected feature retains its source fields; and the legend, bbox, 500 m scale, modeled-scenario caveat, and attribution are visible. The benchmark did not include a mobile viewport.
