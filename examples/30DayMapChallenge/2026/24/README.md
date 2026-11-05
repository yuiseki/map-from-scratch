# Day 24 · Network

東京都の2022年バスルート線とバス停を、Canvas 2Dの独自描画器で重ねるネットワーク地図です。N07の線は事業者別に絞り込めます。P11の停留所は記録された系統数に応じて大きくし、選択すると停留所名・事業者・原ID・系統表記・バス区分コードを表示します。

## データと範囲

- N07: `hf:ksj-n07-bus-route-greater-tokyo` の東京都 `prefectures/13.parquet`。2022年版、GeoParquet 1.1、EPSG:6668、`id` / `operator` / `pref_code` / `pref` / WKB `LineString`。東京分17,540線。N07には系統ID・系統名・時刻表・頻度がありません。一つの線は系統そのものを意味しません。
- P11: `hf:ksj-p11-bus-stop-jp` の東京都 `prefectures/13.parquet`。2022年版、GeoParquet 1.1、EPSG:6668、`id` / `name` / `operator` / `routes[]` / `kinds[]` / `n_routes` / WKB `Point`。東京分12,389停留所。`routes`は停留所に記録された系統表記、`kinds`は同じ順序のバス区分コードです。
- ローカル入力: `/sata_hdd_24tb/hf_data/ksj-n07-bus-route-greater-tokyo/data/parquet/prefectures/13.parquet` と `/sata_hdd_24tb/hf_data/ksj-p11-bus-stop-jp/data/parquet/prefectures/13.parquet`。それぞれのデータカード、列説明、LICENSEを確認しています。
- 固定表示範囲は東経139.55–139.95度、北緯35.52–35.82度の矩形です。これは区界や運行エリアではなく、区部と周辺を見せるための東京都内フォーカスです。EPSG:6668の経度・緯度をEPSG:3857へ投影します。
- この矩形と交差するN07線は9,545本、内側にあるP11停留所は6,664点でした。P11は15,286件の停留所-系統表記を持ち、`n_routes >= 2` の停留所は3,180点、最大値は27です。両表それぞれの事業者数は57です。P11の `(operator, 完全一致する系統表記)` の組は915個です。上限付きベイクでこれらを再確認し、87,107個のN07切り取り頂点と5,637,159 BのネットワークJSONを生成しました。出力の来歴と集計は `data/baked/30DayMapChallenge-2026-24/stats.json` にあります。

## ネットワークの読み方

N07線形とP11点を別のソース地物として描きます。IDの名前空間と意味が異なり、共通キーもないため、線を停留所やP11系統表記へ結び付けません。P11内の停留所-系統表記関係だけは、二部 incidence graph として `(stop id) → (operator, exact route label)` に展開します。これは停留所に記載された表記の共有を表し、N07の線形への対応、系統の順序、運行方向、時刻・頻度、運行継続を示しません。事業者フィルターも各レコードの元 `operator` 値だけで行います。

したがってこの地図は2022年時点の資料を空間表示したものです。現在のバス運行案内や、全便・全系統を網羅した路線図ではありません。ルート線位置は資料作成元の地図等からの収録で、測量線ではありません。

## 操作と実装状況

専用Canvas 2D描画器を使います。ドラッグでパン、ホイール・ボタン・`+` / `-`でズーム、矢印キーで移動、`Home`で初期範囲に戻ります。点の選択には画面座標の最近傍ヒットテストを使います。地図タイルや実行時外部サービスは使いません。

`network.ts`の変換・入力スキーマ検証・完全一致の系統表記 incidence・N07重複行処理・範囲切り取り・JSONラウンドトリップ・停留所検査とカメラ／選択を、小さな独立テストで確認しています。資源上限付き3反復のブラウザ計測では初回描画p50 304.5 ms、Canvas描画CPU p95 12.13 ms、フレーム間隔p95 15.78 ms、data gzip 1,458,086 Bでした。全予算・4つのverification gateが通り、外部originへの実行時通信はありません。最大フレーム間隔84.35 msのtailも記録されているため、p95合格を全フレーム保証とは解釈しません。ブラウザ出力とスクリーンショットは `results/30DayMapChallenge-2026-24/latest.json` と `results/30DayMapChallenge-2026-24/screenshot.png` にあります。

## 出典・利用条件

- N07: [国土数値情報 バスルートデータ](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-v2_0.html) — `出典：「国土数値情報（バスルートデータ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-v2_0.html）を加工して作成`
- P11: [国土数値情報 バス停留所データ](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-v3_0.html) — `出典：「国土数値情報（バス停留所データ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-v3_0.html）を加工して作成`
- データカードはいずれもCC BY 4.0条件との互換を明記しています。表示と派生物には原典名と加工した旨を表示します。2022年版であり、出典機関が現在の運行を認定した表示ではありません。
