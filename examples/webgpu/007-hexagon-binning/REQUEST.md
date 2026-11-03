# 大規模ポイントの WebGPU Compute リアルタイム 3D ヘクスビン集計

英国の交通事故約 14 万件（deck.gl HexagonLayer と同データ）を、WebGPU の **Compute Shader** を用いて GPU 上でリアルタイムに六角形グリッド（Hexbin）へビン集計し、3D 六角柱（Extruded Hexagons）として立体可視化する例です。

## 既存（deck.gl / WebGL2）との対比と課題

- 従来の deck.gl や WebGL2 実装（`deckgl-012-hexagon-layer`）では、集計半径（Radius）を変更するたびに **CPU 側で全ポイント（14万件）をループしてハッシュマップ等に再集計** していました（専用描画器で約 20 ms、deck.gl 本体では数百 ms のメインスレッド停止や Web Worker 往復が発生）。
- そのため、スライダー操作時にフレームレート低下（Jank）が発生し、データが数百万点に増えるとリアルタイム操作が困難になります。

## WebGPU によるアプローチ

1. **GPU Compute Shader による並列ビン集計**:
   - 全 140,029 点を GPU Storage Buffer に保持。
   - スライダーで半径を変更した瞬間、WebGPU Compute Shader が各点を並列に Hex Axial 座標へ変換（Cube Coordinates Rounding アルゴリズム）し、Storage Buffer のセルカウントに `atomicAdd` で集計。
   - 14 万点の再集計が **GPU 上で 0.5 ms 未満** で完了。メインスレッドの CPU 負荷は実質 0。
2. **GPU ネイティブな 3D 六角柱インスタンス描画**:
   - 単位六角柱（Unit Hexagon Column: 上面 6 三角形 + 側面 12 三角形）を基本メッシュとし、集計された六角形セルのカウントに応じて高さを押し出し（Extrusion）描画。
   - 上位パーセンタイル（Upper Percentile）や標高倍率（Elevation Scale）、カバレッジ（Coverage: 六角形の隙間）も GPU シェーダー内で瞬時に評価。
3. **指向性ライティング & Reversed-Z 深度**:
   - 太陽光ベクトルによる陰影付けと、`depth32float` の Reversed-Z によるチラつきのないクリアな描画。

元データは [Department for Transport の Road Safety Data](https://www.data.gov.uk/dataset/cb7ae6f0-4be6-4935-9277-47e5ce24a11f/road-accidents-safety-data)（UK Open Government Licence）で、ベイクデータは `deckgl-012-hexagon-layer` と同一の `data/baked/deckgl-012-hexagon-layer/points.bin` を読み込みます。
