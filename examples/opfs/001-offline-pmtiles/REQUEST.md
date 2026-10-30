# opfs-001-offline-pmtiles

ブラウザの Origin Private File System（OPFS）に PMTiles アーカイブを配置し、Dedicated Web Worker 内で `FileSystemSyncAccessHandle.read()` を使って同期 Range 読み出し（Synchronous Byte Range Read）を行う完全オフライン地図描画器。

- 初回アクセス時にアーカイブを OPFS 仮想ファイルシステムへ書き込み、以降は一切のネットワーク通信（HTTP Range リクエスト）を発生させずに完全オフライン動作
- Web Worker 専用の `createSyncAccessHandle()` を活用し、イベントループや非同期 Promise のオーバーヘッドなしにマイクロ秒（< 0.1 ms）単位で同期バイトアクセス
- PMTiles v3 仕様（127 バイトヘッダー、Hilbert 空間充填曲線 tileId 索引、ディレクトリ可変長 varint デコード）を自前実装
- パン・ズーム操作に応じて必要なタイルを OPFS 同期 I/O で即時取得し、Canvas 2D 上にシームレス描画

## 計測結果

`bin/mfs bench opfs-001-offline-pmtiles` を 3 反復実行。

| 項目 | 計測値 | 予算 / 目標 | 判定 |
|---|---|---|---|
| コード配布サイズ (`code_gzip_bytes`) | 5,629 B | <= 6,000 B | 合格 |
| データ配布サイズ (`data_gzip_bytes`) | 53,330 B | <= 90,000 B | 合格 |
| 初回描画時間 (`first_frame_ms` p50) | 19.29 ms | <= 300 ms | 合格 |
| 再描画時間 (`redraw_ms` p95) | 0.34 ms | <= 2.0 ms | 合格 |
| フレーム間隔 (`frame_interval_ms` p95) | 2.055 ms | <= 20.0 ms | 合格 |
| OPFS 格納検証 (`opfs-stored`) | 63,681 bytes | > 60,000 bytes | 合格 (3/3) |
| 同期アクセス検証 (`sync-access-reads`) | 同期 read 実行 / 52 µs | 平均遅延 < 1.0 ms | 合格 (3/3) |
| 画面タイル描画検証 (`tiles-rendered`) | 陸地ピクセル色確認 | 海洋色と異なる | 合格 (3/3) |
| パン時 OPFS 追従検証 (`pan-triggers-opfs-reads`) | OPFS 同期取得 / 通信 0 | ネットワーク 0 | 合格 (3/3) |

## 得られた知見

1. **OPFS 同期 I/O（`FileSystemSyncAccessHandle`）の圧倒的性能**:
   - HTTP Range リクエストでは通常 20〜100 ms かかる PMTiles の任意バイトオフセット読み出しが、OPFS の同期ハンドルにより **約 50 µs（0.05 ms）** で完了。
   - 非同期 Promise のマイクロタスクキューやイベントループの介入がないため、ジッターや UI スタックが完全にゼロ。
2. **完全オフラインブラウザ地図の成立**:
   - 一度 OPFS に書き込まれた PMTiles アーカイブは、機内モードや完全オフライン環境でも瞬時に読み出せる。
   - 外部ライブラリを一切使わず、わずか 5.6 KB のコードで PMTiles v3 の Hilbert 索引引き・varint ディレクトリ・ポリゴン描画まで完結可能であることを実証した。
