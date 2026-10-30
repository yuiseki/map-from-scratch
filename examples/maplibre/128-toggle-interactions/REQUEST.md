# MapLibre: Toggle interactions

MapLibre GL JS の公式サンプル「[Toggle interactions](https://maplibre.org/maplibre-gl-js/docs/examples/toggle-interactions/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. 中心 `[-77.04, 38.907]`、`zoom: 3` の地図を表示する。
2. 地図上にチェックボックス付きの操作パネルを置き、次の 3 つを個別に有効/無効にする。
   - Drag pan（ドラッグでパン）
   - Scroll zoom（ホイールでズーム）
   - Double-click zoom（ダブルクリックでズーム）
3. 初期状態はすべて有効。無効にした操作はカメラを 1 px も動かさない。

## 元例との差分

- 元例は MapLibre の `dragPan` / `scrollZoom` / `doubleClickZoom` ハンドラをチェックボックスで切り替える。ここでは Canvas 上にパネルを描き、同じ 3 つを自前の入力ハンドラのフラグで切り替える。
- 回転・ピッチ・ピンチ・キーボードは実装しない（`not_doing` に明記）。
- 大陸スケール（ズーム 3）なのでラスタタイルは使わず、Natural Earth 陸地塗りで足りる。

## 設計の意図と判断

1. **無効化はハンドラの先頭で return**
   - 描画コードはトグル状態を一切見ない。入力イベントを受け取った時点でフラグを確認するだけなので、レンダリング経路に分岐が増えない。
2. **パネルは Canvas に描く**
   - DOM のチェックボックスだと「チェックが消えた」ことを画面ピクセルとして読み戻せない。Canvas に描けば、チェックの有無とラベルの文字まで検証できる。
3. **行動で検証する**
   - 実際の pointer / wheel / dblclick イベントを再送し、カメラ状態と目印の投影座標が動かないことを確かめる。見た目だけのテストでは「無効化が効いていない」退行を見逃す。
4. **resetView はカメラとトグルを同時に戻す**
   - 検証の順序依存をなくし、スクリーンショットを常に同じ初期状態で撮る。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 8.665 ms |
| 再描画 redraw_ms p95 | 0.39 ms |
| フレーム間隔 frame_interval_ms p95 | 5.135 ms |
| コード gzip | 3,595 B |
| データ gzip | 30,400 B |
| 検証チェック | 10 / 10 PASS |

## 検証チェック

- `controls-visible`: パネル・3 つのチェック・ラベル文字が描かれている。
- `map-rendered-at-target`: DC が陸地、大西洋が海。
- `drag-pans-by-default`: 120×60 px ドラッグでカメラと目印が正しく動く。
- `drag-disabled-stops-pan`: チェックを外すと 150×60 px ドラッグでも不動（差分 0）。
- `drag-reenabled-works`: 再チェックで 80×40 px のパンが効く。
- `scroll-zooms-by-default`: ホイール 1 段でカーソル中心に √2 倍。
- `scroll-disabled-stops-zoom`: チェックを外すとズームしない。
- `dblclick-zooms-by-default`: ダブルクリックで 1 段ズーム（2 倍）。
- `dblclick-disabled-stops-zoom`: チェックを外すとズームしない。
- `reset-restores-controls`: resetView でズームと 3 つのチェックが戻る。

## データ

- Natural Earth 110m 陸地（パブリックドメイン）をベイク時に Web Mercator へ投影。

## 実装上の落とし穴

- `dblclick` は `pointerdown` より後に来る。トグルパネルのクリック判定は `pointerdown` の座標で行わないと、行のクリックがドラッグ開始と競合する。
- 位置の検証は自前の投影式で行う。描画器の `getScreenPos` をそのまま使うと、投影のバグを検証が見逃す。
