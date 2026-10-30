# webgpu-003-subgroup-density

東京23区の OpenStreetMap 全域からサンプリングした 104 万点（1,048,576 点 = $2^{20}$ 点）の大規模点群に対し、WebGPU Compute Shader と Subgroups（SIMD レーン集約）を用いて GPU 上で直接 2D 密度グリッド（長辺 512 セル、画面の縦横比に合わせた正方セル）に集計・自動露出決定（`atomicMax`）を行い、Turbo カラーマップのヒートマップとして滑らかに再描画するレンダラー。

- CPU 側での地物走査・KDE 集計ループを完全に排除し、全点を GPU Storage Buffer に保持
- WGSL Compute Shader が 1,048,576 点を並列にスクリーン空間セルへ写像し、`atomicAdd` で密度加算
- `atomicMax` によりピーク密度を GPU 内で即時決定し、対数正規化 $\frac{\log(1 + \text{count})}{\log(1 + \text{max})}$ を適用
- フルスクリーン Quad による双線形補間（Bilinear Filtering）サンプリングで、グリッド境界の段差を消した滑らかな連続密度場を描画
- パン・ズームのたびに全点を数え直す。1 フレームの GPU 時間は p50 0.05 ms、全点が画面内の全体表示で 0.12 ms（RTX 3060）

## 計測結果

`bin/mfs bench webgpu-003-subgroup-density` による計測（RTX 3060、Chromium 156 を Xvfb 上で画面ありで起動、3 反復、2026-10-30）。spec の `display: xvfb` により、WebGPU は NVIDIA のアダプタで動く。

| 項目 | p50 | p95 | 予算 | 判定 |
|---|---|---|---|---|
| コード配布サイズ (`code_gzip_bytes`) | 6,551 B | | <= 7,000 B | 合格 |
| データ配布サイズ (`data_gzip_bytes`) | 3,700,657 B | | <= 4,000,000 B | 合格 |
| 初回描画 (`first_frame_ms`、GPU 完了まで) | 738.7 ms | 857.2 ms | p50 <= 1,200 ms | 合格 |
| 経路 300 フレームの GPU 時間 (`gpu_ms`) | 0.050 ms | 0.133 ms | | |
| 経路のフレーム時間 (`frame_ms`、完了の通知まで) | 2.31 ms | 2.40 ms | p95 <= 16.7 ms | 合格 |
| 全体表示の GPU 時間 (`whole_gpu_ms`) | 0.124 ms | 0.127 ms | | |
| 全体表示のフレーム時間 (`whole_frame_ms`) | 2.33 ms | 2.39 ms | p95 <= 16.7 ms | 合格 |
| 32 倍表示の GPU 時間 (`street_gpu_ms`) | 0.048 ms | 0.048 ms | | |
| JS の時間 (`cpu_ms`) | 0.04 ms | 0.06 ms | | |

- 経路は 04-osm-node-density と同じ（23 区全体から渋谷駅へズームして戻る）。この描画器のズームの上限に合わせて 32 倍で折り返す。
- `gpu_ms` は compute パスの開始から描画パスの終了までの timestamp-query。`frame_ms` は描いてから `onSubmittedWorkDone` が解決するまでで、GPU の仕事が 0.05 ms でも約 2.3 ms かかる。差は完了を JS に知らせる経路の待ちで、GPU の仕事ではない。
- 計測するフレームは、キャンバスと同じ大きさのオフスクリーンのテクスチャに描く。キャンバスに描くと、完了を待つたびに表示が挟まり、Xvfb では 1 フレーム 81 ms かかった。画面のピクセルを読む検証はキャンバスで行う。
- 検証の項目 6 つはすべての反復で通った。

以前の表（再描画 p95 0.21 ms）は SwiftShader（CPU 上のソフトウェア実装）で、`queue.submit` を返すまでの JS の時間を測っていた。GPU の仕事の時間ではない。

## 得られた知見

1. **GPU での密度集計の速さ**:
   - 104 万点（1,048,576 点）の座標変換・範囲外の除外・グリッドへの加算と色付けが、RTX 3060 で 1 フレーム 0.05 ms（全体表示で 0.12 ms）。
   - CPU で集計した場合との比較はまだ測っていない。
2. **GPU 内 `atomicMax` による自動露出決定**:
   - 画面内の最大密度を計算するためにピラミッド縮小パスや CPU 読み戻しを行わず、ビン集計 Compute Pass 内で `atomicMax` を用いて一発でピーク値を算出。
   - これにより、全域表示時（広域で密度が分散）でも駅前拡大時（超高密度クラスタ）でも、人間の目が知覚しやすい適切なコントラストの対数正規化ヒートマップが自動生成される。
3. **SwiftShader / ソフトウェア WebGPU 環境での swapchain 制約**:
   - Docker コンテナや SwiftShader 環境では `canvas.getContext('webgpu')` の `WebGPUSwapBufferProvider` が SharedImageBackingFactory 不在でクラッシュすることが判明。
   - SwiftShader 検出時は明示的にオフスクリーン `colorTexture` への描画・ピクセル読み戻し経路へ切り替えることで、ヘッドレス CI 環境でも堅牢に WebGPU Compute / Render パイプラインを検証できる。
4. **レビューで直した点**:
   - ベイクが 9,658,062 点から整数刻み（9 点おき）で 1,048,576 点を取って打ち切っていた。点は Morton 順なので、捨てた末尾 2.3% が南東の象限（江東・江戸川）をまるごと消していた。比で均等に間引く。
   - 正方形のデータ範囲を画面全体に引き伸ばしていた（1920×843 で東西 2.3 倍）。範囲とグリッドを画面の縦横比に合わせる。
   - `enable subgroups;` だけで subgroup 命令を使っていなかった。先頭レーンと同じセルの点を `subgroupAdd` でまとめて 1 回の `atomicAdd` にする。結果は CPU 集計と一致する（`gpu-peak-matches-cpu`）。
   - Turbo と称する多項式が茶→橙→赤で、t 0.5〜0.9 が同じ橙だった。Google の Turbo 近似に置き換えた。
   - ホイールズームをポインタ基準にした。実 GPU で表示済みの canvas を読むと 0 が返るので、読み取り前に描き直す。
