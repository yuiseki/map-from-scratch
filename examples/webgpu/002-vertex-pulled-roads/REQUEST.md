# webgpu-002-vertex-pulled-roads

東京23区の主要幹線道路網（11,509 路線、88,354 ノード、76,845 区間）を WebGPU で描画するレンダラー。
CPU 側で一切の線幅展開・三角形分割（line tessellation）・頂点属性バッファの再生成を行わず、道路ノード列を Storage Buffer に保持したまま、Vertex Shader が `@builtin(vertex_index)` から前後ノードをプログラマブルに参照して画面空間の太線・接続（Join）・端点（Cap）を動的に生成する。

- **参照アーキテクチャ**: `pygfx`（`pygfx/renderers/wgpu/wgsl/line.wgsl`）の programmable vertex pulling 設計を検証・翻案
- **CPU tessellation 排除**: CPU は元の道路座標と最小限の属性（1 ノード 8 バイト）を 1 回 GPU に転送するのみ
- **ズーム追従**: カメラ移動・ズーム時に CPU 側の頂点再計算やバッファ再生成が完全にゼロ（`uploadCount = 1`）
- **画面空間線幅 & Miter Join**: 画面ピクセル幅に応じた法線押し出し、前後ノード参照によるマイター結合、矩形キャップを WGSL 頂点シェーダー内で直接計算
- **ゼロ頂点バッファ・ゼロインデックスバッファ**: `draw((nodeCount - 1) * 6)` の単一ドローコールのみで描画し、道路終端ノードはゼロ面積 quad としてハードウェアカリング

## 計測結果

`MFS_CHROME_FLAGS="--enable-unsafe-webgpu --use-angle=swiftshader" bin/mfs bench webgpu-002-vertex-pulled-roads` を 3 反復実行。

| 項目 | 計測値 | 予算 / 目標 | 判定 |
|---|---|---|---|
| コード配布サイズ (`code_gzip_bytes`) | 5,820 B | <= 7,000 B | 合格 |
| データ配布サイズ (`data_gzip_bytes`) | 431,494 B | <= 450,000 B | 合格 |
| 初回描画時間 (`first_frame_ms` p50) | 108.3 ms | <= 1,200 ms | 合格 |
| 再描画時間 (`redraw_ms` p95) | 0.170 ms | <= 2.0 ms | 合格 |
| フレーム間隔 (`frame_interval_ms` p95) | 16.67 ms | <= 35.0 ms | 合格 |
| 道路データロード検証 (`roads-loaded`) | 11,509 路線 / 88,354 ノード | 11,509 路線 | 合格 (3/3) |
| 静的 GPU バッファ検証 (`static-gpu-buffers`) | 移動・ズーム時の uploadCount 変化なし (1) | uploadCount == 1 | 合格 (3/3) |
| 道路描画ピクセル検証 (`roads-rendered`) | 道路通過座標での非背景色描画 | 背景色と異なる | 合格 (3/3) |
| パン追従検証 (`pan-updates-road-positions`) | パン操作に応じたピクセル座標追従 | 位置追従 | 合格 (3/3) |

## `05-tokyo-roads-native` (OpenGL ES 3.0) との比較

| 項目 | `05-tokyo-roads-native` (C11 + GLES3) | `webgpu-002-vertex-pulled-roads` (WebGPU) |
|---|---|---|
| **描画方式** | GLES3 インスタンス描画 (`glDrawArraysInstanced`) | WebGPU Vertex Pulling (`@builtin(vertex_index)`) |
| **頂点バッファ** | 始点・終点用の 2 属性インスタンスバッファ (CPU 整列) | **頂点バッファゼロ** (Storage Buffer に生ノード列をそのまま配置) |
| **接続部 (Join)** | キャップ拡張のみで誤魔化し（急カーブで重なりや隙間） | **Vertex Pulling による Miter Join 計算** (前後ノード参照) |
| **カメラ移動時の CPU 処理** | 64 バイト Uniform 転送のみ | **64 バイト Uniform 転送のみ** (頂点再計算ゼロ) |
| **再描画速度 (`redraw_ms`)** | ~1.05 ms (ネイティブ 120 万区間) | **0.075 ms p50 / 0.170 ms p95** (SwiftShader 7.6 万区間) |
| **依存関係** | X11 / EGL / GLES3 開発ヘッダー | **依存ゼロ** (ブラウザ標準 WebGPU API のみ) |

## 得られた知見

1. **Vertex Pulling による CPU ボトルネックと属性バッファの完全排除**:
   - 道路ポリラインを三角形化して頂点バッファ（Quad）として展開すると、頂点数が 4〜6 倍に膨張し、GPU バッファ帯域や CPU-GPU 転送が圧迫される。
   - WebGPU の Storage Buffer Vertex Pulling（`pygfx` 方式）を適用すると、生ノード $N$ 点をそのまま 1 つのバッファに置くだけで、Vertex Shader が `segIdx = vIdx / 6` と `quadCorner = vIdx % 6` からインデックス計算して 4 頂点を画面空間で動的押し出しできる。
   - パンやズームでカメラ行列が変わっても、CPU 側の再計算・バッファ再生成は一切発生せず（`uploadCount = 1` で不変）、毎フレーム **0.17 ms** という超高速描画を実現した。

2. **ゼロインデックスバッファと終端ノードのハードウェアカリング**:
   - 複数路線が 1 つのバッファに連続配置されている場合、路線の終端ノードから次路線の始点への誤接続を防ぐ必要がある。
   - 別途インデックスバッファやセグメント配列を用意するとデータサイズが 40% 以上増大するが、`draw((nodeCount - 1) * 6)` を発行し、路線終端ノード（`nodeA.endpoint == 2 || nodeA.roadId != nodeB.roadId`）に遭遇した頂点シェーダーが `output.position = vec4f(0.0)` を返す設計にすることで、追加バッファ一切なしでゼロ面積 quad として GPU ハードウェアカリングさせることができた。

3. **WGSL の予約語と浮動小数点ゼロ除算の罠**:
   - WGSL では `meta` が予約語（reserved keyword）であり、変数名や構造体メンバ名に使うとシェーダーモジュール作成時に静的パースエラーとなる（`let nodeMeta` 等への改名が必要）。
   - OSM データには微小・重複ノード（距離 0）が含まれることがあり、前後の接続ベクトルを `normalize()` すると `NaN` が発生し、三角形全体が消失する。`let safeLen = max(0.0001, length(delta))` で安全に除算するガードが不可欠である。
