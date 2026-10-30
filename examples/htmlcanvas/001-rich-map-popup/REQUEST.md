# htmlcanvas-001-rich-map-popup: HTML-in-Canvas Rich Map Popup

## 依頼内容

地図上の地点をクリックしたときに表示する rich popup を DOM overlay や Canvas 自前描画ではなく、HTML-in-Canvas で実 HTML として Canvas 内に描画・操作できることを検証する。

### 要件
1. popup は実 HTML で構成し、複数行テキスト、CSS 背景・枠、リンクまたは button を含める。
2. DOM overlay は禁止。
3. `fillText()` 等による popup UI の再実装は禁止。
4. pan / zoom 後も popup anchor が地理座標に正しく追従する。
5. Canvas のピクセル読み戻しで popup が描画されていることを検証する。
6. popup 内の button またはリンクが実際にクリック可能であることを自動検証する。
7. 日本語を含む複数行レイアウトを使い、ブラウザの HTML layout / typography を利用する価値を確認する。
8. Chromium 156 環境では必要な feature flag（`--enable-blink-features=CanvasDrawElement`）を使い、対応条件を `spec.yaml` に明記する。
9. サイトの技術分類に `HTML-in-Canvas` を追加する。
10. 実装中に見つかった API 制約・描画同期・入力イベント・pixel readback の罠を skill / `rendering-mistakes.md` に還元する。

---

## 比較: HTML-in-Canvas vs Canvas 自前描画 vs DOM Overlay

| 観点 | DOM Overlay 方式 | Canvas 自前描画方式 (`fillText` 等) | HTML-in-Canvas 方式 (`drawElementImage`) |
| :--- | :--- | :--- | :--- |
| **UI レイアウト表現力** | 高 (HTML/CSS そのまま) | 低 (折り返し・行間・禁則処理・枠・影を全て自前実装) | **高 (HTML/CSS そのまま)** |
| **コード量 (UI 部分)** | 少量 (DOM ツリー + CSS) | 膨大 (文字分割・測定・描画で数百行) | **極小 (HTML + CSS 定義のみ、描画は 1 行)** |
| **カメラ追従の同期性** | 劣る (DOM レイヤと Canvas レンダラの 1 フレームジッター/ズレ) | 完全同期 (Canvas 同一描画パス) | **完全同期 (Canvas 同一描画パス)** |
| **画像エクスポート / 録画** | 不可 (Canvas 外のため `toBlob` / `toDataURL` に含まれない) | 可能 | **可能 (`canvas.toBlob()` にポップアップも含まれる)** |
| **ピクセル読み戻し検証** | 不可 (Canvas は背景のみ) | 可能 | **可能 (`ctx.getImageData` でボタン色や背景を直接検証)** |
| **入力イベント対応** | ブラウザ標準の DOM イベント | 自前ヒットテスト (矩形内外判定) | **Canvas 座標から子要素矩形へのルーティング** |

---

## 得られた知見・API 制約

1. **Chromium 機能フラグ**:
   - `CanvasRenderingContext2D.prototype.drawElementImage` は `--enable-blink-features=CanvasDrawElement` で有効化される。
2. **`<canvas>` 属性の必須要件**:
   - キャンバス要素に `layoutsubtree` と `content="drawable"` 属性を指定する必要がある。これにより子 HTML 要素がキャンバスの描画可能サブツリーとしてレイアウト計算される。
3. **同期と `requestPaint` のライフサイクル**:
   - 子要素のテキストやスタイルを変更した直後は、ブラウザの paint record が未更新である。
   - そのまま `ctx.drawElementImage(el, x, y)` を呼ぶと `InvalidStateError: No cached paint record for element` がスローされる。
   - `canvas.requestPaint()` を呼び出し、`canvas.addEventListener('paint', resolve, { once: true })` で paint イベントの完了を待機してから `drawElementImage` を呼ぶことで安全に描画できる。
4. **ヒットテスト**:
   - 現行 Chromium 実装では canvas 上の `document.elementFromPoint` は `HTMLCanvasElement` 自体を返すため、Canvas 側のクリックリスナーでポップアップ矩形・ボタン矩形に対する交差判定を行い、該当子要素の `.click()` をディスパッチすることで完全なインタラクションが成立する。
