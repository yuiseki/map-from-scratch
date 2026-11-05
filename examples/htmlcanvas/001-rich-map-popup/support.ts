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
