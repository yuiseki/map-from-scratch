# htmlcanvas-003-globe-html-panels: 地球儀に立つ HTML パネル

## 依頼

Chrome 157 で正式に入った HTML-in-Canvas を使い、WebGL2 の 3D 地球儀に本物の HTML パネルを都市の位置に立てる。
パネルにはボタン、年のスライダー、リンクがあり、文字は選べ、Tab でフォーカスが届く。パネルは地球儀と一緒に傾いて
遠近で縮み、地平線の向こうでは隠れる。クリックやフォーカスはブラウザ自身の当たり判定で、描かれた位置に届く。
API の無いブラウザでは同じパネルを DOM の重ね表示で出し、どちらの経路かを画面に書く。

それ以前の HTML-in-Canvas の例 (001 の 2D ポップアップ、002 の WebGPU ラベル) はオリジントライアルの API で書かれていた。
この例は正式版の API で、3D の中の要素に当たり判定を合わせる `updateElementGeometry` を使う。

## できたもの

- 地球儀: 64 x 128 の球に Solar System Scope の地球画像 (threejs-006 と同じ、CC BY 4.0) を貼り、正面からの明暗だけ付ける。
- パネル: ロンドン、ラゴス、ニューヨーク、サンパウロ、東京の 5 枚。`<canvas content="drawable">` の子の `<div drawable>`。
  都市の接平面に北向きに置いた 232 x 172 CSS px の箱で、下辺の中央 (矢印の先) が都市。1 CSS px は 1/450 (地球の半径 = 1)。
- 中身: Natural Earth 10m populated places の都市圏人口 (Natural Earth が収録する UN World Urbanization Prospects の値、千人) と、
  World Bank WDI 2026-10-01 の国の都市人口率。スライダーで 1950〜2025 年を 5 年おきに選ぶ。ボタンは右上のブックマーク一覧に入れる。
  リンクは Wikidata。
- 毎フレーム: パネルごとに接平面が視線に向いているか (面の法線と視線の cos > 0.09) を見る。向いていれば
  `clip 行列 x パネルのモデル行列` に画面への写しを掛けた matrix3d を `canvas.updateElementGeometry(el, {canvasTransform})` に渡し、
  同じ行列でテクスチャを貼った四角形を描く。向いていなければ `clearElementGeometry(el)` (当たり判定から外し、支援技術には画面外と伝わる)。
- テクスチャ: `paint` イベントの `changedElements` に入ったパネルだけ `texElementSubImage2D(TEXTURE_2D, 0, 0, 0, el)` で送り、mip を作り直す。
  大きさは `getElementImageDefaultSize(el)` (grid px)。回転・ズームでは何も送らない。
- フォールバック: `setAttribute('content','drawable')` のあと `canvas.content` が `'drawable'` でなければ、パネルを canvas の上の
  `#overlay` に置き、同じ行列を CSS の `transform: matrix3d(...)` に入れる。`?fallback` で強制できる。
- 裏側のパネルのボタンに Tab でフォーカスが来たら、地球儀をそのパネルへ回す。

## 測ったこと (RTX 3060、headless Chrome 157、2026-11-06)

| | 値 |
| --- | --- |
| 最初のフレーム | p50 151〜211 ms (各計測の 1 回目は 573〜594 ms) |
| カメラの経路 90 フレーム | cpu_ms p95 0.15 ms、frame_ms p50 0.43 / p95 1.43 ms、gpu_ms 0.038 ms |
| updateElementGeometry 5 枚 (向きの判定・行列計算込み) | p50 0.025 / p95 0.06 ms。1 回は 5.2 us (プローブ) |
| パネル 1 枚の送り直し (mip、gl.finish 込み) | p50 0.105 / p95 0.37 ms |
| スライダーの input から描き終わりまで | p50 0.77 / p95 1.27 ms |
| テクスチャ | 5 x 232 x 172 x 4 B x 4/3 = 1.06 MB |
| コード / データ | gzip 10.4 KB / 514 KB (うち地球画像 513 KB) |

## API について分かったこと (失敗と、思い違いも)

1. **取り込みの関数の形。** `texElementSubImage2D(target, level, xoffset, yoffset, element)` の 5 引数。`texSubImage2D` に倣って
   format と type を入れたら `TypeError: ... The provided value is not of type '(Element or ElementImage)'`、width/height を入れても同じ。
   3 引数では `5 arguments required, but only 3 present`。行 0 は要素の上端で、`UNPACK_FLIP_Y_WEBGL` は効く。
2. **当たり判定は geometry を渡すまで無い。** 一度も `updateElementGeometry` していない子要素は、レイアウト上の位置でも当たらない。
   `canvasTransform` の原点は要素の箱の左上で、canvas の CSS px に写す。射影の `matrix3d` (4 行目が x, y で変わる) でも中の
   ボタンまで正しく当たる。z の行を 0 にした行列は逆行列が無いので、z の行は (0,0,1,0) にした。
3. **当たり判定のキャッシュが古いまま残る (いちばん大きな落とし穴)。** Blink は最近の当たり判定を点ごと (1/64 px) に覚えていて、
   DOM の変化では捨てるが `updateElementGeometry` では捨てない。ズームの検査で、前に聞いたのと同じ座標で聞き直すと、画面では
   パネルがあるのに canvas が返った。フレームを待っても、強制レイアウトでも、`requestPaint` でも直らず、点を 0.25 px ずらすと直り、
   どこかの要素の属性を 1 つ書くと直る。この例は geometry を更新したフレームで、document に属さない `<i>` の data 属性を書く
   (paint も changedElements も起きない)。外すと zoom-scales-panels が失敗する。マウスを止めたままホイールで回したあとのクリックも
   同じ経路のはずだが、本物の入力はハーネスに無いので確かめていない。
4. **DOM の順は当たりの順で、動かすと描き直し。** 重なった 2 枚では DOM で後ろが当たり、`z-index` は効かない。近いパネルを後ろに置こうと
   毎フレーム並べ替えたら、動かした要素がみな `changedElements` に入り、120 フレームの回転で送信が 21 回から 47 回に増えた。
   画面上の外接矩形が重なって順が逆のときだけ並べ替えるようにして 0 回。`updateElementGeometry` と `clearElementGeometry` 自体は
   paint を起こさない (地平線を 10 回越えて 0 回)。
5. **paint は rAF のあと。** rAF を待った直後に送信回数を数えたら、そのフレームで描き直されたパネル (戻したロンドン、フォーカスリング) が
   次の操作の数に入った。数える前に 3 フレーム待つ。
6. **paint の外では送らない。** 最初の paint の前に送ると `InvalidStateError: No cached paint record for element` (親の計測)。この例は paint の中で
   しか送らないので一度も出ていない。中身を変えた直後、paint の前に送っても例外にはならず古い絵が送られる (プローブ)。
7. **フォーカスと支援技術。** `clearElementGeometry` は要素を当たり判定から外すが、DOM には残るので Tab は裏側のパネルにも行く。
   フォーカスが来たら地球儀を回してパネルを見せることにした (focus-brings-panel-into-view)。フォールバックでは隠れたパネルを
   `visibility: hidden` にするので、そもそもフォーカスを受けない (検査もそれを確かめる)。
8. **ベンチの入力。** ハーネスに CDP の入力が無いので、`document.elementFromPoint` で描かれた位置の要素を取り、返った要素の `click()` を呼ぶ。
   要素に直接 `dispatchEvent` すると当たり判定を通らないので、それは証拠にしていない。画面の読み戻しは WebGL なので
   `render()` 直後に同じタスクで `gl.readPixels` (harness の `readBack` は Canvas 2D 用)。

## 描画の失敗

- **縁でピンが斜めに欠けた。** 点スプライトは中心の深さの平らな四角なので、ニューヨーク (縁から 25 度) では手前の球が下半分を切った
  (中心の画素 (133,56,59))。深度テストを外し、裏側は頂点シェーダで捨てる。ピンはパネルのあとに描いて、矢印の先に見えるようにした。
- **検査の点がパネルの下だった。** 北が上の確認に使ったサハラ (8W 24N) はラゴスのパネルの下で、白を読んだ。(2E 31N) にし、
  その点で `elementFromPoint` が canvas であることも確かめる。
- **斜めの行。** 接平面に北向きで立てたパネルは、画面の中心から外れた都市で行が傾く (ラゴスで左右約 25 px)。地理の向きのまま残した。
  読みやすさを優先するなら、接平面の中で画面の右方向に合わせて回せばよい (未実装)。

## 画面写真

- HTML-in-Canvas (`results/htmlcanvas-003-globe-html-panels/screenshot.png`): 大西洋を正面に、ロンドン・ラゴス・ニューヨーク・サンパウロの
  パネルが都市のピンに矢印を下ろして立つ。縁に近いニューヨークとサンパウロは強く傾いて縮む。東京は裏側で見えない。ロンドンの保存ボタンは
  検査のクリックで緑の「★ 保存済み」、右上のブックマークに「ロンドン」。左上の緑の文字が HTML-in-Canvas の経路を示す。
- フォールバック (`MFS_PAGE_QUERY=fallback`): 同じ 4 枚が同じ位置に DOM で重なり (カードの白の外接矩形が WebGL の四角形と 1〜2 px 以内で一致)、左上の文字が黄色でフォールバックと書く。検査は 10 個すべて
  DOM の経路で通る (upload_ms は送らないので報告されない)。

## やらないこと

昼夜の陰影と大気、パネルどうしの衝突回避、地平線際の徐々の透明化、大量のラベル、DPR 2 の計測。
