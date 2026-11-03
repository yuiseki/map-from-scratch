# REQUEST: WebGPU Instanced Scatterplot Layer

## 依頼内容
マンハッタンの 13,987 地点の散布図（deck.gl ScatterplotLayer 相当）を、WebGPU の Instanced Drawing と WGSL 解析的アンチエイリアシングを用いて高品質かつ超高速に描画したい。
重み 1（青）と重み 2（橙）の滑らかな円の描画、半径スケーリング、パン・ズーム操作を 120fps/60fps の高フレームレートで実現してほしい。

## 技術仕様
- プラットフォーム: Browser (WebGPU)
- データ形式: `deckgl-016-scatterplot-layer` のベイク済みバイナリ (Float32Array 16B/point: mercatorX, mercatorY, weight, spare)
- レンダリング方式:
  - 単位クアッドを用いた WebGPU Instanced Drawing (32B/instance)
  - WGSL フラグメントシェーダーでの解析的アンチエイリアシング（`smoothstep` による円境界とアウトラインのスムージング）
