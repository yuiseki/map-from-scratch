# MapLibre: Restrict map panning to an area

MapLibre GL JS の公式サンプル「[Restrict map panning to an area](https://maplibre.org/maplibre-gl-js/docs/examples/restrict-map-panning-to-an-area/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. ニューヨーク市域の `maxBounds`（南西 `[-74.0473, 40.6839]` / 北東 `[-73.9106, 40.8776]`）を設定する。
2. 初期中心 `[-73.9978, 40.7209]`、`zoom: 13`。
3. ドラッグ・ホイールでパン・ズームしても、maxBounds の外が見えない。
4. maxBounds がビューポートより狭いときは、範囲が画面を満たすズームまで引き上げる（MapLibre と同じ）。

## 元例との差分

- 元例は MapLibre の `maxBounds` オプションに任せる。ここでは pan / zoom / resize のたびにカメラ中心とズームを数十行のクランプ演算で制約する。
- 背景は OSM Carto のラスタタイル（City ズームなので実地図が必要）。到着まではベイクした Natural Earth 110m の陸で埋める。
- このリポジトリは 256 px ズーム基準なので、同じ zoom 13 でも元例（512 px タイル基準）より 1 段引いた縮尺になる。
- 1024x768 のビューポートでは bounds の経度幅（0.1367°）が z13 の画面幅（0.1758°）より狭いため、初期ズームは 13 ではなく 13.36（bounds-fill）になる。初期中心 40.7209°N も、短い縦方向では南端を越えるため 19 px 北へ寄せられる。いずれも MapLibre と同じ制約の結果。

## 設計の意図と判断

1. **クランプは軸ごと・カメラ更新の直後**
   - ビューポートが範囲より広い軸は中心を範囲中心へ固定し、狭い軸は `[境界 + 半ビューポート, 境界 - 半ビューポート]` にクランプする。描画時に補正するとパン量とカメラ移動量がずれ、境界で地図が滑る。
2. **ズームの下限は「範囲が画面を満たす」ズーム**
   - `minZoom = log2(max(w / (256·Δmx), h / (256·Δmy)))`。これ以上ズームアウトすると範囲外が見えてしまうので、wheel のたびにクランプする。
3. **検証は独立計算**
   - bench 側は renderer のヘルパを使わず、自前の Mercator 変換・bounds 定数・半ビューポートで端点を再計算する。実装と同じ関数を呼ぶと、壊れていても一致してしまう。
4. **地理で確かめる**
   - 「ラスタが出ている」だけでなく、アッパー・ニューヨーク湾が青、マンハッタン（フィナンシャル・ディストリクト）が明るい陸色であることを画素で確認する。カメラがずれたり鏡像になったりしていれば両立しない。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 11.22 ms |
| 再描画 redraw_ms p95 | 0.59 ms |
| フレーム間隔 frame_interval_ms p95 | 10.72 ms |
| コード gzip | 4,524 B |
| データ gzip | 30,400 B |
| 検証チェック | 8 / 8 PASS (3 iterations) |

## 検証チェック

- `basemap-drawn`: 表示範囲のタイルがすべて ready、画面の異なる色 > 150。
- `basemap-shows-geography`: 湾が青（b > r + 20）、フィナンシャル・ディストリクトが明るい陸色（r > 200）。
- `bounds-clamped-at-min-zoom`: 初期 zoom = bounds-fill 13.3628、中心 x = 範囲中心、y = 南端リミット、東西端が画面端 x=0 / 1024、水平ドラッグで動かない。
- `drag-east-stops-at-east-bound`: z14.5 で 2800 px 東へドラッグ → 東端が画面右端 x=1024。
- `drag-south-stops-at-south-bound`: z14.5 で南へドラッグ → 南端が画面下端 y=768。
- `pan-inside-bounds-works`: 東端から 300 px 西へパン → 境界が x=1324、300 px 戻すと x=1024 に正確に戻る。
- `zoom-out-capped-at-bounds`: wheel アウト 10 回でも bounds-fill ズーム、画面四隅が範囲内。
- `reset-view-restores-constrained-camera`: 制約済みの初期カメラに戻る。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。
- OSM Carto 512 px タイル（ODbL、© OpenStreetMap contributors / © OpenMapTiles）を実行時に表示範囲だけ取得。

## 実装上の落とし穴

- 「初期中心をそのまま使う」と 1024x768 では南端が 19 px はみ出す。初期化時にもクランプを適用しないと、最初の1フレームだけ範囲外が見える。
- ズームアウトのクランプを忘れると、パンは制限されても範囲外が見えてしまう。MapLibre の maxBounds はパンだけでなくズームも制約する。
- スライダー等の UI を持たない例なので、ラスタのピクセル検証は「色数 + 地理的な色」で行う。道路ラベルが偶然同じ色になることはあっても、湾と市街地の両方を同時に満たすことはない。
