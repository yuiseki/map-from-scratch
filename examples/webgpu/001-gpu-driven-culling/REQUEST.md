# webgpu-001-gpu-driven-culling

PLATEAU 東京都心（東京駅周辺 2km 四方）の 3,992 棟の 3D 建築物モデルに対し、WebGPU の Compute Shader による視錐台カリング（Frustum Culling）とインダイレクト描画（`drawIndexedIndirect`）を適用した GPU-driven レンダラー。

- CPU 側から地物ごとの描画判定ループおよび個別の draw call 発行を完全に排除
- Compute Shader が 6 つの視錐台平面（Frustum Planes）と全建物の境界球判定を GPU 上で並列実行
- 生き残った建物数を `atomicAdd` で `indirectBuffer.instanceCount` に直接書き込み、インスタンス ID 配列を記録
- Render Pass は CPU から単一の `drawIndexedIndirect()` を発行するのみで完結
- 視点回転（Orbit）、パン、ズーム操作時に GPU 上で動的にカリング数が更新される様子を可視化

## 計測結果

`MFS_CHROME_FLAGS="--enable-unsafe-webgpu --use-angle=swiftshader" bin/mfs bench webgpu-001-gpu-driven-culling` を 3 反復実行。

| 項目 | 計測値 | 予算 / 目標 | 判定 |
|---|---|---|---|
| コード配布サイズ (`code_gzip_bytes`) | 6,823 B | <= 7,000 B | 合格 |
| データ配布サイズ (`data_gzip_bytes`) | 27,958 B | <= 45,000 B | 合格 |
| 初回描画時間 (`first_frame_ms` p50) | 12.98 ms | <= 1,200 ms | 合格 |
| 再描画時間 (`redraw_ms` p95) | 0.235 ms | <= 3.0 ms | 合格 |
| フレーム間隔 (`frame_interval_ms` p95) | 16.67 ms | <= 35.0 ms | 合格 |
| 建物ロード検証 (`buildings-loaded`) | 3,992 棟 | 3,992 棟 | 合格 (3/3) |
| 高さの出どころ (`heights-from-plateau`) | 最高 234.8 m（16 の最高層ビルから 17 m） | 16 の最高層ビル | 合格 |
| GPU カリング検証 (`gpu-compute-culling`) | 視錐台内 1,732 棟 (43.4%) | 0 < N < 3,992 | 合格 (3/3) |
| 建物描画ピクセル検証 (`buildings-rendered`) | RGBA 色差確認 | 背景色と異なる | 合格 (3/3) |
| カメラ周回更新検証 (`camera-orbit-updates-count`) | 回転前後で生存数変化 | count 更新 | 合格 (3/3) |

## 得られた知見

1. **GPU-Driven による CPU ボトルネックの完全排除**:
   - 3,992 棟の 3D 建築物の視錐台カリング計算とインスタンス集約がすべて WGSL Compute Shader で完結し、描画パスは 1 つの `drawIndexedIndirect` を発行するだけ。
   - 再描画時間（`redraw_ms`）は p95 で **0.235 ms**（1フレーム 16.7 ms のわずか 1.4%）という驚異的な処理速度を達成。
2. **WGSL バッファアクセスの厳格な分離**:
   - WebGPU 仕様において、Vertex Shader は `read_write`（`storage`）バッファをバインドできず、`read-only-storage` のみが許可される。
   - カリング結果（`culledIndices`）の書き込み（Compute）と参照（Vertex）で Bind Group Layout を適切に分離することで、堅牢な GPU-driven パイプラインをゼロ依存で構築できることを実証した。
3. **高さは配信アーカイブのメッシュから測る**:
   - 16 の truth.json は各建物の footprint 上の点と footprint 面積だけを持ち、高さを持たない。高さは 16 の .plb の建物メッシュをその点で鉛直に貫いて測り、一辺は面積の平方根にした。
   - 1 棟を 0.1 m 単位の 16 bit 整数 4 つ（8 bytes）で送り、GPU 用の 32 bytes 構造体はページで組み立てる。データは 27,958 B に収まる。
