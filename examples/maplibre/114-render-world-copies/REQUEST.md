# MapLibre: Render world copies

MapLibre GL JS の公式サンプル「[Render world copies](https://maplibre.org/maplibre-gl-js/docs/examples/render-world-copies/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心 `[179, 0]`、`zoom: 0.01` で日付変更線をまたぐ世界地図を表示する。
2. 世界を左右に繰り返し描く（renderWorldCopies = true）のが既定。
3. 地図上のラジオボタンで On / Off を切り替え、Off なら 1 つだけ表示する。
4. パンしても複製の位置関係は保たれる。

## 元例との差分

- 元例は MapLibre の `map.setRenderWorldCopies(true | false)` を DOM のラジオボタンで切り替える。ここでは Canvas 上にラジオパネルを描き、可視範囲の wrap 回数を切り替える。
- ズームはこのリポジトリの 256 px 基準（元例の MapLibre は 512 px タイル基準なので、同じ 0.01 でも見かけの縮尺が半分）。
- 世界の上下（極の外側）は海洋色で埋める。MapLibre もスタイル背景色で同じように見える。

## 設計の意図と判断

1. **複製は wrap ループそのもの**
   - 専用機能ではなく、可視範囲の tile 座標を `floor` して、同じポリゴンを x 方向に平行移動して描く。On/Off は wrap 範囲を可視範囲にするか `[0, 0]` にするかの違いだけ。
2. **複製は周期性で検証する**
   - 「複製が出ている」は、1 世界幅ずらした画素が同じ陸海かどうかで確かめる。目視より厳密で、Off にした片方だけが消える退行も捕まえられる。
3. **パネルは Canvas に描く**
   - ラジオの選択状態までピクセルとして読み戻せる。
4. **ズームは 0 でクランプ**
   - MapLibre の minZoom 既定 0 に合わせ、それより縮小しない。
5. **1 世界ぶんのパスを最初に 1 回だけ作る**
   - 陸地と海岸線を、Mercator の [0, 1] 座標の `Path2D` として読み込み時に作る。フレームごとには、複製ごとに変換行列を設定して `fill` と `stroke` を呼ぶだけ。線幅は `1 / scale` にして 1 px に保つ。

## 計測結果

2026-11-03、RTX 3060 のホストの headless Chromium (`bin/mfs bench`、load average 2〜5)。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 43.7 ms (Path2D にする前は同じ条件で 50〜60 ms) |
| 再描画 redraw_ms p95 | 0.085〜0.12 ms |
| フレーム間隔 frame_interval_ms p95 | 6.7〜7.9 ms |
| コード gzip | 3,367 B |
| データ gzip | 30,400 B |
| 検証チェック | 6 / 6 PASS |

## 検証チェック

- `panel-visible`: On/Off ラジオが描かれ、既定で On。
- `copies-visible-by-default`: アフリカ赤道の点が 1 世界幅左にも陸地として現れる。
- `copies-are-true-copies`: 赤道 200 画素を 1 世界幅ずらして陸海分類し、不一致 10 以下。
- `copies-off-single-world`: Off で隣の世界が消え、元の世界は残る。
- `copies-on-restored`: On で複製が復活する。
- `pan-keeps-copies`: 100 px パン後も複製は 1 世界幅の位置関係を保つ。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。

## 実装上の落とし穴

- 多角形ごとに頂点を並べ直して `fill` と `stroke` を呼ぶ版は、全体表示 (世界 6 枚) で毎フレーム約 6 万回の `lineTo` になり、redraw_ms p95 が 2.1〜2.6 ms で予算 2 ms を超えた (2026-11-03、RTX 3060 のホストの headless Chromium、load average 2〜5)。`Path2D` を 1 回作って変換行列で使い回す形にして 0.085〜0.12 ms になった。画面の差は海岸線のアンチエイリアスだけで、最大 10 / 255。

- ズーム 0.01 では世界が約 257 px で、大陸は 10 px 程度。厳密な輪郭比較ではなく陸海の分類で検証する。
- wrap の左右範囲を `Math.floor` で求める際、中心が 179°E のような端にあると符号を間違えやすい。`centerMx ± width / (2 * scale)` をそのまま floor する。
