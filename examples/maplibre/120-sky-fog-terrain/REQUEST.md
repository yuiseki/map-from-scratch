# maplibre-120-sky-fog-terrain: 空と霧と地形 (北アルプス)

## 依頼

MapLibre GL JS の公式サンプル「Sky, Fog, Terrain」(ref-repos/maplibre__maplibre-gl-js/test/examples/sky-fog-terrain.html) の目的を、
汎用エンジンなしで再現する。元例は Mapterhorn の地形を 77 度に傾け、`map.setSky()` の 6 つの値
(sky-color、horizon-color、fog-color、sky-horizon-blend、horizon-fog-blend、fog-ground-blend) と enabled をパネルで変える。
ここでは手元の Mapterhorn planet.pmtiles から北アルプス (槍ヶ岳・穂高、137.65E 36.33N) を切り出し、78 度の傾きで
槍ヶ岳から北北西 (立山、日本海) を向いた画角で開く。

## 設計

- データ: 近景 z11 (30.8 m、39 km 四方) と遠景 z7 (493 m、253 km 四方) の 2 枚の高さ格子。差分 int16 を gzip して配り、
  ページは DecompressionStream で展開する (heights.ts)。gzip で 1.96 MB と 0.29 MB。遠景のうち近景と重なる頂点は 600 m 沈める。
- 描画: 頂点バッファーなし。64x64 セルのチャンクを instanced draw し、頂点シェーダーが gl_VertexID / gl_InstanceID から標本を決め、
  R32F テクスチャから高さと法線を読む (render.ts)。地表色は標高段彩 (sky.ts の RELIEF) と、北西からの光の陰影を元例の
  hillshade-shadow-color (#473B24) へ寄せたもの。
- 空: MapLibre の sky.fragment.glsl から地球儀の部分を除いたもの。基準の行は MapLibre の getMercatorHorizon (0.85 倍の補正) ではなく、
  平らな地球で目の高さの真正面が映る行 (camera.ts horizonY)。地平線より下で地形が無い所は horizon-color で埋める。
- 霧: MapLibre の terrain.fragment.glsl と同じ式。霧の深さは近い面を地図の中心 (目からターゲットまでの距離)、遠い面を 120 km
  にした透視の z/w。傾き 60〜70 度で霧を入れる calculateFogBlendOpacity も同じ。
- 既定の色は元例の #0000ff / #00ff00 / #ff0000 ではなく昼の空 (#1f5fbf / #dce8f2 / #aebfd0)。ブレンドの既定値は元例と同じ。
- enabled を外すと元例と同じく空も霧も消え、ページの背景 (白) が見える。そのときは遠景データの端が地平線の手前に見える。
- 操作: 左ドラッグで方位と傾き、ホイールで距離。目が地面から 150 m より低くなると傾きを 0.25 度ずつ下げて目を持ち上げる
  (camera.ts clampCamera)。パネルは input イベントで次の rAF に 1 回描き直す。

## わかったこと

- 最初の drag は方位の符号が逆で、手前の地面がポインターと逆に動いた。camera.test.ts が 640 → 478.7 px で失敗して見つかった。
- playwright-cli の既定の headless chromium は WebGL のコンテキストをすぐ失う。SwiftShader のフラグを渡して目視した。
- 目視 (1280x800、SwiftShader): 空は上が青、地平線の付近が白っぽく、遠い稜線ほど霧に溶ける。手前に穂高・槍の岩稜、谷は緑。
  近景と遠景の境目は初期画角では見えない。enabled を外すと空が白になり霧が消えることも見た。

## 計測 (RTX 3060、bench -n 1)

最初の GPU 実行で top-rows-sky-color、distant-terrain-fog-color、controls-change-only-their-pixels が落ちた。どれもチェックの作りの誤りで、描画器は変えていない。
- 既定の sky-horizon-blend 0.5 では帯 (200 px) が上端まで届く。MapLibre の式どおり上端にも horizon-color が 7.6% 混ざる。
- 遠い帯の標本は、地形の外を埋める horizon-color か、霧の深さ 0.99 を超えて horizon-color に移った最遠の地形だった。
- 霧の地形として数えた標本の多くが埋め色だった。

直したあとは 7 チェックすべて合格し、予算も満たした。first_frame_ms 413 ms、frame_ms p95 1.64 ms、gpu_ms p95 0.54 ms、
control_redraw_ms max 12.9 ms、transfer_kb 2,235、code_gzip_bytes 9,219。詳細は spec.yaml の check-fixes-first-gpu-run。
