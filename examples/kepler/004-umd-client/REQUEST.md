# kepler-004-umd-client: kepler.gl UMD Client

## 依頼内容

kepler.gl の [umd client](https://docs.kepler.gl/examples/umd-client) サンプルと同じ意図で、ビルドツールやバンドラーなしに単一スクリプトから任意の DOM 要素に kepler.gl 描画器を動的マウント・表示し、外部ライブラリ（React, Redux, deck.gl, Mapbox）なしで再現したい。

## 実装方針

1. **ゼロバンドラーの UMD ファクトリ**:
   - `KeplerGl.mount(target, options)` メソッドを提供。
   - 事前構築済みの静的マークアップではなく、渡されたターゲット要素内に必要な DOM 構造（サイドバー、キャンバス、凡例）を自律注入。
2. **WebGL2 パイプラインとの統合**:
   - 注入された canvas に対し WebGL2 コンテキストを立ち上げ、バイナリデータを読み込んで即座に点群を描画。
3. **画面読み戻し検証**:
   - `KeplerGl.mount` 関数の存在検証。
   - 動的 DOM 注入の確認。
   - WebGL2 キャンバスのピクセル読み戻しによる地震点描画検証。
   - パン・ズーム性能の検証。
