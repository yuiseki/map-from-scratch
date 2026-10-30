# kepler-001-demo-app: kepler.gl Demo App (California Earthquakes)

## 依頼内容

kepler.gl の [Demo App](https://docs.kepler.gl/examples/demo-app) と同じ意図で、5.5万件の地震データ（USGS）を、kepler.gl の特徴的なダークテーマ UI（開閉サイドバー、レイヤータブ、マグニチュード色ランプ、凡例、3Dチルト）と WebGL2 高速ポイント描画で再現したい。外部ライブラリ（React, Redux, deck.gl, Mapbox）なしで。

## 実装方針

1. **外部依存ゼロの超軽量アーキテクチャ**:
   - 本家 kepler.gl は React, Redux, deck.gl, luma.gl, Mapbox GL JS などの巨大なスタックで構成され、バンドルサイズは数 MB に達します。
   - 本描画器はピュアな TypeScript と WebGL2、HTML/CSS のみで構成し、コード gzip サイズは 12 KB 未満に収めます。
2. **ベイク時最適化**:
   - USGS 54,936 件の地震座標を Mercator `[0, 1]` に事前投影。
   - 座標でソートすることにより、gzip 圧縮時のエントロピーを下げて 630 KB 程度に圧縮。
   - Natural Earth 110m 陸地境界ポリゴンをベイク時に `earcut` で事前三角形分割し、ランタイムでのポリゴン分割コストをゼロにします。
3. **GPU ドリブン描画 & フィルタリング**:
   - 全点群を単一の VBO に格納し、`gl.drawArrays(gl.POINTS, ...)` の 1 コールで描画。
   - 頂点シェーダー内でマグニチュードの最小閾値フィルタリングを処理し、スライダー操作時も CPU 再バッファリングなしで 60 fps で瞬時更新。
   - フラグメントシェーダーで円形アンチエイリアス処理と kepler.gl の Magma/PRGn 風カラーランプ評価を実施。
4. **画面読み戻し検証**:
   - DOM 要素（サイドバー、レイヤーカード、凡例、トグルボタン）の存在検証。
   - カリフォルニア断層帯付近のピクセル読み戻しによる地震点描画検証。
   - サイドバーの開閉およびレイヤー非表示トグル時の画面ピクセル変化検証。
