# openglobus-050-point-popup: 色分けした点とポップアップ

## 依頼内容

> 世界地図上に東京・ニューヨーク・ロンドンの3つの点を色分けして表示し、クリックした点の名前をポップアップで出したい。ドラッグでパン、ホイールで拡大縮小でき、外部ライブラリなし・Canvas 2D で最速・最小に実装する。

元例: [OpenGlobus - Popup / point](https://sandbox.openglobus.org/)

## 設計の意図と判断

1. **点は「ハロー＋塗り＋白コア」の3円**
   - 画像アイコンも SVG も使わず、点ごとに色を変えた円を描くだけ。ラベルも同じパスで描くので、パン中も点とラベルがずれない。
2. **ポップアップを Canvas 内に描く**
   - DOM の吹き出しを地図に追従させると、高速パンで1フレーム遅れることがある。本実装は吹き出しも同一フレーム内に描く。
3. **半径13 px の分析的ヒットテスト**
   - 3点しかないため空間インデックスは不要。画面座標との距離だけでクリック対象を決める。
4. **カーソル基準のホイールズーム**
   - ズーム前にカーソル下の地図座標を求め、ズーム後に同じ画面位置へ戻す（`zoomAt`）。

## 計測結果

| 項目 | 値 |
| --- | --- |
| 初回描画 first_frame_ms p50 | 13.07 ms |
| 再描画 redraw_ms p95 | 1.29 ms |
| フレーム間隔 frame_interval_ms p95 | 6.60 ms |
| コード gzip | 3,203 B |
| データ gzip | 30,600 B |
| 検証チェック | 8 / 8 PASS |

## 検証チェック

- `tokyo-point-visible` / `new-york-point-visible` / `london-point-visible`: 点中心から4 px 右のピクセル色で、水色・橙・紫の点が描かれていることを確認（白コアを避ける）。
- `click-tokyo-shows-popup` / `click-new-york-shows-popup` / `click-london-shows-popup`: 各点のクリックで "Tokyo, Japan" / "New York, USA" / "London, UK" が出る。
- `popup-painted-in-canvas`: 吹き出し本体が白で Canvas に描かれている（DOM 不使用）。
- `wheel-zoom-keeps-point`: ズーム前後でカーソル下の点のずれ < 1.5 px。

## 補足

- 最初の計測では吹き出しの確認点が文字の上に当たり `rgba(44,44,44,255)` で FAIL した。吹き出し上端寄り（文字の上）に読み取り位置を移して再計測し、8/8 PASS とした。
