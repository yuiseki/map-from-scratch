# REQUEST: WebGPU GPU Heatmap Layer

## 依頼内容
ニューヨークの Uber 乗車地点 10 万件を、WebGPU の Instanced Gaussian Splatting とカラーマッピングを用いて高速に描画したい。
ズームやパン、スプラット半径・強度・閾値の変更にリアルタイム（120fps/60fps）で追従する高性能なヒートマップ描画器を開発してほしい。

## 技術仕様
- プラットフォーム: Browser (WebGPU)
- データ形式: `deckgl-011-heatmap-layer` のベイク済みバイナリ (`HM01`, 10万件の重み付き地点)
- レンダリング方式:
  - Pass 1: 単位クアッドを用いたインスタンス描画で `r16float` オフスクリーンターゲットに加算ブレンド（Gaussian Splat）
  - Pass 2: フルスクリーントライアングルで密度テクスチャをバイリニアサンプリングし、カラーパレットグラデーションへマッピング
