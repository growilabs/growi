import { Tokenizer, type TokenizerCallbacks } from 'htmlparser2';

import { endTagGreaterThan } from './html-end-tag';
import { decodeRcdataText, droppedByPython } from './html-references';
import { HtmlTextSink } from './html-text-sink';

// Python's HTMLParser decodes references inside these, not tags.
const RCDATA: ReadonlySet<string> = new Set(['title', 'textarea']);
const SLASH = 0x2f;

type TokenizerOverride =
  | { readonly recognizeSelfClosing: boolean }
  | { readonly index: number };

// htmlparser2 declares recognizeSelfClosing and index private, but in the
// version pinned in package.json ("=12.0.0") they are plain properties the
// Tokenizer re-reads right after the callback. Matching Python needs both
// moved from a callback; another version may store them differently.
const overrideTokenizer = (
  tokenizer: Tokenizer,
  fields: TokenizerOverride,
): void => {
  Object.assign(tokenizer, fields);
};

/**
 * Tokenizer callbacks with the Python service's HTMLParser semantics. The
 * Tokenizer alone is used, never the Parser: the Parser's open-element stack
 * makes stray end tags quadratic, and Python keeps no stack either.
 */
class PythonLikeHtmlReader implements TokenizerCallbacks {
  readonly #markup: string;
  readonly #sink = new HtmlTextSink();
  readonly #tokenizer: Tokenizer;
  #tag = '';
  #inRcdata = false;

  constructor(markup: string) {
    this.#markup = markup;
    this.#tokenizer = new Tokenizer(
      { decodeEntities: true, recognizeSelfClosing: true },
      this,
    );
  }

  read(): string {
    this.#tokenizer.write(this.#markup);
    this.#tokenizer.end();
    return this.#sink.result();
  }

  onopentagname(start: number, end: number): void {
    overrideTokenizer(this.#tokenizer, { recognizeSelfClosing: true });
    this.#tag = this.#markup.slice(start, end).toLowerCase();
    this.#sink.start(this.#tag);
  }

  onopentagend(): void {
    this.#inRcdata = RCDATA.has(this.#tag);
  }

  // "<br/>" arrives as the start tag and then this end, so "<svg/>" opens and
  // closes its skipped region. "<x / >" is a plain start tag for Python and
  // WHATWG but self-closing for htmlparser2: switching recognizeSelfClosing
  // off for this one tag makes the Tokenizer enter the raw-text region as
  // after ">"; the next start tag switches it back on.
  onselfclosingtag(gt: number): void {
    if (this.#markup.charCodeAt(gt - 1) === SLASH) {
      this.#sink.end(this.#tag);
      return;
    }
    overrideTokenizer(this.#tokenizer, { recognizeSelfClosing: false });
    this.#inRcdata = RCDATA.has(this.#tag);
  }

  onclosetag(start: number, end: number): void {
    const gt = endTagGreaterThan(this.#markup, end);
    // Python drops the rest of the document after an end tag its grammar does
    // not close; continuing would rescan the same tail at every later end tag.
    if (gt < 0) {
      this.#tokenizer.pause();
      return;
    }
    this.#inRcdata = false;
    this.#sink.end(this.#markup.slice(start, end).toLowerCase());
    // Python ends this tag past the first ">"; the Tokenizer then skips to it.
    if (this.#markup.indexOf('>', end) < gt) {
      overrideTokenizer(this.#tokenizer, { index: gt - 1 });
    }
  }

  ontext(start: number, end: number): void {
    const text = this.#markup.slice(start, end);
    this.#sink.text(this.#inRcdata ? decodeRcdataText(text) : text);
  }

  ontextentity(cp: number): void {
    if (!droppedByPython(cp)) {
      this.#sink.text(String.fromCodePoint(cp));
    }
  }

  onattribname(): void {}
  onattribdata(): void {}
  onattribentity(): void {}
  onattribend(): void {}
  oncomment(): void {}
  oncdata(): void {}
  ondeclaration(): void {}
  onprocessinginstruction(): void {}
  onend(): void {}
}

/** Text of decoded HTML, matching the Python service's _html_to_text. */
export const htmlMarkupToText = (markup: string): string =>
  new PythonLikeHtmlReader(markup).read();
