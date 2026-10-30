# kepler-006-custom-theme: kepler.gl Custom Theme

## 依頼内容

kepler.gl の [Custom theme](https://docs.kepler.gl/examples/custom-theme) サンプルと同じ意図で、ダークテーマとライトテーマの動的切り替え（UIカラー、背景海・陸地パレット、点群カラーランプの同期変更）を外部ライブラリ（React, Redux, deck.gl, Mapbox）なしで再現したい。

## 実装方針

1. **CSS カスタムプロパティと WebGL2 uniform の連動**:
   - `body.theme-dark` と `body.theme-light` を切り替え、CSS 変数でサイドバー・ヘッダー・凡例の背景色・文字色・枠線色を即座に変更。
   - WebGL2 側は `gl.clearColor`、陸地描画色 `uColor`、フラグメントシェーダーのカラーランプモード `uThemeMode` を更新して `draw()` を呼ぶだけ。頂点再生成コストはゼロ。
2. **画面読み戻し検証**:
   - 初期ダークテーマ状態と暗い海ピクセルの検証。
   - ライトテーマ切り替え後の明色海ピクセルの検証。
   - 両テーマにおいて地震点群が視認可能であることのピクセル検証。
   - パン・ズーム性能の検証。
