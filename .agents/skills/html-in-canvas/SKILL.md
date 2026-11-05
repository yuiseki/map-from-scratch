---
name: html-in-canvas
description: How to draw real, interactive HTML (popups, label cards, panels with buttons, sliders and links) into a map's Canvas 2D, WebGL2 or WebGPU canvas with HTML-in-Canvas (shipped in Chrome 157), measured on the three examples in examples/htmlcanvas/. Covers the API as it actually behaves in Chrome 157, the paint-event lifecycle, hit testing (including a hit-test cache that ignores moved elements), feature detection and the DOM-overlay fallback, and how to verify all of it in this harness. Load it before using HTML-in-Canvas, before choosing between a DOM overlay, drawing UI yourself and HTML-in-Canvas for popups or labels, or when drawn HTML does not appear, does not take clicks, or takes them in the wrong place.
---

# HTML-in-Canvas: real HTML inside a map's canvas

A map that wants a rich popup or a label card has always had two bad
choices. A DOM overlay is real HTML, but it floats outside the canvas: it
lags the camera by a frame, is missing from a canvas export, and cannot sit
between two GPU layers. Drawing the card yourself (fillText, SDF text,
rounded rectangles) keeps it in the canvas, but you re-implement line
breaking, Japanese typography, badges and button states. HTML-in-Canvas lets
the browser lay out and paint a real element that is a child of the canvas,
and lets you draw that paint into 2D pixels or a GPU texture, wherever the
renderer wants it. The element stays live: it takes clicks, hover, focus,
text input and accessibility, at the place you tell the browser it was
drawn.

Everything below was measured on Chrome for Testing 157.0.8103.38 without
flags, on an RTX 3060, between 2026-11-05 and 2026-11-06, in three examples:
a 2D popup over aerial tiles (htmlcanvas-001) [1], WebGPU label cards
(htmlcanvas-002) [2], and HTML panels standing on a WebGL2 globe
(htmlcanvas-003) [3]. Numbers in brackets refer to the Sources at the end.

## Status (2026-11-06)

- Chrome 157 stable, no flag [4][5]. WHATWG stage 3 ("Committed",
  2026-09-24) [6].
- WebKit: on 2026-08-03 smfr wrote that WebKit would mark the proposal
  "support" in a week pending objections, with "ongoing discussions around
  parts of the API shape" [7]. No Safari release has it yet.
- Firefox: no position [8].
- So every page must detect the API and fall back (see below).

## First question: which way to put HTML on a map?

| The request | Use | Why |
| --- | --- | --- |
| A popup or card the user reads and clicks, over a 2D map | HTML-in-Canvas 2D (`drawElementImage`), DOM overlay as fallback | Real layout and input; the browser moves the hit box with the draw [1] |
| Many cards that move with the camera on a GPU map | HTML-in-Canvas into a texture atlas, quads placed by the vertex shader; send a card again only when it repaints | Pans cost no layout and no upload; 6 cards, 0 uploads during a pan [2] |
| Panels in 3D (on a globe, tilted, foreshortened, behind the horizon) | HTML-in-Canvas into one texture per panel, a projective `matrix3d` for hit testing | The same matrix places the DOM fallback within 1-2 px [3] |
| Thousands of labels, plain text | Not this. Glyph atlas or SDF text (see text-rendering, label-placement) | Each element costs a paint record, an upload and a geometry update |
| A browser without the API | DOM overlay placed with the same transform | Children of a canvas are fallback content and are never rendered there |

## The API as Chrome 157 actually has it

Probed on the page, not taken from the explainer: names changed several
times before shipping (placeElement, drawElement, drawHTMLElement, then
drawElementImage [6]) and the docs and the issue still disagree.

- Markup: `<canvas content="drawable">` with children marked `drawable`.
  The old `layoutsubtree` attribute is gone (`'layoutSubtree' in canvas` is
  false) [1].
- Detection: set the attribute and read it back. `canvas.content` is
  `'fallback'` before and `'drawable'` after, where the API exists [3][9].
  Do not detect by method name.
- 2D: `ctx.drawElementImage(el, x, y)` returns `undefined` (not a transform,
  unlike the 2026-03 issue text) [1].
- WebGL2: `gl.texElementSubImage2D(target, level, xoffset, yoffset, el)`,
  exactly five arguments (a sixth, options, is allowed). texImage2D-style
  format/type or width/height arguments throw "The provided value is not of
  type '(Element or ElementImage)'"; three arguments throw "5 arguments
  required". Row 0 is the element's top; `UNPACK_FLIP_Y_WEBGL` applies; an
  xoffset past the texture is INVALID_VALUE. There is no `texElement2D` or
  `texElementImage2D` [3].
- WebGPU: `device.queue.drawElementImageToTexture({ source: el }, { texture,
  origin: [x, y] })` writes straight into a slot of an atlas [2]. There is no
  `copyElementImageToTexture`.
- Canvas: `requestPaint`, `updateElementGeometry`, `clearElementGeometry`,
  `getElementImageDefaultSize` (grid pixels: a 120x40 CSS px element at DPR 1
  gives {width: 120, height: 40}), `getElementTransform`,
  `captureElementImage`; event `paint` (CanvasPaintEvent) with
  `changedElements` [1].
- TypeScript's DOM types do not have these yet; declare the few members you
  call locally [3].

## Lifecycle: draw and upload only in the paint event

1. An element has no paint record before the canvas's first `paint` event.
   Drawing or uploading it then throws `InvalidStateError: ... No cached
   paint record for element.` [1]. After content changes and before the next
   paint, an upload does not throw but sends the old picture [3].
2. So the one place to draw (2D) or upload (GPU) is the `paint` listener, and
   only the elements in `event.changedElements`. It fires by itself when an
   element's rendering changes (text, hover, focus, a slider moved), and after
   `canvas.requestPaint()` [1][2][3].
3. What repaints an element (it appears in `changedElements` and must be sent
   again):
   - its content or style changing, including `:hover` and `:focus-visible`;
   - a web font arriving after the first paint;
   - the **first** `updateElementGeometry` call for it: all six cards were
     listed again 0.15-0.5 s after the first paint. Placing them before the
     first `requestPaint` made the first paint the only full upload [2];
   - moving it in the DOM (`append`, `moveBefore`): 21 -> 47 uploads over a
     120-frame rotation when panels were re-sorted every time the depth order
     changed [3].
4. What does not repaint: later `updateElementGeometry` and
   `clearElementGeometry` calls (0 paints over 120 frames and 10 horizon
   crossings) [3], and camera moves in general. A pan uploads nothing [2].
5. The paint event comes after the frame's rAF callbacks. A check that counts
   uploads right after awaiting rAF sees that frame's upload in the next
   count; wait three frames before counting [3].
6. Allocate each texture once at `getElementImageDefaultSize` and replace it
   only when that size changes. Resizing the canvas recreates every snapshot
   [6].

## Hit testing

- **2D does it for you.** After `drawElementImage(el, x, y)`, the element's
  hit box is where it was drawn: `elementFromPoint` at the drawn button
  returns the button, real clicks reach it, and the canvas gets everything
  else [1]. Delete any code that compares the pointer with the button's
  rectangle and calls `click()` (the origin-trial version of 001 did that).
- **GPU canvases do not know where the shader put it.** Call
  `canvas.updateElementGeometry(el, { canvasTransform })` every frame the
  element moved. `canvasTransform` is a DOMMatrix from the element's
  border-box top-left (transform-origin does not apply) to the canvas's CSS
  pixels [3].
- **No geometry, no hit.** An element whose geometry was never set is not
  hit at its layout position either; the canvas is returned. The same
  happens in 2D with `drawElementImage(el, x, y, { preserveElementGeometry:
  true })` and no `updateElementGeometry`: 001 deliberately broken this way
  failed all three hit checks [1][3].
- **3D panels:** a quad on a tangent plane under perspective is a projective
  map, so one `matrix3d` holds it: clip matrix x panel model matrix, then
  the viewport, with the z row set to (0, 0, 1, 0). A zero z row makes the
  matrix singular and hit testing fails. Buttons inside a tilted panel are hit
  correctly [3].
- **Hidden panels:** `clearElementGeometry(el)` removes it from hit testing
  and marks it offscreen for accessibility. Keyboard focus still reaches it;
  003 turns the globe to a panel that receives focus [3].
- **Overlap order is DOM order.** Of two overlapping drawn elements, the
  later child is hit; `z-index` does nothing. Sort near-last, but only when
  two screen boxes actually overlap in the wrong order, because moving in the
  DOM repaints (above) [3]. Without `preserveHitTestOrder: true`, each
  `updateElementGeometry` moves the element to the top of the hit-test stack
  [5].
- **The hit-test cache ignores moved elements (Chrome 157).** Chrome keeps
  recent hit-test results per point (to 1/64 px) and drops them on DOM
  changes, but not when `drawElementImage` or `updateElementGeometry` moves an
  element. With real mouse input sent over CDP, a click on the element's old
  place still reached the element, and a click on its new place under a
  resting pointer went to the canvas, in 2D and in WebGPU alike [1][2][10].
  Waiting frames, forcing layout or `requestPaint` did not help (about 4 of 8
  queries stale); querying a point 0.25 px away did [3]. The fix: in every
  frame that moved a drawn element, write an attribute of an element outside
  the document (`stamp.dataset.v = ++n`). It is a DOM change, costs no style
  work, and causes no paint [3]. Both cases then went right. 001 passed its
  checks without it only because its HUD wrote `textContent` every frame [1].
  The helper is `hitTestCacheBuster` in the examples' `support.ts`. This looks
  like a Chrome bug worth reporting; re-test it on each Chrome upgrade.
- Pointer events on a drawn element bubble to the canvas, its parent. The
  map's pan handler must ignore events whose target is inside the element, or
  dragging a slider pans the map [1][3].

## Fallback

Children of a canvas are fallback content: a browser without the API lays
out none of them. Move the elements out of the canvas into an overlay and
place them with the same transform as CSS (`translate` in 2D, the same
`matrix3d` in 3D) [1][2][3]. Give every example a `?fallback` query that
forces this path, and show on screen which path runs. In a forced fallback
run, checks that read canvas pixels fail (the card is not in the canvas,
which is the overlay's real drawback) and hit-testing checks pass.

WebGPU on SwiftShader (headless Chrome) lost the device right after
`drawElementImageToTexture` ("A valid external Instance reference no longer
exists."); on the NVIDIA GPU under Xvfb the texture got the right pixels.
Treat SwiftShader like a browser without the API [2].

## Costs measured

| What | Value | Where |
| --- | --- | --- |
| 2D frame with popup, pan (`redraw_ms`) | p50 0.95 ms, p95 1.9-3.5 ms | 001 [1] |
| WebGPU pan, 6 cards (`cpu_ms` / `frame_ms` p95) | 0.39 ms / 5.0 ms, 0 uploads | 002 [2] |
| `updateElementGeometry` x 5 per frame, with the facing test and matrices | p50 0.03, p95 0.06 ms; one call 5.2 us | 003 [3] |
| One 232x172 panel upload with mipmaps and `gl.finish` | p50 0.10, p95 0.16-0.37 ms; the first upload 1.1-4.4 ms | 003 [3] |
| Slider input to redrawn frame | p50 0.75, p95 1.3-2.6 ms | 003 [3] |
| Texture memory, 5 panels with mips | 1.06 MB | 003 [3] |

These are for a handful of elements. At hundreds, measure the per-element
upload and geometry cost again before choosing this.

## Verifying it in this harness

- The harness runs Chrome for Testing (`CHROME_VERSION` in
  `docker/base/Dockerfile`) with no Blink feature flags;
  `harness/test/browser.test.ts` fails if the browser is older than 157 or a
  flag is added [11]. Debian's chromium was still 156 when 157 shipped.
- WebGPU examples need `benchmarks.display: xvfb` to get the hardware GPU;
  headless gives SwiftShader [2].
- Check hit testing with the browser's own hit test, not with your geometry:
  `document.elementFromPoint` at the drawn button's centre must return the
  button, then `.click()` what it returned and assert the handler ran.
  Dispatching an event on the button directly bypasses hit testing [1][3].
- Ask the same point before and after a move. That is what exposes the
  hit-test cache; a check that avoids the old point passes with the bug
  present [2].
- The harness has no trusted-input helper. For a question only real input
  answers, drive Chrome over CDP (`Input.dispatchMouseEvent`) from a probe
  script with `launchChrome` and `serve`, as in [10].
- `readBack` in `harness/page/bench.ts` is for Canvas 2D; read WebGL pixels
  with `gl.readPixels` in the same task as the draw [3].
- Before reading a map colour under a check point, confirm with
  `elementFromPoint` that no panel covers it [3].

## Tried and reverted

- **Origin-trial shape** (2026-10): `layoutsubtree` plus a feature flag, a
  hidden 2D staging canvas holding all cards, `copyExternalImageToTexture` of
  the whole staging canvas on every change, and a hand-written rectangle test
  calling `click()`. Replaced by `content="drawable"`, a draw straight into
  the atlas slot, uploads of `changedElements` only, and browser hit testing
  [1][2].
- **Re-sorting panels by depth every time the order changed**: 47 instead of
  21 uploads over 120 frames, because a DOM move repaints. Re-sort only on an
  actual overlap in the wrong order [3].
- **A pin sprite with the depth test on a globe**: the near limb cut it
  diagonally; turn the depth test off and discard the back side in the shader
  [3].
- **Awaiting fonts to avoid the second full upload**: it did not; the second
  paint came from the first `updateElementGeometry` [2].

## Sources

1. examples/htmlcanvas/001-rich-map-popup/ (spec.yaml performance_knowledge chrome-157-shipped-api, dom-overlay-fallback; REQUEST.md "2026-11-06 Chrome 157 の正式版への移行"; support.ts)
2. examples/htmlcanvas/002-webgpu-map-label/ (spec.yaml draw-element-straight-to-the-texture, tell-the-browser-where-the-quad-is, swiftshader-loses-the-device; REQUEST.md; support.ts)
3. examples/htmlcanvas/003-globe-html-panels/ (spec.yaml performance_knowledge, all entries; REQUEST.md; main.ts render() and the paint listener; geometry.ts cssTransform)
4. https://developer.chrome.com/blog/html-in-canvas (2026-10-26: "Chrome 157 marks the official stable release of the HTML-in-Canvas API")
5. https://developer.chrome.com/docs/web-platform/html-in-canvas and its 2d, webgl, webgpu and concepts pages
6. https://github.com/whatwg/html/issues/10650 (stage 3 on 2026-09-24; naming history; resizing recreates snapshots)
7. https://github.com/WebKit/standards-positions/issues/630 (smfr, 2026-08-03)
8. https://github.com/mozilla/standards-positions/issues/1076
9. examples/htmlcanvas/003-globe-html-panels/main.ts (`canvas.content` is 'fallback' before setting the attribute)
10. CDP mouse-input probe, 2026-11-06: a 60x30 drawable child of a WebGPU canvas and of a 2D canvas; click, move, click the old place; then move the element under a resting pointer and click. Without the stamp write: old place -> element, new place -> canvas. With it: old place -> canvas, new place -> element. Recorded in 001 and 002 REQUEST.md.
11. harness/test/browser.test.ts, harness/runners/browser.ts (`browserFlags`), docker/base/Dockerfile
