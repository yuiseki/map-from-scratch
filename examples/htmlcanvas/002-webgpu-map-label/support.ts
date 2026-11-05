// HTML-in-Canvas shipped in Chrome 157. A browser that has it reflects the
// canvas's content attribute as a property; one that does not leaves the
// children of <canvas> as fallback content, never rendered. Detect the API
// itself rather than the browser: the method names changed several times
// before it shipped (drawElement, drawHTMLElement, then drawElementImage).
export interface DrawableHost {
  setAttribute(name: string, value: string): void;
  readonly content?: unknown;
}

export function supportsHtmlInCanvas(canvas: DrawableHost): boolean {
  canvas.setAttribute('content', 'drawable');
  return canvas.content === 'drawable';
}

// Chrome 157 remembers recent hit tests per point and forgets them on a DOM
// change, but not when an element drawn into a canvas moves (by
// drawElementImage in 2D, or updateElementGeometry). Without a DOM change a
// real click at the element's old place still reached it, and a click on its
// new place under a resting pointer went to the canvas (CDP mouse input,
// 2026-11-06). Writing an attribute of an element outside the document is a
// DOM change that costs no style or layout work. Call the returned function
// in every frame that moved a drawn element.
export function hitTestCacheBuster(make: () => { dataset: Record<string, string | undefined> } = () => document.createElement('i')): () => void {
  const stamp = make();
  let version = 0;
  return () => { stamp.dataset.v = String(++version); };
}
