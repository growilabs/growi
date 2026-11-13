import { LineJoiner } from './line-joiner';

const SKIPPED: ReadonlySet<string> = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'svg',
]);
const BLOCKS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'br',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'html',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'tfoot',
  'thead',
  'title',
  'tr',
  'ul',
]);
const CELLS: ReadonlySet<string> = new Set(['td', 'th']);

/** Tag and text events with the Python service's rules: skipped elements, block newlines, cell spaces. */
export class HtmlTextSink {
  readonly #lines = new LineJoiner();
  #skipDepth = 0;

  start(tag: string): void {
    if (SKIPPED.has(tag)) {
      this.#skipDepth += 1;
    } else {
      this.#separate(tag);
    }
  }

  end(tag: string): void {
    if (SKIPPED.has(tag)) {
      this.#skipDepth = Math.max(0, this.#skipDepth - 1);
    } else {
      this.#separate(tag);
    }
  }

  text(text: string): void {
    if (this.#skipDepth === 0) {
      this.#lines.add(text);
    }
  }

  result(): string {
    return this.#lines.result();
  }

  #separate(tag: string): void {
    if (this.#skipDepth > 0) {
      return;
    }
    if (BLOCKS.has(tag)) {
      this.#lines.add('\n');
    } else if (CELLS.has(tag)) {
      this.#lines.add(' ');
    }
  }
}
