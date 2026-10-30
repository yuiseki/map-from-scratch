# kepler-008-custom-map-style: kepler.gl Custom Map Style

## 依頼内容

kepler.gl の [Custom map style](https://github.com/keplergl/kepler.gl/tree/14c35fc048a745faab0c6770cab7a4625ccedda3/examples/custom-map-style/README.md) サンプルと同じ意図で、外部のカスタム地図スタイル（Dark / Light / Satellite / Muted 等のベースマップパレットおよびレイヤーグループ設定）を切り替え可能な kepler.gl UI と WebGL2 地震データ可視化描画器を、外部ライブラリ（React, Redux, deck.gl, Mapbox）なしで再現したい。

## 実装方針

1. **カスタムマップスタイル切り替え UI**:
   - kepler.gl のサイドバー「Base map」設定パネルを忠実に再現。
   - スタイル選択カード（Dark, Light, Muted Navy, Desert Gold）を並べ、クリックでベースマップの配色・陸地ポリゴン色・海色・境界線スタイルを動的に即座に切り替え。
   - レヤーグループ（陸地 Land, 境界線 Borders, 地震データ Earthquakes）の表示/非表示トグルを実装。
2. **WebGL2 パイプライン**:
   - 陸地ポリゴン（Natural Earth 110m land: 事前三角形分割済み）と境界線（事前ライン展開済み）、および地震データ 54,936 点を GPU バッファに保持。
   - スタイル切り替え時は GPU uniform（海色、陸地色、境界色、カラーランプ mode、レイヤー表示フラグ）のみを更新し、頂点再生成なし・0ms オーダーで即座に再描画。
3. **画面読み戻し検証**:
   - サイドバー「Base map」パネルおよびスタイルカード DOM の存在検証。
   - 初期 Dark スタイルから Light スタイルへの切り替えによる画面ピクセル明度変化の検証。
   - 境界線・陸地レイヤートグル時のピクセル変化検証。
   - 地震点群ピクセル読み戻し検証。
