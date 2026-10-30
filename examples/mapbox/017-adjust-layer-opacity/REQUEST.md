# Mapbox: Adjust a layer's opacity

Mapbox GL JS の公式サンプル「[Adjust a layer's opacity](https://docs.mapbox.com/mapbox-gl-js/example/adjust-layer-opacity/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. シカゴ中心部（`[-87.6321, 41.8362]`、`zoom: 9.5`、minZoom 9.5 / maxZoom 13）の地図を表示する。
2. 市域を覆うラスタレイヤーを地図の上に重ねる。
3. スライダーをドラッグしてレイヤーの不透明度を 0〜100% で調整する。値の表示も更新する。

## 元例との差分

- 元例は Mapbox のラスタソース（`mapbox://mapbox.u8yyzaor`）を `raster-opacity` で調整し、`input[type=range]` を DOM に置く。ここではベイクした 256 px のチェッカー PNG を重ね、スライダーも Canvas に描いてヒットテストする（スクリーンショット1枚で状態まで確認できる）。
- 背景地図は OSM Carto のラスタタイル（City/Regional ズームなので実地図が必要）。到着までは Natural Earth 110m の陸で埋める。
- このリポジトリは 256 px ズーム基準なので、zoom 9.5 は元例より 1 段引いた縮尺。

## 設計の意図と判断

1. **不透明度は globalAlpha 1回**
   - ラスタを焼き直さず、`drawImage` 直前に `globalAlpha = opacity / 100` を設定する。Canvas 2D の合成は仕様どおり `src·a + dst·(1−a)` になる。
2. **チェッカーは最近傍で描く**
   - `imageSmoothingEnabled = false`。256 px を約 798x483 px に拡大してもセル中央の色が正確に残り、ブレンド式を画素で検証できる。
3. **期待値は「実際に描かれた下地」から作る**
   - まず 0% で下地画素を読み、それを 25% / 50% / 100% のブレンド計算に使う。タイル画像を自前デコードして期待色を作ると、配色変更で壊れる。
4. **スライダーの当たり判定をパンより先に**
   - トラック（24..238 px）より上下左右に広い当たり矩形を最初に処理する。パネル内の pointerdown はスライダー専用、外側だけパン。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 14.09 ms |
| 再描画 redraw_ms p95 | 0.65 ms |
| フレーム間隔 frame_interval_ms p95 | 11.02 ms |
| コード gzip | 4,716 B |
| データ gzip | 30,690 B |
| 検証チェック | 6 / 6 PASS (3 iterations) |

## 検証チェック

- `basemap-drawn`: 0% で表示範囲のタイルがすべて ready、画面の異なる色 > 150。
- `overlay-rendered-at-full-opacity`: 偶数セル rgb(37,99,235) / 奇数セル rgb(14,165,233) に ±2。
- `overlay-clipped-to-bounds`: 範囲外の左・右・下の画素が 0% の下地と ±1。
- `overlay-blends-at-half-opacity`: 50% の画素が `round(c·0.5 + b·0.5)` に ±3、かつ下地・セル色のどちらとも 15 以上異なる。
- `slider-sets-and-clamps-opacity`: 25% クリックで opacity=25・ノブ位置一致・画素一致、トラック外へのドラッグで 0% / 100% にクランプ。
- `overlay-anchors-on-zoom`: 範囲中心の +1 ズームで投影矩形が 2 倍（±1 px）、セル色は不変。

## データ

- 32 px セルの2色チェッカー + 白枠の 256x256 PNG（本リポジトリの bake が生成、パブリックドメイン）。
- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。
- OSM Carto 512 px タイル（ODbL、© OpenStreetMap contributors / © OpenMapTiles）を実行時に表示範囲だけ取得。

## 実装上の落とし穴

- スライダーのクランプ検証を「トラックの外をクリック」で行うと、当たり判定の外なので地図のパンとして扱われ、値が変わらない。クランプはトラック上から始めて外へドラッグする。
- `globalAlpha` の合成は 8 bit 丸めがあるため、期待値比較は ±3 の許容が必要（25% で 1 ずれた実例あり）。
- パネルを地図の上に描くので、検証用サンプル点がパネルに掛からない座標を選ぶ。
