# マンハッタンのタクシー軌跡を WebGPU でアニメーション再生する

マンハッタンを疾走するイエローキャブとグリーンキャブの移動軌跡（NYC Taxi and Limousine Commission）を、OpenStreetMap の 3D 建築物の間を縫う光るトレイルとして WebGPU でリアルタイム再生する例です。

## 既存（deck.gl / WebGL2）との対比と設計

- 既存の `deckgl-025-trips-layer` と同一のベイクデータ（`trips.bin` と `buildings.bin`）を使用します。
- WebGPU では **Vertex Pulling** または **Instanced Segment** を採用し、全セグメントの頂点・時刻・ベンダー属性を Storage Buffer / Vertex Buffer に保持。
- 毎フレームの描画では、頂点シェーダー・フラグメントシェーダー内で現在時刻 `currentTime` と軌跡長 `trailLength` に応じた光のフェード（先頭が高輝度、後方が徐々に減衰）を直接評価。GPU バッファの再送は一切行わず、Uniform バッファの時刻更新のみで 60 fps で滑らかに再生します。
- マンハッタンの 3D 建物（996棟）は、壁・屋根の陰影と深度バッファ（Reversed-Z `depth32float`）により正確に遮蔽され、タクシーがビルの谷間を縫って走るドラマチックな夜景を表現します。

元データは NYC Taxi and Limousine Commission（タクシー）および OpenStreetMap / Mapzen（建物）です。
ベイクデータは `deckgl-025-trips-layer` と同一の `data/baked/deckgl-025-trips-layer/trips.bin` および `buildings.bin` を読み込みます。
