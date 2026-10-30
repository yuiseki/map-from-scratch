# kepler-005-replace-component: kepler.gl Replace UI Component

## 依頼内容

kepler.gl の [Replace UI Component](https://docs.kepler.gl/examples/replace-component) サンプルと同じ意図で、内部 UI 部品（ヘッダー、追加統計パネル）をカスタム実装に動的に差し替え、地図描画器の状態を損なわずに共存させられることを、外部ライブラリ（React, Redux, deck.gl, Mapbox）なしで再現したい。

## 実装方針

1. **スロット機構によるコンポーネント差し替え**:
   - React の `injectComponents` HOC チェーンの代わりに、軽量な DOM スロット（`#header-slot`, `#extra-slot`）を定義。
   - デフォルトコンポーネント（汎用 kepler ヘッダー）とカスタムコンポーネント（企業向けヘッダー + リアルタイム地震統計パネル）を動的スイッチ。
2. **WebGL2 コンテキストの安定性保持**:
   - UI スロットの入れ替えが canvas 要素や WebGL2 リソースに影響を与えないよう、DOM 構造を分離。
3. **画面読み戻し検証**:
   - 初期デフォルトヘッダーの検証。
   - スワップ後のカスタムヘッダーおよび統計パネルの注入検証。
   - コンポーネント差し替え後も地図キャンバス上の点群描画が維持されていることのピクセル検証。
   - パン・ズーム性能の検証。
