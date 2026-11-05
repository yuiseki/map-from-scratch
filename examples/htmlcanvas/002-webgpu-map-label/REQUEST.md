# htmlcanvas-002-webgpu-map-label: WebGPU Map Labels via HTML-in-Canvas

## 依頼内容

HTML-in-Canvas で生成した HTML 要素を WebGPU レンダリングパイプラインへ取り込み、地図上のラベルまたは情報カードとして GPU 描画することを検証する。

### 要件
1. ラベル内容は実 HTML で構成し、Canvas 2D の `fillText()` や SDF 文字描画には置き換えない。
2. HTML 要素を WebGPU で利用可能な画像/テクスチャとして取り込み、WebGPU render pass 内で地図と合成する。
3. 少なくとも複数地点に HTML ラベルを配置する。
4. pan / zoom に追従し、GPU 側のラベル quad 位置だけを更新できる構成にする。
5. 毎フレーム HTML を再レイアウト・再ラスタライズしない。内容が変わらないラベルは再利用する。
6. Canvas の最終ピクセル読み戻しで、地図と HTML ラベルが同一描画結果に合成されていることを検証する。
7. ラベル更新時だけ HTML 由来テクスチャが更新され、通常の pan / zoom では再生成されないことを計測・検証する。
8. Chromium 156 環境で必要な feature flag（`--enable-blink-features=CanvasDrawElement`）を明記し、未対応時の扱いを `spec.yaml` に記録する。
9. `htmlcanvas-001` で得られた知見を参照し、同じ罠を再発させない。
10. WebGPU 固有の texture upload、alpha、premultiplied alpha、色空間、サイズ同期などの罠が見つかった場合は skill / `rendering-mistakes.md` に還元する。

---

## アーキテクチャと得られた知見

1. **HTML-in-Canvas から WebGPU へのブリッジ**:
   - `<canvas layoutsubtree content="drawable">` の子要素として定義された複数の実 HTML カード（CSS 角丸、色バッジ、星評価、日本語タイポグラフィ、シャドウ）を、`ctx.drawElementImage(el, x, y)` により 1 枚のテクスチャアトラス（1024x256）に描画。
   - `device.queue.copyExternalImageToTexture({ source: canvasHtml }, { texture: labelTexture }, [1024, 256])` を呼び出すことで、追加のメモリアロケーションなしに一括で WebGPU テクスチャへアップロード。
2. **GPU 側でのアンカー計算とゼロ・リレイアウト**:
   - 各ラベルの Mercator 座標 `[mx, my]`、画面サイズ `[width, height]`、UV 矩形 `[u0, v0, u1, v1]` を Storage Buffer に格納。
   - Vertex Shader がカメラの `center` と `scale` から画面ピクセル座標 `(inst.pos - camera.center) * scale` を計算し、クアッド頂点オフセットを加算して NDC に変換。
   - パン・ズーム操作中はカメラ Uniform バッファのみを更新するため、テクスチャアップロード回数は 1 回（初回のみ）のまま維持され、HTML の再計算は一切発生しない。
3. **動的コンテンツ更新**:
   - ラベルのテキストや評価が更新されたときのみ `canvasHtml.requestPaint()` を呼び出し、再描画完了後に `copyExternalImageToTexture` でアトラスを再転送。
   - 検証チェック `zero-uploads-during-pan` および `texture-updated-on-change` により、静止・移動・更新時のアップロード回数を厳密に証明。

## 計測結果

`bin/mfs bench htmlcanvas-002-webgpu-map-label` を 3 反復、2 回。RTX 3060 のホストで、Chromium を Xvfb 上で画面ありで起動する (`display: xvfb`)。2026-11-03。

| 項目 | 計測値 | 予算 |
|---|---|---|
| 初回描画 (`first_frame_ms` p50) | 816〜818 ms | <= 2,000 ms |
| 1 フレームの JS (`cpu_ms` p95) | 0.08〜0.16 ms | <= 5.0 ms |
| 完了までのフレーム時間 (`frame_ms` p95) | 2.5〜3.8 ms | <= 16.7 ms |
| GPU 時間 (`gpu_ms` p50、描画パス) | 0.023 ms | |
| コード (gzip) | 11,750 B | <= 12,000 B |

- 以前は headless の SwiftShader で測っていた。SwiftShader では毎フレーム画面全体を読み戻して Canvas 2D に写すので、`redraw_ms` の予算は 45 ms、`frame_interval_ms` は 35 ms だった。どちらも CPU で GPU をまねる速さで、GPU で描くこの例の速さではなかった。いまは 1 フレームを実際にパンさせてオフスクリーンに描き、`onSubmittedWorkDone` まで待つ。予算は要件どおり、再描画 5.0 ms と 60 fps の 16.7 ms にした。
- 以前の計測ループは、フレーム間隔の 15 回は何も描かずに rAF を待つだけで、再描画の 20 回は同じ視点を描き直すだけだった。


## 2026-11-06 Chrome 157 の正式版への移行

- カードを、別の 2D canvas でなく WebGPU の canvas 自身の子 (`<canvas content="drawable">`) に置き、`device.queue.drawElementImageToTexture({ source: el }, { texture, origin })` でアトラスの枠へ直に描く。2D canvas と、その全面の消去と `copyExternalImageToTexture` が消えた。
- 送るのは canvas の `paint` イベントの中で、`event.changedElements` に挙がったカードだけにした。最初は 6 枚、文字を変えたカードは 1 枚、パンは 0 枚。
- 最初の `updateElementGeometry` は、全部のカードの描き直しを起こす (`paint` イベントが 6 枚とも挙げ直した)。最初の `paint` より前に位置を知らせて、全部を送るのを 1 回にした。
- フレームごとに `canvas.updateElementGeometry(el, { canvasTransform, preserveHitTestOrder: true })` で、頂点シェーダーが置いたカードの位置をブラウザに知らせる。カードは本物のクリックを受け、クリックで黄色に変わる (`click-pins-card`)。
- `document.elementFromPoint` は、同じ点への直前の答えを、`updateElementGeometry` で要素が動いた後も返すことがあった。CDP で送った本物のクリックは、新しい位置に届いた (元の位置は canvas、新しい位置はカード)。計測は、動かす前と後で同じ点を問わない。
- SwiftShader の WebGPU では、`drawElementImageToTexture` の直後にデバイスが失われた。SwiftShader のときと API の無いブラウザでは、カードを DOM overlay にする (`?fallback` で強制できる)。

| 計測 (3 回、2026-11-06、RTX 3060、Xvfb) | 値 | 予算 |
| --- | --- | --- |
| `cpu_ms` p95 | 0.385 ms | <= 5.0 ms |
| `frame_ms` p95 | 5.02 ms | <= 16.7 ms |
| `first_frame_ms` p50 | 824 ms | <= 2,000 ms |
| コード (gzip) | 12,351 B (移行前 11,686 B) | <= 13,000 B |

計測のあいだ、マシンの load average は 21 前後だった (ほかの計測と同時)。
- 上の `elementFromPoint` の件は、本物のクリックにも出た (CDP のマウス入力、2026-11-06)。要素を動かした後に元の位置をクリックすると、もう無いカードに届き、止まったポインタの下へカードが来てもクリックは canvas に行った。Chrome は点ごとのヒットテストの結果を覚えていて、DOM が変わると捨てるが、`updateElementGeometry` では捨てない。htmlcanvas-003 が見つけた対処 (document に属さない要素の属性を、動かしたフレームで 1 回書く、`support.ts` の `hitTestCacheBuster`) で、どちらも正しくなった。計測は、動かす前と後で同じ点を問う厳しい形に戻した。対処を外すと `card-hit-where-drawn` が落ちる。
