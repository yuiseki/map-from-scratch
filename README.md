# map-from-scratch

「X をしたいから地図を作って」という依頼ごとに、その目的だけを満たす最小で最速の地図の描画器をほぼゼロから作り、計測で確かめるためのスキルとハーネスです。

汎用の地図エンジンは作らず、依頼ごとに描画器そのものを作り直します。平面でだけ見せたい依頼なら、3 次元描画のための処理の大半は最初から要りません。要らない機能を持たないことで、コードの量、メモリ、起動時間、描画負荷を減らします。

- 言語、描画 API、ランタイムは依頼に合わせて選ぶ (Canvas 2D、WebGL2、C + EGL/GLES3、マイコン向けの C など)。
- ブラウザでは WebGPU、WebAssembly、HTML-in-Canvas なども、データ量・処理内容・ブラウザ対応を見て選ぶ。実験段階の機能を使う例は、対応環境と代替表示を明記する。
- 描画エンジンとして外部ライブラリは使わない。ポリゴンの三角形分割には `vendor/earcut`、例22の Draco 圧縮建物データの復号には版を固定したデコーダーを使う。
- 各例を `spec.yaml` で定義する。要件 (requirements)、評価 (evaluation)、計測 (benchmarks)、データ (datasets)、性能の知見 (performance_knowledge)、構成の選択 (architecture_selection)、検証 (verification) の 7 節からなる。
- 計測済みの例では要件を測定値の上限や下限 (予算) にし、ハーネスが合否を出す。検証の項目は描画器が ID つきで報告し、1 つでも報告がないか失敗すれば不合格にする。未計測の例はその旨を明記する。
- 描画器を作るたびに、`ref-repos/` に集めた地図エンジン、空間処理ライブラリ、データ変換ツールの解き方を読んで参考にする。

## 最初の 1 時間

1. [ギャラリー](https://yuiseki.github.io/map-from-scratch/) で例をいくつか触る。どれも汎用の地図エンジンを使わず、その依頼のためだけに書いた描画器です。
2. 気になった例の `REQUEST.md` と `spec.yaml` を読む。依頼の一文が、要件、数値の予算、画面で確かめる検証の項目にどう分かれ、どの設計を選んで何を捨てたかが書いてあります。たとえば [01-prefecture-picker](examples/01-prefecture-picker/) は 1 KB 足らずのコードで都道府県を選ばせ、[02-world-population-mobile](examples/02-world-population-mobile/) はスマホ相当の条件で MapLibre GL JS と並べて測っています。
3. 手元で動かして測る。`bin/mfs serve 8080` でブラウザから触り、`bin/mfs bench <id>` で予算と検証の項目を照合します (準備は「動かすために」)。

## 前提: 汎用の地図エンジンを使わない

このリポジトリの描画器は、MapLibre GL JS や Leaflet などの汎用エンジンの上には作りません。比べるための実装を [baselines/](baselines/) に置くだけです。

理由は 3 つあります。依頼に要らない機能 (3 次元、スタイルの式、多数のデータ形式) を持たないことで、配るコード、起動時間、メモリ、1 フレームの仕事を減らせるからです。投影、簡略化、三角形分割、描画順を描画器ではなくベイクで済ませるには、データの形を描画器と一緒に設計する必要があるからです。そして、速いと言うには同じ依頼の汎用エンジン版と同じ条件で測って比べる必要があり、比べる相手と同じ土台の上では差が出ないからです。

汎用エンジンが要らないのではありません。どの依頼にも応えるエンジンが払っている代償を、1 つの依頼に絞ると払わずに済む、という立場です。

## どこから読むか

1. [.agents/skills/map-from-scratch/SKILL.md](.agents/skills/map-from-scratch/SKILL.md): 依頼を受けてから、描画器を作り、測り、公開するまでの手順。
2. [spec-yaml.md](.agents/skills/map-from-scratch/references/spec-yaml.md): 例を定義する `spec.yaml` の 7 節の書き方。
3. [patterns.md](.agents/skills/map-from-scratch/references/patterns.md): うまくいった設計。
4. [pitfalls.md](.agents/skills/map-from-scratch/references/pitfalls.md): 誤った数値を出した計測と、その見つけ方。
5. [rendering-mistakes.md](.agents/skills/map-from-scratch/references/rendering-mistakes.md): テストと検証を通ったのに間違った地図を描いた例と、その見つけ方。世界のコピー、投影、操作、当たり判定、3D、地球儀の裏側など。
6. [visual-review](.agents/skills/visual-review/SKILL.md): 描画器を実際に開いて目で確かめる手順。
7. `.agents/skills/<話題>/SKILL.md`: ラベル配置、浮動小数点の精度、地形、Range リクエストなど、地図を描くときの小さな問題ごとの知見。必要なものだけ読めばよい。
8. [AGENTS.md](AGENTS.md): エージェントがこのリポジトリで守る規則。

## 作りたいものから例とスキルを選ぶ

近い例をコピーして要らない部分を削るところから始めます。新しい依頼を既存の描画器にまとめることはしません。

| 作りたいもの | 近い例 | 読むスキル |
|---|---|---|
| 記事に埋め込む、軽い行政区画の地図。選ぶ、当てる、探す | [01](examples/01-prefecture-picker/)、[08](examples/08-prefecture-quiz/)、[09](examples/09-prefecture-search/) | polygon-triangulation、picking-and-hit-testing、startup-and-bundle-size |
| スマホで指で操作する塗り分け図 | [02](examples/02-world-population-mobile/) | mobile-and-power、picking-and-hit-testing |
| 時間に沿って出来事を再生する | [03](examples/03-quake-timeline/)、[20](examples/20-ucdp-ged-timeline/)、[25](examples/25-akita-bear-sighting/)、[deckgl-025](examples/deckgl/025-trips-layer/) | animation-and-camera |
| 大量の点の密度や集計を見せる | [04](examples/04-osm-node-density/)、[19](examples/19-kontur-h3-population/)、[webgpu-003](examples/webgpu/003-subgroup-density/)、[maplibre-056](examples/maplibre/056-create-and-style-clusters/) | point-rendering-and-clustering、gpu-memory-and-batching |
| 点に触れて名前や値を出す | [07](examples/07-world-cities-hover/)、[maplibre-071](examples/maplibre/071-display-a-popup-on-click/)、[maplibre-072](examples/maplibre/072-display-a-popup-on-hover/)、[openglobus-050](examples/openglobus/050-point-popup/) | picking-and-hit-testing、symbols-and-icons、text-rendering |
| 巨大なファイルから、見る範囲だけを読む | [10](examples/10-gsi-seamlessphoto/)、[21](examples/21-mapterhorn-planet-terrain/)、[24](examples/24-osm-planet/)、[wasm-001](examples/wasm/001-jspi-range-reader/)、[opfs-001](examples/opfs/001-offline-pmtiles/) | data-range-requests、tile-cache-and-loading、vector-tile-encoding |
| 背景のラスタタイルを敷く | [maplibre-018](examples/maplibre/018-add-a-raster-tile-source/)、[d3-010](examples/d3/010-web-mercator-tiles/) | raster-tiles、tile-lod-and-overzoom |
| 建物を 3D で見せる | [16](examples/16-plateau-buildings-3d/)、[22](examples/22-plateau-tokyo-tiles/)、[webgpu-001](examples/webgpu/001-gpu-driven-culling/) | 3d-buildings-and-meshes、3d-tiles-and-hlod、plateau-3d-tiles、draw-order-and-depth |
| 地形を 3D で見せる、陰影を付ける | [17](examples/17-fuji-terrain-3d/)、[18](examples/18-fuji-aerial-terrain/)、[forge3d-001](examples/forge3d/001-mount-rainier/)、[forge3d-009](examples/forge3d/009-shadow-comparison/) | terrain-and-elevation |
| 点群を見せる | [23](examples/23-taito-point-cloud/)、[deckgl-015](examples/deckgl/015-point-cloud-layer/)、[forge3d-006](examples/forge3d/006-point-cloud/) | point-rendering-and-clustering |
| 地球儀で見せる | [21](examples/21-mapterhorn-planet-terrain/)、[cesium-209](examples/cesium/209-lighting/)、[openglobus-062](examples/openglobus/062-vector-layer/) | projection-and-globe、float-precision |
| 道路網など、大量の線を描く | [05](examples/05-tokyo-roads-native/)、[webgpu-002](examples/webgpu/002-vertex-pulled-roads/) | line-tessellation、simplification-and-generalization |
| 地名やラベルを重ねる | [forge3d-002](examples/forge3d/002-mount-fuji-labels/)、[htmlcanvas-001](examples/htmlcanvas/001-rich-map-popup/) | label-placement、text-rendering |
| ブラウザの外で描く (デスクトップ、マイコン) | [05](examples/05-tokyo-roads-native/)、[06](examples/06-mcu-roadmap/) | float-precision、gpu-memory-and-batching |

使えるデータは [yuiseki-open-data](.agents/skills/yuiseki-open-data/SKILL.md) から探します。

## 何が入っているか

| 置き場所 | 中身 |
|---|---|
| `examples/<nn>-<slug>/` | 個別の依頼から作った描画器。ブラウザ (Canvas 2D、WebGL2)、デスクトップ (C + EGL/GLES3)、マイコン (C、RISC-V) |
| `examples/<ライブラリ>/<nnn>-<slug>/` | MapLibre GL JS、Mapbox GL JS、deck.gl、Leaflet、D3、CesiumJS、OpenGlobus、Tangram、forge3d の公式ギャラリーの各例を、その目的だけ満たす描画器として作り直したもの。進み具合は [TODO.md](TODO.md) |
| `examples/{webgpu,wasm,opfs,htmlcanvas}/` | 新しいブラウザの機能 (WebGPU、WebAssembly の JSPI、OPFS、HTML-in-Canvas) を地図に使う実験。対応する環境と、使えないときの表示を各例に書いてある |
| `baselines/` | 汎用エンジンで同じ依頼を作った、比較用の実装 |
| `.agents/skills/` | 手順 (map-from-scratch)、目で確かめる手順 (visual-review)、データの置き場所 (yuiseki-open-data) と、地図を描くときの話題ごとのスキル |
| `harness/` | 計測と検証のハーネス。依存のない TypeScript の CLI |
| `kits/` | 描画器にコピーして使う最小の読み込み器 (GeoParquet の Thrift、Zstd など) |
| `tools/` | ベイク、データの出典、サイトの組み立てと公開 |
| `ref-repos/` | 参考にする地図エンジンと空間データ処理ツール。`ref-repos/clone.sh` で集める (中身はリポジトリに含めない) |

話題ごとのスキルは、`ref-repos/` に集めた 48 のエンジンの issue、pull request、コミットログから、設計の判断とその代償、試して取りやめたことを抜き出してまとめたものです。どの主張にも出典を付け、出典と照らし合わせて確かめてあります。`.claude/skills` は `.agents/skills` へのリンクです。

## 扱う範囲と扱わない範囲

扱うもの:
- 1 つの依頼のための描画器を、ブラウザ、デスクトップ、マイコンで作ること。
- 描画器がそのまま画面へ流せる形にデータを前処理すること (ベイク)。投影、簡略化、三角形分割、量子化、空間の索引、Range で読むための並べ方。
- 要件を数値の予算にして測ること、画面に描かれたピクセルを読み戻して確かめること、汎用エンジンと同じ条件で比べること。
- 公式ギャラリーの例を、元のライブラリを使わずに作り直すこと。

扱わないもの (意図して外している):
- 汎用の地図エンジンやライブラリを作ること。例どうしで描画のコードを共有して育てることもしない。共有するのはベイクの道具とハーネスまで。
- スタイルの仕様 (MapLibre Style Spec など) を実装すること。
- タイルを配る仕組みを作ること。データは静的なファイルと HTTP Range で配る。
- 地理空間データの分析そのもの。[GeoAI-master-skills](https://github.com/yuiseki/GeoAI-master-skills) が扱う。

まだ無いもの:
- kepler.gl と luma.gl のギャラリーの作り直し ([TODO.md](TODO.md))。
- 多くの例の性能の計測と、元の例との比較。計測していない例は、その旨を `REQUEST.md` に書いてある。

## 数字について

ここと各例の `REQUEST.md` に書いた数字は、日付、機械、ブラウザの版を添えて測ったものです。予算を満たしたことと、元の例や汎用エンジンより速いことは、別に判定します。速いと書くのは、同じデータ、画面、操作の経路で比べたものだけです (比べる条件は [docs/gallery-comparison.md](docs/gallery-comparison.md))。

テストと検証の項目を通っても、間違った地図を描くことがあります。見つけた間違いとその見つけ方は [rendering-mistakes.md](.agents/skills/map-from-scratch/references/rendering-mistakes.md) にまとめています。

### 計測した例 (01〜07)

`bin/mfs report` の出力です (RTX 3060、Ryzen 9 5950X、Chromium 156 headless、2026-10-26、load average 2 前後の静かなときに全部を続けて測定)。

| 例 | 実行環境 | 配るコード | データ | 初回描画 p50 | フレーム p95 | 予算 |
| --- | --- | --- | --- | --- | --- | --- |
| 01-prefecture-picker | Canvas 2D | 962 B gzip | 3936 B gzip | 89.4 ms | 1.42 ms | 全部通過 6/6 |
| 02-world-population-mobile | WebGL2 | 3254 B gzip | 463 KB gzip | 159 ms | 1.27 ms | 全部通過 5/5 |
| 03-quake-timeline | WebGL2 | 2646 B gzip | 513 KB gzip | 37 ms | 1.11 ms | 全部通過 5/5 |
| 04-osm-node-density | WebGL2 | 2730 B gzip | 17135 KB gzip | 275 ms | 2.34 ms | 全部通過 5/5 |
| 05-tokyo-roads-native | EGL + OpenGL ES 3.0 | 23 KB (実行ファイル) | 5357 KB gzip | 116 ms | 1.14 ms | 全部通過 5/5 |
| 06-mcu-roadmap | C (MCU) | 988 B (.text) | 469 KB (.rodata) | - | 0.372 ms | 全部通過 6/6 |
| 07-world-cities-hover | WebGL2 | 4460 B gzip | 142 KB gzip | 63.4 ms | 2.50 ms | 全部通過 7/7 |

- フレームの列は、WebGL2 とネイティブでは GPU の処理が終わるまで待った 1 フレームの時間です。01 はホバー中の rAF フレーム間隔、06 はホスト CPU での時間で、マイコン実機の時間ではありません。
- 01 と 02 はスマホ相当 (390×844、DPR 3、CPU 4 倍スロットル) で測っています。
- 配るコードは、TypeScript から型を除いた JavaScript (ブラウザが受け取るもの) の gzip 後の大きさです。
- 初回描画には、計測用のコードの読み込みを含めていません。
- この表のほかに、各例の検証の項目 (verification) もすべての反復で通っています。
- 07 だけ 2026-10-27 に国境線を足して測り直しました (load average 3)。

### 汎用エンジンとの比較

02 と同じ依頼を MapLibre GL JS 5.24.0 で作り ([baselines/b02-maplibre](baselines/b02-maplibre))、同じジオメトリ、同じ画面、同じカメラ経路で、上の表と同じときに測りました。

| | 02 (この方式) | MapLibre GL JS | 差 |
| --- | --- | --- | --- |
| 配るコード (gzip) | 3.2 KB | 279 KB | 88 分の 1 |
| データ (gzip) | 463 KB | 1,153 KB (GeoJSON) | 2.5 分の 1 |
| 初回描画 p50 | 159 ms | 770 ms (最初に idle になるまで) | 4.8 分の 1 |
| フレーム p95 (GPU の処理の終わりまで) | 1.27 ms | 2.88 ms (タイル生成後) / 3.84 ms (生成中) | 2.3〜3 分の 1 |
| 1 フレームの JS 時間 p50 | 0.005 ms | 1.1 ms | |
| 新しいズームでの描き直し待ち | なし | 1〜30 ms | |
| タップの当たり判定 p95 | 0.85 ms | 1.6 ms | |
| JS ヒープ | 1.1 MB | 51 MB | 46 分の 1 |

MapLibre は Web メルカトルで描くので、投影法は 02 (Equal Earth) と違います。

## 動かすために

ホストに要るのは Docker と、GPU を使う例では nvidia container runtime だけです。ハーネス (依存なしの Node 24)、C のビルド、Chromium、データ準備 (GDAL、osmium) はすべてコンテナの中で動きます。

```sh
ref-repos/clone.sh     # 参照する地図エンジンや空間データ処理ツールを集める (浅いクローン)
bin/mfs image          # ベースイメージを作る
bin/mfs test           # ハーネスとベイク用ヘルパのテスト
bin/mfs bake all       # データを用意する (原データの場所は tools/sources.ts)
bin/mfs build all      # ネイティブの例をビルドする
bin/mfs bench all      # 計測して予算と照合する。結果は results/<id>/
bin/mfs report         # 最新の結果を Markdown の表で出す
bin/mfs serve 8080     # ブラウザの例を手で触る: http://localhost:8080/examples/
tools/deploy-pages.sh  # サイトを組み立て、全ページを確かめて GitHub Pages に公開する
```

- GPU の無いコンテナ (macOS の Docker など) では、WebGL と WebGPU の例が動きません。ハーネスは GPU の代わりにソフトウェア描画が使われるとエラーにします。
- ブラウザの例は GitHub Pages で、COOP/COEP なしの静的なファイルとして動く必要があります。1 ファイルは 100 MB まで。Pages に載せない例は `spec.yaml` の `publication.pages: false` で指定します。

## ハーネス

- `harness/cli.ts`: 依存のない TypeScript の CLI。Node 24 が型を除いてそのまま実行し、`bin/mfs` がコンテナの中で動かす。型検査 (tsc) は `bin/mfs test` で、イメージの中だけにある TypeScript で行う。
- ブラウザの描画器: headless Chromium を自作の CDP クライアント (Node 組み込みの WebSocket を使う) で動かす。ページは `window.__mfsEmit` で計測値と検証の結果を返す。`--site` を付けると、組み立てた GitHub Pages のサイトそのものを測る。
- ネイティブの描画器: `harness/native/mfs-exec.c` が fork/exec して、出力の各行にプロセス起動からの時刻を付ける。wait4 で CPU 時間と最大常駐メモリを取る。
- 配るものの大きさ: コードとデータのバイト数と gzip 後の大きさ。マイコン向けはオブジェクトの .text、.rodata、RAM (.data + .bss) を `llvm-size` で測る。

## データの出典

各例の `spec.yaml` の `datasets` に、出典、版、ライセンスを書いています。原データの取得元と置き場所は [tools/sources.ts](tools/sources.ts) にあります。ベイクしたデータと計測結果はリポジトリに入れていません (`data/`、`results/`)。

## ライセンス

GPL-3.0-or-later です ([LICENSE](LICENSE))。`ref-repos/` の GPL のエンジン (QGIS、ortho-earth など) の解き方を取り入れるためです。`vendor/earcut` は earcut の ISC ライセンス、例22の Draco デコーダーは [Apache License 2.0](examples/22-plateau-tokyo-tiles/DRACO-LICENSE.txt) のままです。`ref-repos/` の中身はこのリポジトリに含めず、`ref-repos/clone.sh` で取得します。それぞれのライセンスは各リポジトリのファイルに従います。
