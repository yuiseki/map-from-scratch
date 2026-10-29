# deck.gl GridLayer に対応する専用描画器

[元例](https://deck.gl/examples/grid-layer)のパリの街路樹を、2048〜16 m の8段階の格子から個々の樹木へズームで切り替えて表示します。元例と同じ [deck.gl-data の固定版](https://github.com/visgl/deck.gl-data/blob/0535921160bdcd57ef55c712669c5a4d5eedbb3c/examples/scatterplot/les-arbres.csv)を使用します。元データは [Ville de Paris / Paris Data「Arbres」](https://opendata.paris.fr/explore/dataset/les-arbres/)が公開し、ライセンスは ODbL です。

元例は8枚の GridLayer を必要に応じてGPU集計し、ズーム時にクロスフェードします。この描画器は8段階を事前集計し、占有セルだけを転送します。描画中は集計せず、表示に必要な最大2帯の点スプライトを WebGL2 で描きます。ホバーでは格子の本数、拡大時は樹種と幹周を表示します。

元例は CARTO の背景地図を含みます。この例は背景地図を含めていないので、両者の画面全体や速度を直接比較できません。集計格子の座標原点や分位点も元例と完全には一致しません。同じ条件の比較は今後行い、現時点では速度の優劣を主張しません。

## 計測

`bin/mfs bench deckgl-010-grid-layer --site` を3反復した。画面は1280×800・DPR 1、GPUは NVIDIA GeForce RTX 3060（Vulkan）。203,688 本、8段階の占有セル合計141,812個を配信した。公開用ビルドのスクリーンショットも確認した。

| 指標 | 結果 | 予算 |
| --- | ---: | ---: |
| 初回表示 p50 | 102.8 ms | 1000 ms 以下 |
| ズーム中のフレーム p95 | 1.24 ms | 8.3 ms 以下 |
| 固定画面のフレーム p95 | 0.235 ms | 8.3 ms 以下 |
| GPU p95 | 0.03891 ms | 参考値 |
| コード gzip | 6,352 B | 20,000 B 以下 |
| データ gzip | 約 2.06 MB | 2.5 MB 以下 |

全8段階で本数合計が203,688本と一致し、格子、個々の樹木、画面変化、格子と樹木のホバー表示が3反復すべてで通った。元例との同条件比較は未実施で、速度の優劣は判定していない。
