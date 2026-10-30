# tangram-008-road-filters-demo

Mapzen Tangram の公式デモ [road-filters-demo](https://github.com/tangrams/road-filters-demo) と同じ意図で、高速道路・幹線道路・州道の道路ネットワークをリアルタイムにフィルタリング・動的スタイル更新して描画したい。

- 道路種別（Interstate: 高速道路、US Highway: 連邦幹線道路、State Route: 州道）の即時トグルチェックボックスによるフィルタリング
- 道路名検索（「101」「80」「5」など）によるリアルタイムインクリメンタルフィルタリング
- Tangram らしいダークテーマと道路階層に応じたカラー（Interstate: シアン、US Highway: アンバー、State Route: スカイブルー）
- 外部 WebGL ライブラリ（Tangram JS 等）を一切使わず、ネイティブ Canvas 2D による 3 パスバッチ描画で 60fps を維持
- ドラッグによるパン、ポインター位置を中心とするホイールズーム操作に対応
