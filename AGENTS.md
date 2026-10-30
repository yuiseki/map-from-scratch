# AGENTS.md

`map-from-scratch` は、「X をしたいから地図を作って」という個別の依頼ごとに、その目的だけを満たす最小・最速の地図描画器をほぼゼロから作り、計測で証明するためのリポジトリです。

作業を始める前に、メイン手順である [`.agents/skills/map-from-scratch/SKILL.md`](.agents/skills/map-from-scratch/SKILL.md) と、該当するサブ問題のスキル（`.agents/skills/<topic>/SKILL.md`）を必ず読んでください。

---

## 1. 基本原則（絶対ルール）

1. **1依頼・1描画器（One request, one renderer）**
   - 既存の例を拡張して汎用エンジンや共通ライブラリに育ててはいけません。
   - 新しい依頼には、最も近い既存の `examples/<nn>-<slug>/` をコピーして不要な部分を削るところから始めます。
2. **実行時の外部依存ゼロ**
   - 描画器（`examples/`）が実行時に使ってよい外部コードは、ポリゴン三角形分割用の `vendor/earcut`（および例22で版固定された Draco デコーダー等の明示された例外）のみです。
   - Canvas 2D、WebGL2、WebGPU、EGL/GLES3、X11、libc などのプラットフォーム標準 API を直接使います。
   - 汎用地図エンジン（MapLibre など）は比較計測用の `baselines/` 配下にのみ置きます。
3. **ランタイムではなくベイク時に仕事をする**
   - 座標投影、簡略化、三角形分割、描画順ソート、量子化、空間インデックス作成、圧縮などは極力 `bake.ts` で事前に行い、描画器がそのまま GPU / 画面へ流せるデータ構造を設計します。
   - HTTP Range リクエストで読む場合は、最初の数リクエストで必要なビューのデータが揃うようにインデックスとブロック配置（Hilbert / Morton 順や時間順、カラムナ配置など）を設計します。
4. **要件の数値予算化と画面読み戻し検証**
   - 各例は [`spec.yaml`](.agents/skills/map-from-scratch/references/spec-yaml.md) の7節（`requirements`, `evaluation`, `benchmarks`, `datasets`, `performance_knowledge`, `architecture_selection`, `verification`）で定義します。
   - すべての `requirements` は `evaluation.budgets` の数値目標に紐づけるか、`unmeasured` の理由を明記します。
   - `verification.checks` では中間バッファではなく**実際に画面に描かれたピクセル**を読み戻して検証し、各反復で `{"check": id, "pass": bool, "detail": ...}` を出力します。
5. **先行エンジンの知見（スキル & `ref-repos/`）の活用とライセンス遵守**
   - 実装前に `.agents/skills/` の該当トピックと `ref-repos/`（`ref-repos/clone.sh` で取得する130個以上の地図エンジン・空間ツール）の実装を調査し、採用・却下した理由を `spec.yaml` の `performance_knowledge` や `architecture_selection`、コードコメントに記録します。
   - 本リポジトリは **GPL-3.0-or-later** です。GPL-3 / GPL-2.0-or-later / LGPL / 寛容ライセンスのコードは出典ファイルをコメントに明記して翻案できますが、**GPL-2.0-only（GeoServer、Navit の一部など）のコードは読むだけとし、コピー・翻案してはいけません**。

---

## 2. ディレクトリ構成

- `bin/mfs` : Docker コンテナ内でハーネスを実行するラッパースクリプト。
- `harness/` : 依存ゼロの TypeScript 製 CLI (`cli.ts`)、ブラウザ計測ランナー（自作 CDP クライアント `runners/browser.ts`）、ネイティブ計測ランナー (`runners/native.ts`, `native/mfs-exec.c`)、ブラウザ側計測ヘルパ (`page/bench.ts`)。
- `examples/<nn>-<slug>/` : 各依頼に対する描画器（`spec.yaml`, `REQUEST.md`, `bake.ts`, `index.html`, `main.ts`, `bench.ts`、ネイティブの場合は C ソース等）。
- `baselines/` : 汎用エンジンとの比較用ベースライン（例: `b02-maplibre`）。
- `tools/` : ベイク時・サイト構築時の共通ツール（`sources.ts`, `geo.ts`, `pmtiles.ts`, `build-site.ts`, `deploy-pages.sh`）。
- `kits/` : 描画器にコピーして使える最小限の自前リーダー・デコーダー（`kits/geoparquet/` の Thrift / Zstd など）とその単体テスト。
- `tests/` : 個別の例に対する追加テスト。
- `vendor/earcut/` : ベンダー同梱された earcut。
- `.agents/skills/`（`.claude/skills`, `skills/map-from-scratch` からリンク）:
  - `map-from-scratch/` : 全体の手順 (`SKILL.md`)、`spec.yaml` 仕様 (`references/spec-yaml.md`)、設計パターン (`references/patterns.md`)、計測の落とし穴 (`references/pitfalls.md`)。
  - 28個の技術トピックスキル（`line-tessellation`, `polygon-triangulation`, `label-placement`, `text-rendering`, `float-precision`, `data-range-requests`, `plateau-3d-tiles` など）とデータカタログ (`yuiseki-open-data`)。
- `data/` / `results/` : ベイク生成データおよび計測結果の出力先（Git 管理外）。

---

## 3. コマンドリファレンス

すべてのビルド・データ準備・テスト・計測は Docker コンテナ経由の `bin/mfs`（または Node 24 + tsc 環境）で実行します。

```sh
bin/mfs image                   # ベース Docker イメージ (mfs-base:latest) のビルド
bin/mfs list                    # 全 example / baseline と依頼内容の一覧
bin/mfs test                    # ハーネス・tools・kits の単体テストと tsc 型検査 (node / web)
bin/mfs bake <id|all>           # spec.yaml の datasets.bake に従いデータを生成
bin/mfs build <id|all>          # ネイティブ等のビルドを実行
bin/mfs bench <id|all> [-n N]   # 計測と予算・検証チェックの合否判定 (結果は results/<id>/)
bin/mfs bench <id> --site       # GitHub Pages 用ビルド済みサイト (.cache/site) に対する計測
bin/mfs report                  # results/<id>/latest.json から Markdown の結果表を出力
bin/mfs serve [port]            # 開発用ローカルサーバ起動 (デフォルト 8080, TS 型ストリップ対応)
bin/mfs probe [lifetime]        # コンテナ内の GPU / WebGL コンテキスト生存確認
tools/deploy-pages.sh           # サイト構築・全ページ検証・gh-pages へのデプロイ
```

### 主な環境変数（`bin/mfs`）
- `MFS_SOURCES` : 原データのホスト側マウントディレクトリ（デフォルト: `/sata_hdd_24tb`）
- `MFS_PAGE_QUERY` : ベンチマーク時にページ URL に追加するクエリ文字列（パラメータスイープ用）
- `MFS_CHROME_FLAGS` : Headless Chromium に渡す追加フラグ
- `MFS_MEMORY` / `MFS_CPUS` : コンテナのメモリ上限（デフォルト `8g`）・CPU 枠（デフォルト `8`）

---

## 4. コーディング規約・技術的制約

### TypeScript（Node / Browser 共通）
- `tsconfig.node.json` と `tsconfig.web.json` の両方で `strict: true`, `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true` が有効です。
- Node 24 が直接実行し、ブラウザ配信時は静的サーバ (`harness/lib/strip.ts`) が型注釈だけを空白置換で剥がして配信するため、**ランタイム構文を伴う TypeScript 独自機能（`enum`, `namespace`, パラメータプロパティ等）は使用禁止**です。
- 相対インポートには必ず `.ts` 拡張子を付け、型のみのインポートには `import type` を使います。

### ブラウザ描画器とベンチマークの分離
- `index.html` から読む `main.ts` は、URL に `?bench` があるときだけ動的 `import('./bench.ts')` を実行するようにし、通常利用時の配布コードサイズ（`code_gzip_bytes`）にベンチマーク用コードが含まれないようにします。
- `architecture_selection.chosen.code` には、ユーザーが実際にダウンロードするファイル（`index.html`, `main.ts` など）だけを列挙します。
- ハーネスへのメトリクス・検証結果の送信は `window.__mfsEmit`（ネイティブでは標準出力の `@mfs {...}` 行）で行います。

### GitHub Pages 公開の制約
- ブラウザ例は静的な相対パスだけで動作する必要があります（GitHub Pages 上では COOP/COEP ヘッダが付かないため、`SharedArrayBuffer` 等に無条件依存しないこと）。
- GitHub Pages に載せる各データファイルは **100 MB 未満**に収めます。再配布不可のデータや 100 MB を超えるローカルデータを参照する例は、`spec.yaml` に `publication: {pages: false, reason: "..."}` を設定します。

---

## 5. 作業フローのチェックリスト

1. **調査と設計**: 依頼文を `spec.yaml` の `requirements` に落とし込み、`architecture_selection.not_doing`（やらないこと）を最初に決める。関連する `.agents/skills/<topic>/SKILL.md` と `ref-repos/` を読む。
2. **データ準備**: `bake.ts` を書き、`bin/mfs bake <id>` で地物数・頂点数・バイト数を確認する（外れ値や想定外のファイルサイズはベイクのバグを疑う）。
3. **描画器と検証の実装**: 最小の1フレーム描画から作り、操作系と `bench.ts` を実装する。画面への描画結果をピクセル読み戻しで検証するチェックを入れる。
4. **テストと計測**:
   - `bin/mfs test` を実行し、ユニットテストと `tsc`（Node / Web 両方）が通ることを確認する。
   - 計測対象の環境では `bin/mfs bench <id>` を実行し、`results/<id>/screenshot.png` と `latest.json` を確認する（[計測の落とし穴](.agents/skills/map-from-scratch/references/pitfalls.md) に注意）。
5. **知見の記録**: 分かったこと（失敗した試みや計測ミスを含む）を数値とともに `spec.yaml` の `performance_knowledge` と `REQUEST.md` に記録する。
