# maplibre-048-create-a-draggable-marker: ドラッグできるピン

## 依頼内容

> 経度0・緯度0に置いたピンをマウスでつかんで地図上の任意の位置へ動かせる地図を表示したい。ピン以外の場所をドラッグしたときは地図がパンし、ホイールで拡大縮小できる。外部ライブラリなしで、最速・最小で。

元例: [MapLibre - Create a draggable Marker](https://maplibre.org/maplibre-gl-js/docs/examples/create-a-draggable-marker/)

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

`bin/mfs bench maplibre-048-create-a-draggable-marker -n 3`、1024×768・DPR 1。

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 14.14 ms（3回の p95 57.9 ms） |
| 再描画 redraw_ms p95 | 0.51 ms |
| フレーム間隔 frame_interval_ms p95 | 1.12 ms |
| コード gzip | 3,010 B |
| データ gzip | 30,396 B |
| 検証チェック | 5 / 5 PASS |

## 検証チェック

- `draggable-marker-visible`: ピン頭部が青で、lnglat≈(0, 0)。
- `marker-drags-to-pointer`: 合成 PointerEvent でピンを 80×50 px 動かすと、ピンも同じ量だけ動き、逆メルカトルの期待 lnglat と 0.05° 以内で一致。
- `marker-drag-does-not-pan`: ピンのドラッグ中は地図中心が (0.5, 0.5) のまま。
- `map-pans-away-from-marker`: 余白から 30×20 px ドラッグすると中心が (-30/2048, -20/2048) 変化し、ピンも (+30, +20) px 動く。
- `wheel-zoom-keeps-point`: ズーム前後でピンのずれ < 1.5 px。

## データと帰属

- 背景の陸地: Natural Earth 110m land（パブリックドメイン）。
- ピン: 実行時に Canvas で生成。

## 実装のメモ

- 最初はポインタ位置へ先端を合わせる実装にしたため、つかんだ頭部から先端までの 32 px 分だけピンが跳び、ベンチの `dy` が 50 ではなく 18 になった。ずれを保持する形に直して 5/5 に戻した（この失敗も spec の performance_knowledge に記録）。
- ベンチは `PointerEvent` を canvas へ dispatch して、実際の listener 経路を通している。`setPointerCapture` は合成イベントでは例外になることがあるため try/catch で無視する。
