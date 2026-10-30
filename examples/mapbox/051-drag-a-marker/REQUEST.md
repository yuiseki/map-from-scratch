# Mapbox: Drag A Marker

Mapbox GL JS の公式サンプル「[Drag A Marker](https://docs.mapbox.com/mapbox-gl-js/example/drag-a-marker/)」を写経し、外部ライブラリ（MapLibre / Mapbox 等）を使わずに最小・最速の専用描画器を作成してください。

## 依頼内容
1. `[-66.324, -16.498]`（ボリビア）にピンを置き、`zoom: 3` の地図を表示する。
2. ピンをマウスでつかんで地図上の任意の位置へ動かせる。ピン以外をドラッグすると地図がパンする。
3. ホイールで拡大縮小できる。
4. ピクセル読み戻しと緯度経度で、ドラッグ・パン・ズームを検証する。

## 設計の意図と判断

1. **矩形ヒットテストでピンと地図を分岐**
   - `pointerdown` の位置がピンの矩形（先端基準で幅32×高さ44 px）に入っていればピンをドラッグ、外なら地図をパンする。DOM の Marker 要素やピクセル読み戻しは使わない。
2. **つかんだ位置のずれを保持**
   - 先端とポインタの差を `pointerdown` 時に保存し、`pointermove` ではポインタ＋ずれを新しい先端にする。ピンがポインタ位置へ跳ばず、自然に追従する。
3. **緯度経度はドラッグ時に逆メルカトル**
   - 描画は常にピン1枚の `drawImage` だけ。座標変換は pointermove のときだけ行う。
4. **背景はベイク済み Natural Earth 110m 陸地**
   - 世界スケール（z3）なのでラスタータイルは不要。

## 計測結果

`bin/mfs bench mapbox-051-drag-a-marker -n 3`、1024×768・DPR 1。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 16.91 ms |
| 再描画 redraw_ms p95 | 0.705 ms |
| フレーム間隔 frame_interval_ms p95 | 1.1 ms |
| コード gzip | 3,134 B |
| データ gzip | 30,400 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `draggable-marker-visible`: ピン頭部が青で、lnglat≈(-66.324, -16.498)。
- `marker-drags-to-pointer`: 合成 PointerEvent でピンを 80×50 px 動かすと、ピンも同じ量だけ動き、逆メルカトルの期待 lnglat と 0.05° 以内で一致。
- `marker-drag-does-not-pan`: ピンのドラッグ中は地図中心がアンカーのメルカトル座標のまま。
- `map-pans-away-from-marker`: 余白から 30×20 px ドラッグすると中心が (-30/scale, -20/scale) 変化し、ピンも (+30, +20) px 動く。
- `wheel-zoom-keeps-point`: ズーム前後でピンのずれ < 1.5 px。

## データと帰属

- 背景の陸地: Natural Earth 110m land（パブリックドメイン）。
- ピン: 実行時に Canvas で生成。

## 実装のメモ

- ポインタ位置へ先端を合わせるだけの実装では、つかんだ頭部から先端までの 32 px 分だけピンが跳び、ベンチの `dy` が 50 ではなく 18 になった。ずれを保持する形に直して 5/5 に戻した（この失敗も spec の performance_knowledge に記録）。
- ベンチは `PointerEvent` を canvas へ dispatch して、実際の listener 経路を通している。`setPointerCapture` は合成イベントでは例外になることがあるため try/catch で無視する。
