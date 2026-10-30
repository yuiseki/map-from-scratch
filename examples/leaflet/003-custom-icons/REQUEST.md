# leaflet-003-custom-icons: Canvas で描くカスタムアイコンとポップアップ

## 依頼内容

> ロンドン周辺の3地点に、画像ファイルを使わず Canvas で描いたカスタムアイコン（ピン・四角・丸）を置き、それぞれクリックで固有のポップアップを表示したい。外部ライブラリは使わず軽量に。

元例: [Leaflet - Markers with Custom Icons](https://leafletjs.com/examples/custom-icons/)

## 設計の意図と判断

1. **アイコンは画像ではなく Canvas のパス**
   - 元例は `L.Icon` に PNG/SVG を渡すが、本実装はピン（ベジェ曲線＋円弧）、角丸四角、円をその場で描く。画像リクエスト・デコード・アイコン用 CSS がすべてゼロになり、DPR が変わっても輪郭が滲まない。
2. **ポップアップも Canvas 内に描画**
   - Leaflet は DOM ポップアップを `transform` で追従させるため、高速パン時に再配置が1フレーム遅れることがある。本実装は吹き出しも同一フレーム内で描くので、パン・ズームと完全同期する。
3. **押下位置基準のクリック判定**
   - ドラッグ判定は移動イベントごとではなく `pointerdown` からの総移動距離（3 px）で行う。手ブレ程度の 2 px はクリックとして扱い、パンにはしない。
4. **カーソル基準のホイールズーム**
   - ズーム前にカーソル下の地図座標を求め、ズーム後にその点が同じ画面位置に来るよう中心を補正する（`zoomAtPoint`）。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 8.74 ms |
| 再描画 redraw_ms p95 | 0.62 ms |
| フレーム間隔 frame_interval_ms p95 | 5.06 ms |
| コード gzip | 3,533 B |
| データ gzip | 30,400 B |
| 検証チェック | 10 / 10 PASS |

## 検証チェック

- `pin-icon-visible` / `square-icon-visible` / `circle-icon-visible`: 各アイコンの塗り色を画面ピクセルで確認。
- `click-pin-shows-popup` / `click-square-shows-popup` / `click-circle-shows-popup`: 各アイコンのクリックで固有のポップアップ文字列。
- `popup-painted-in-canvas`: 吹き出し本体が白で Canvas に描かれていること（DOM 不使用）。
- `click-empty-shows-coordinates`: アイコンのない場所のクリックで緯度経度ポップアップ。
- `click-tolerance-2px`: pointerdown から 2 px の手ブレでもピンのクリックになること。
- `wheel-zoom-keeps-point`: ズーム前後でカーソル下の点のずれ < 1.5 px。
