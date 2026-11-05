# 30DayMapChallenge 2026

実装対象は [30DayMapChallenge 公式リポジトリ](https://github.com/tjukanovt/30DayMapChallenge) の 2026 年テーマ 30 件です。日付と題名は公式 README に合わせ、各日の実装は専用レンダラーとして `01/` から `30/` に置きます。地図ライブラリを実行時の描画器として使わず、各例の `spec.yaml` に描画方式、データの出典・ライセンス・加工、計測項目を記録します。

データ選定では [yuiseki-open-data スキル](../../../.agents/skills/yuiseki-open-data/SKILL.md) と [データカタログ](../../../.agents/skills/yuiseki-open-data/references/catalog.md) を参照します。下表はカタログを使った初期案です。実装に着手するときに該当セクションを再確認し、配布条件、実ファイル、座標系、取得範囲、Range の挙動を `spec.yaml` に確定します。カタログに候補がない題材は、公開データを別途調査するか、合成データであることを明示します。

| 日 | テーマ | 実装案・カタログ候補 | 状態 |
|---:|---|---|---|
| 01 | Points | 世界の M4.5 以上の地震点を、規模と深さで符号化。`hf:usgs-comcat-2025-m45`（public domain） | TODO |
| 02 | Lines | 熱帯低気圧の全経路をストーム単位で接続し、移動速度を線上に表す。`hf:ibtracs-v04r01`（NOAA terms） | TODO |
| 03 | Polygons | 国別人口指標を Natural Earth の国境ポリゴンに結合して比較する。`hf:natural-earth` + 国別統計（指標ごとにライセンスを確認） | TODO |
| 04 | Clusters | 東京の施設点をズームに応じて GPU 集約し、密度と代表カテゴリを表示。`hf:osm-tokyo23-src-2026-08`（ODbL、帰属と共有条件を確認） | TODO |
| 05 | Senses: Sight | 富士山の標高を地形陰影と視線方向で見せる。`hf:gsi-dem-fuji-z14-100m-2026-10-25`（CC BY 4.0） | TODO |
| 06 | Vintage | Natural Earth を使い、紙地図風の色・文字・ハッチを専用 Canvas 描画器で再現。`hf:natural-earth`（public domain） | TODO |
| 07 | 10 minute map | 台東区から徒歩10分圏をネットワーク探索で塗り分ける。東京の OSM 道路データを抽出・焼き込み（ODbL）。徒歩速度と通行可能性を明記 | TODO |
| 08 | Utopia | 東京の人口メッシュに、緑地・公共施設への近接性を重ねた「こうあってほしい」案を描く。`hf:estat-census-mesh-2020` + `hf:ksj-p29`（各 CC BY 4.0） | TODO |
| 09 | Urban-rural | 人口密度と建成地を連続尺度で描き、都市・農村の境界を問う。`hf:ghsl-japan-core-2020-30arcsec`（CC BY 4.0） | TODO |
| 10 | Prompting only | 公式ルールに従い、地図の構想・仕様決定をプロンプトだけで行った成果を記録する日。AI によるコード生成を「prompting only」と偽らず、実装例として成立する表現方法を公式説明に照らして決める | 要件確認 |
| 11 | Senses: Sound | 東京の鉄道・道路を音の強さに変換した合成サウンドスケープ。`hf:osm-tokyo23-src-2026-08` 等を使用し、実測音ではなくモデルであることを表示 | TODO |
| 12 | Power | 国別の再生可能電力比率を時系列で描き、発電の地域差を比較。カタログの country tables からライセンスと列を確認して選定 | TODO |
| 13 | Interactions | 都道府県間の通勤・滞在人口フローを、方向付きリンクと時間選択で描く。`hf:mlit-1km-fromto-2022-01` または Meta 移動統計（集計単位と CC BY 条件を確認） | TODO |
| 14 | Borgesian map | OSM 建物・道路を地表と同じ縮尺で描く、領土に迫る地図の思考実験。東京の OSM 抽出（ODbL）、描画範囲を絞り密度を計測 | TODO |
| 15 | Inside out | 地表の下を反転して見せる断面図。地震震源と地形・海底標高を組み合わせ、深さの次元を明示。`hf:usgs-comcat-2025-m45` + `hf:gebco-...-hokkaido-east`（個別ライセンス確認） | TODO |
| 16 | Collaborative map | 人が共同編集してきた地物の履歴や貢献を題材にする。OSM データと履歴の取得可能性・ODbL を確認し、AI を「友人」として共同作成者扱いしない | 要件確認 |
| 17 | Light & dark | 夜間光の明暗と都市域を比較する。カタログの `planetarble/` および関連ソースを調べ、由来・利用条件が確認できる衛星画像だけを採用 | TODO |
| 18 | NULL | 欠損値を地理的な空白として可視化し、値がない場所とゼロの場所を区別。人口グリッド等から欠損を含む製品を選定し、欠損の意味を説明 | TODO |
| 19 | Senses: Smell | 工場・土地利用と風向を使い、においの届き方を合成モデルで表現。東京 OSM / 土地利用 + 気象データ候補を調査し、実測値と推定値を混同しない | TODO |
| 20 | Hexagons | 世界人口を H3 六角形で色と高さに変換。`hf:kontur-population-2023-11-01-22km`（CC BY） | TODO |
| 21 | OpenStreetMap | OSM の東京データから建物・道路・水系を選択描画する、OSM データそのものを主役にした地図。`hf:osm-tokyo23-src-2026-08`（ODbL、帰属と派生データ条件を確認） | TODO |
| 22 | Projections | Natural Earth の同一地物を複数投影に変換し、歪みをインタラクティブに比較。`hf:natural-earth`（public domain） | TODO |
| 23 | Senses: Taste | 東京の飲食店分布をカテゴリ・密度で描く。Overture Places または OSM の出典とライセンスを選定時に確認（CDLA / ODbL） | TODO |
| 24 | Network | 日本の鉄道路線と駅をグラフ化し、接続性・乗換を探索。`hf:ksj` の鉄道データまたは GTFS（CC BY 4.0）、ネットワーク形状を検証 | TODO |
| 25 | Is this a map? | 地図とデータ図表の境界を問う、場所を音・色・並びに変換する実験。出典が必要な場合はカタログの public-domain 地震データを使い、地理情報の符号化を明示 | TODO |
| 26 | Water | 洪水想定深または海底地形を描き、水の分布と地形を表す。`z:ksj/A31a`（CC BY 4.0）または `hf:gebco-...-hokkaido-east`（採用範囲の条件確認） | TODO |
| 27 | New tool | WebGPU compute と独自 WebGPU 描画器を新しい道具として使い、人口グリッドを並列描画。`hf:estat-census-mesh-2020`（CC BY 4.0） | TODO |
| 28 | Senses: Feeling | 地域ごとの「感じ方」を色・触覚的な密度で表す主観的作品。個人情報を使わず、公開統計から作る代理指標または明記した合成値を採用 | TODO |
| 29 | Raster | COG の衛星画像・標高を Range 読み込みし、独自ラスターレンダラーで表示。ライセンスが明確な `z:planetarble/ETOPO_2022_15s_bed.tif`（NOAA public domain）等を選定 | TODO |
| 30 | Pen & paper | 印刷して手描きできる等高線・人口地図を生成する。`hf:gsi-dem-fuji-z14-100m-2026-10-25` 等を PDF/SVG に焼き込み（CC BY 4.0、出典併記） | TODO |

## 実装ルール

- 公式テーマ名と日付は変更しない。ディレクトリ名は `examples/30DayMapChallenge/2026/01/` 形式で統一する。
- 各日の実装前に関連するカタログ項目と原典を確認し、出典・ライセンス・取得と加工・範囲・座標系を記録する。再配布や利用条件が確認できないデータは採用しない。
- 実データ処理は資源上限付きで行う。テストを先に書き、専用レンダラーの描画ピクセル、操作、性能を検証する。
- `TODO` は未実装、`要件確認` は公式テーマの表現・参加条件を先に確認する項目。完了条件を満たした日に限り状態と計測結果を更新する。
