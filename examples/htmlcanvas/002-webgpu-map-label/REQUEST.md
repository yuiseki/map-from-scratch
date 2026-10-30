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
