# kepler-003-custom-reducer: kepler.gl Custom Reducer

## 依頼内容

kepler.gl の [Custom Reducer](https://docs.kepler.gl/examples/custom-reducer) サンプルと同じ意図で、外部のアクションディスパッチャーと純粋な状態レデューサーを通じて地図のフィルター値・プリセット視点・サイドバー開閉を決定論的に制御し、外部ライブラリ（React, Redux, deck.gl, Mapbox）なしで再現したい。

## 実装方針

1. **純粋関数レデューサーによる決定論的状態管理**:
   - `(state, action) => nextState` の純粋関数レデューサーを実装。
   - `SET_FILTER`（マグニチュード閾値）、`SET_VIEW`（地域プリセット）、`TOGGLE_SIDEBAR`（開閉）のアクションを定義。
2. **GPU パイプラインへの直接反映**:
   - ディスパッチ時に WebGL2 の uniform（`uMinMag`）やカメラ中心・ズームを直接更新し、CPU 側の再構築を伴わずに瞬時反映。
   - 画面上の状態インジケーターおよびアクションログストリームにディスパッチ履歴を表示。
3. **画面読み戻し検証**:
   - 初期レデューサー状態の検証。
   - `SET_FILTER` によるマグニチュード閾値と状態の同期検証。
   - `SET_VIEW` によるズーム値とプリセット名の同期検証。
   - `TOGGLE_SIDEBAR` による開閉状態の同期検証。
