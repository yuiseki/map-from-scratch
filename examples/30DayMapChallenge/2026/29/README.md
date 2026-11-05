# 29 · Raster — Is this a map?

中央本州から日本海溝までを、NOAA ETOPO 2022 の数値標高データそのものから描く専用 WebGL2 ラスター地図です。東京・富士山・海溝の実標高を同時に含む `[138.5°E, 34.5°N, 144.5°E, 40.5°N]` の範囲で、公式 GeoTIFF の必要メタデータと交差する圧縮 TIFF ブロックだけを HTTP Range で読み込みます。ファイル全体や生成タイル・画像は取得しません。

出典: NOAA National Centers for Environmental Information, *ETOPO 2022 15 Arc-Second Global Relief Model*, DOI [10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74). この例で使う正本は同製品の 30 arc-second global bedrock GeoTIFF です。元データの標高単位は metres、標高基準は WGS 84 + EGM2008 (EPSG:9518)、nodata は −99,999 です。ETOPO は全球地形・海底地形モデルであり、海図の測深値、航海用情報、沿岸浸水予測、現況測量ではありません。

## 読み込みと表示

TIFF は 43,200 × 21,600 の Float32、256 × 256 tiled classic TIFF です。タイルは DEFLATE (compression tag 8) と floating point Predictor=3 を使い、overview image はありません。ブラウザーの `DecompressionStream('deflate')` で選択タイルを復号し、Float32 のまま WebGL2 `R32F` テクスチャに置きます。シェーダーが海底・海面・陸地の色を割り当て、NoData は透明にします。

この固定初期範囲では全球の 14,365 タイル中 16 タイルを選択します。圧縮タイル合計は 2,123,065 B、選択範囲は 4 つの連続 byte span です。IFD は8 byte目にあり、タイル索引とGeoTIFFタグ配列は byte 115,516までに収まることを公式 TIFF から確認したため、metadata Range は131,072 Bです。4つのタイル範囲を並列取得し、合計 2,254,137 Bを読み込みます。先行した広い AOI `[138,33,147,43]` は25タイル・3,156,835 compressed Bを必要としたため、主要な東京・富士山・日本海溝のサンプルを保持するこの範囲へ絞りました。初期 AOI 全体をメモリー上のラスターテクスチャとして保持し、移動・拡大縮小はこの範囲の中で行います。

このデータ経路を選ぶ前に、カタログにあったローカル 15 arc-second BigTIFF COG (3,470,279,731 B) を、上限を掛けた GDAL サンプルと小範囲統計で検査しました。複数大陸の座標が nodata で、日本 AOI の valid percent も 0 でした。公開 URL の TIFF header とサンプル圧縮ブロックはローカルファイルと一致しました。NOAA の 15 arc-second tiled directory に日本タイルはなく、`ETOPO_2022_v1_15s_N30E135_bed.tif` は 404 でした。このため、値を確認できた公式 NOAA NCEI の 30 arc-second global raster に切り替えました。

## Range safety

各 Range 応答で HTTP status と期待する長さを確かめます。`Content-Range` が読める応答では byte offsets まで厳密に照合します。予期しない `200 OK` は本文を読み込む前にキャンセルし、1回だけ再要求します。サーバーのキャッシュ状態が変わる場合に備え、200 応答を巨大なファイルとして読む経路はありません。

ただし公式 `www.ngdc.noaa.gov` は `Access-Control-Allow-Origin: *` を返す一方で `Access-Control-Expose-Headers` を返しません。ブラウザー JavaScript から `Content-Range` は見えないため、この CORS 応答では既知の公式ファイル長、status 206、CORS-safelisted `Content-Length`、本文の実長を照合します。TIFF index 検査と復号後の東京・富士山・日本海溝の実ピクセル値も照合します。上限付き `curl` probe では同じ公式応答の `Content-Range` が要求した byte offsets と一致することを別途確認します。ヘッダーがブラウザーに露出している応答では引き続き `Content-Range` を厳密に照合します。

## Browser validation

前の広い AOI `[138,33,147,43]` から、東京・富士山・日本海溝の実標高サンプルを保ちながら16タイルに絞る `[138.5,34.5,144.5,40.5]` へ変更しました。tile spanは4つ、ソース取得量は2,254,137 Bです。

3反復ベンチマークでは全5 Range応答が HTTP 206、各Range 1回、同一応答の本文長と Content-Length が一致しました。metadata Range は0.46秒、圧縮spanは1.69〜2.00秒、最初の描画は p50 2.58秒 / p95 3.02秒でした。5秒の初回描画予算を通過しました。比較すると、metadataを131,072Bへ短縮した広い AOI でも p50 は9.58秒だったため、通信量・タイル数の削減が待ち時間の改善につながっています。

RAF frame interval p95は1.145ms、CPU draw p95は0.030ms、WebGL GPU draw p95は0.0297msでした。source selection、200応答キャンセル/再試行、地形色、選択標高、出典表示、AOI内のpan/zoom checks はすべて3回通過しました。RTX 3060 / NVIDIA ANGLE 上で測定しました。スクリーンショットを目視し、中央本州の起伏から海溝までの全体と余白、標高凡例、選択値、出典・注意書きが読めることを確認しました。スクリーンショットは `results/30DayMapChallenge-2026-29/screenshot.png` にあります。
