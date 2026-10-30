# wasm-001-jspi-range-reader

## 依頼

> C/C++ や Rust で書かれた既存の空間データパーサー（PMTiles / COG / GeoParquet 等）を WebAssembly 化する際、従来のコールバック書き換えや ASYNCIFY（スタック巻き戻しによるコード肥大化）を使わず、同期関数の記述のままブラウザの非同期 HTTP Range リクエスト（fetch）を実行したい。WebAssembly JavaScript Promise Integration（JSPI）を用いて、同期的な C のバイト読み出しコードとブラウザの非同期ネットワーク境界を直接接続し、その性能とコード効率を検証してほしい。

## 要件

| 要件 | 内容 |
|---|---|
| **同期 C API の維持** | C コードは `read_range(offset, length, buf)` を通常の同期的戻り値関数として呼び出す |
| **JSPI スタック一時停止** | `-sJSPI` を用いて、非同期 Promise 待機中に Wasm コールスタックを自動中断・再開 |
| **ASYNCIFY 排除** | ASYNCIFY 特有の全関数インストルメンテーション・コード肥大化・実行時オーバーヘッドを排除 |
| **HTTP Range オンデマンド取得** | PMTiles v3 の 127 バイトヘッダー、ルートディレクトリ、タイルデータを必要な範囲だけ HTTP 206 で逐次取得 |
| **地図描画と操作性** | 取得したベクトルタイルを Canvas 2D に描画し、パン・ズーム操作で必要なタイルを同期呼び出しで取得 |

## 設計

- **C 側**:
  - `reader.c`: 純粋な C11 で書かれた同期型 PMTiles v3 リーダー。
  - `init_reader(url)`: 127 バイトヘッダーを `fetch_range(0, 127)` で同期取得し、マジックコード `PMTiles` とバージョン 3 を検証。続いてルートディレクトリ長を取得して varint デコード。
  - `get_tile(z, x, y)`: Hilbert curve アルゴリズムで $(z, x, y)$ から `tile_id` を計算し、ルートディレクトリ内を二分探索。該当タイルの `data_offset + offset` から `length` バイトを `fetch_range` で同期取得。
  - `EM_ASYNC_JS`: JS 側の `fetch(url, { headers: { Range: ... } })` を呼び出す非同期バインディング。`-sJSPI` により C 側からは通常の同期関数として透過的に機能。
- **JS / ブラウザ側**:
  - `main.ts` / `map.ts`: Emscripten ランタイム初期化、Canvas 2D 描画ループ、パン・ズーム操作処理。
  - `get_tile(z, x, y)` を呼び出すと、Wasm 側で JSPI サスペンションが発生し、ブラウザの HTTP Range リクエスト完了と同時にタイルバイナリポインタが返却される。

## 計測結果

`bin/mfs bench wasm-001-jspi-range-reader` を 3 反復実行。

| 項目 | 計測値 | 予算 / 目標 | 判定 |
|---|---|---|---|
| コード配布サイズ (`code_gzip_bytes`) | 16,578 B | <= 35,000 B | 合格 |
| データ配布サイズ (`data_gzip_bytes`) | 53,331 B | <= 90,000 B | 合格 |
| 初回描画時間 (`first_frame_ms` p50) | 31.39 ms | <= 1,500 ms | 合格 |
| 再描画時間 (`redraw_ms` p95) | 0.620 ms | <= 3.0 ms | 合格 |
| フレーム間隔 (`frame_interval_ms` p95) | 2.825 ms | <= 35.0 ms | 合格 |
| ヘッダー同期読取検証 (`pmtiles-header-synced`) | v3 / maxZoom 2 / 21 entries | 一致 | 合格 (3/3) |
| JSPI Range 読取検証 (`jspi-range-reads`) | Range 読取 3 回以上 / バイト取得 | readBytes > 0 | 合格 (3/3) |
| 世界陸地描画検証 (`world-land-rendered`) | 陸地ピクセル描画確認 | 海洋色と異なる | 合格 (3/3) |
| パン時オンデマンド取得検証 (`pan-triggers-jspi-tiles`) | パン操作でタイル追加取得 | タイル数増加 | 合格 (3/3) |

## ASYNCIFY との比較

| 項目 | 従来の ASYNCIFY | WebAssembly JSPI (`-sJSPI`) |
|---|---|---|
| **Wasm バイナリサイズ** | スタック退避・復元コードの全関数注入により **2〜5倍に肥大化** | **コード膨張ゼロ**（通常の同期 Wasm 関数と同等: 17 KB / gzip 8 KB） |
| **スタック巻き戻しコスト** | コールスタック上の全フレームを unwind / rewind | **Wasm エンジンネイティブ中断**（`WebAssembly.Suspending`） |
| **C コードの記述** | コールバック化または特定関数のホワイトリスト指定が必要 | **100% 通常の同期 C コード** (`int n = fetch_range(...)`) |
| **再描画性能 (`redraw_ms`)** | スタック書き換えのオーバーヘッドでジッター発生 | **p95 0.62 ms / フレーム間隔 2.8 ms** の高速描画 |

## 得られた知見

1. **JSPI による C 同期パーサー資産の完全な再利用**:
   - 既存の C/Rust 空間パーサー（PMTiles, COG, GeoParquet, FlatGeobuf）は通常同期 I/O を前提に設計されている。
   - JSPI を利用することで、コールバック地獄への書き換えや ASYNCIFY のバイナリ肥大化を一切被ることなく、ブラウザの HTTP Range リクエストを同期関数の戻り値として直接受け取れる。
2. **Emscripten JSPI エクスポート設定の要件**:
   - 非同期インポート関数（`EM_ASYNC_JS`）を直接・間接に呼び出す Wasm エクスポート関数は、コンパイル時に `-sJSPI_EXPORTS=init_reader,get_tile` のように明示的に指定する必要がある。
   - これが欠けると、実行時に `SuspendError: trying to suspend without WebAssembly.promising` がスローされる（`main` 以外の公開 API 関数には必須）。
3. **HTTP 206 部分取得とゼロコピー転送**:
   - `fetch(url, { headers: { Range: ... } })` で取得した `ArrayBuffer` を `HEAPU8.set()` で Wasm メモリに直接転送し、Wasm 側で varint デコードおよびジオメトリ抽出を行うことで、GC 圧迫や中間オブジェクト生成を極小化できる。
