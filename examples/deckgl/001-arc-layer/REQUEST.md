# deckgl-001-arc-layer

deck.gl の [ArcLayer](https://deck.gl/examples/arc-layer) と同じ意図で、米国郡間（US Counties）の人口移動フロー（Migration Flows）を 3D 放物線アーク（parabolic elevation arcs）として描画したい。

- 出発地と目的地の郡セントロイド間を結ぶアークを色グラデーション（転入: シアン〜濃青、転出: 橙〜深紅）で表現する
- フロー量に応じた線幅と標高（parabolic curve）で立体感を演出する
- deck.gl や luma.gl などの外部ライブラリを一切使わず、ネイティブ Canvas 2D のベジェ曲線と線形グラデーションのみで 60fps 高速描画する
- パン・ズーム操作および郡のインタラクティブな切り替えに対応する
