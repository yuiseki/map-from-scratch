# Day 30 · Pen & paper — 富士山の手書き地図ガイド

富士山周辺の実在するGSI標高データから、手描きのルートや注記を加えるためのA4横・印刷用等高線ガイドを作りました。色絵や手描き風の完成図ではなく、出典に基づく薄い標高線と書き込み欄を印刷するためのシートです。プレビューとダウンロードは同一のベクターSVGを使います。

## 出典と範囲

- データセット: [`hf:gsi-dem-fuji-z14-100m-2026-10-25`](https://huggingface.co/datasets/yuiseki/gsi-dem-fuji-z14-100m-2026-10-25)
- 元データ: `/sata_hdd_24tb/hf_data/gsi-dem-fuji-z14-100m-2026-10-25/data/elevation_100m.parquet`
- 出典: [国土地理院 基盤地図情報 数値標高モデル](https://maps.gsi.go.jp/development/ichiran.html)
- CRS: EPSG:3857。出典のz14タイル行列に対し10×10ラスターピクセルを1セルへ集約した約95.5463 mグリッドです。
- AOI: `grid_x=[371218,371456)`, `grid_y=[165525,165718)` の連続238×193セルです。EPSG:3857外接範囲は x=15430992.6147–15453732.6306 m, y=4203769.0261–4222209.4592 m。逆Web-MercatorのWGS84表示範囲は 138.6189651–138.8232422°E, 35.2929906–35.4280852°N です。セル原点と95.5462854 m間隔も `data/baked/30DayMapChallenge-2026-30/stats.json` に記録します。
- 出典タイル: 2026-10-25に取得したz14の100タイル、51,751,171 byte。マニフェストに対するSHA-256とバイト数は100/100一致を確認済みです。
- AOIの平均標高範囲は約439.68–3,760.01 m、セル内最小/最大はstatsに記録します。100m間隔で500mごとに太線を描きます。
- ベイク値は `elevation_mean_m` です。`valid_pixels` が0または平均値が欠損のセルは無効マスクとnullのまま保持し、海抜0mへ置換しません。このスナップショットのAOIは45,934セルすべて有効でした。

このGeoParquetは、DEM10Bから10×10ピクセルの標高統計を作った派生データです。DEM10Bの値は基盤地図情報からの補間値を含みます。等高線は集約格子上で補間した目安であり、測量線、現地の地形保証、公式GSI成果として扱わないでください。標高セルと緯度経度は元データにない精度を示すものではありません。

利用条件は[日本の公共データ利用規約第1.0版（PDL1.0）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)と[国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)に従います。一般的なCC BY素材とは表示していません。印刷シートには次の帰属・加工説明を収録します。

> Source: Geospatial Information Authority of Japan (GSI), elevation tiles (Fundamental Geospatial Data elevation model), https://maps.gsi.go.jp/development/ichiran.html. Edited and aggregated into 10×10-pixel cells by yuiseki. This is not an official GSI product.

## 描画と印刷

専用のSVG出力器がmarching squaresで100m等高線を補間し、共有辺の交点をつないでベクターパスにします。サドルセルは4頂点の双線形中心値で接続を選びます。欠損を含むセルは線を作りません。出力はA4横（297×210 mm）、中心緯度でWeb Mercatorの縮尺係数を補正した地上1:100,000、2kmの20mmスケールバーです。

地図範囲は約185.45×150.39mmです。ページ右側にはルートや注記を描く余白があり、凡例、北向き、緯度経度範囲、100m/500m線の区別を印刷します。PDFまたは紙に出すときは「100%」「Actual size」を選択してください。「用紙に合わせる」を使うと縮尺が変わります。

## 開発・検証

```sh
bin/mfs bake 30DayMapChallenge-2026-30
bin/mfs bench 30DayMapChallenge-2026-30 -n 3
```

実データ処理、テスト、型検査、ブラウザー計測は、すべて `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- <command>` の制約内で実行します。ブラウザー計測値とスクリーンショットは `results/30DayMapChallenge-2026-30/` に記録します。

### 最終ブラウザー計測

2026-11-06のChrome 156・1280×800、最終スタイルでの3反復ローカル計測では、first render p50 96.0 ms / p95 105.2 ms、SVG 179,003 byte、33 contour levels、49 stitched paths、地図枠内の非白画素27,735でした。全5予算・6ブラウザー検査に合格し、エラーと外部リクエストはありません。standalone SVGとプレビュー取得内容のバイト一致、物理ページ寸法・線の範囲・描画ピクセルを各反復で確認しました。

画面キャプチャは [screenshot.png](../../../../results/30DayMapChallenge-2026-30/screenshot.png)、機械検査値は [latest.json](../../../../results/30DayMapChallenge-2026-30/latest.json)、印刷用データは [sheet.svg](../../../../data/baked/30DayMapChallenge-2026-30/sheet.svg) です。縮尺はEPSG:3857の中心緯度35.3605661°でcos補正し、100,000:1の地上距離として実装・テストしました。PDFや物理プリンターの出力結果は今回の検査には含めていません。

Day30のテストは12/12件、Day30対象Node/Webのstrict型検査に合格しています。全体suiteの過去記録では、Day30実装時にDay29の1 ULP厳密比較で失敗が1件ありました。その後、2026-11-06にDay18・28のベンチ回帰テストを追加した状態で `bin/mfs test` を再実行し、999件中997件通過、2件スキップ、失敗0件でした。Node・Web・testの3種類の型検査も通過しています。
