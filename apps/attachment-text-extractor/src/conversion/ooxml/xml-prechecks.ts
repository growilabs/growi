import { type SpanKind, stripSpans } from './strip-spans';

// What expat refuses but xmldom lets through even with every report thrown
// (research.md 18.5.4). Characters are checked on the raw text; the rest on
// the text without CDATA sections, comments and processing instructions,
// which may legally hold '&' and ']]>'.
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding the characters XML 1.0 forbids is the point
const INVALID_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;
const BARE_AMPERSAND = /&(?!(?:[A-Za-z_:][\w.:-]*|#[0-9]+|#x[0-9A-Fa-f]+);)/;
const NUMERIC_REFERENCE = /&#(?:x([0-9A-Fa-f]+)|([0-9]+));/g;
const VERBATIM: readonly SpanKind[] = [
  ['<![CDATA[', ']]>'],
  ['<!--', '-->'],
  ['<?', '?>'],
];
// NUL cannot occur in XML text (INVALID_CHAR), so it marks where a span was
// removed and keeps the character data on both sides apart, as for expat.
const GAP = '\u0000';

// xmldom chains each element's namespace map to its parent's, so deeply
// nested declarations make parsing quadratic. Counted on the raw text: a
// '<!--' inside a DOCTYPE literal would make stripSpans drop the whole body
// while xmldom still parses it. Over-counting only errs toward refusing.
const MAX_NAMESPACE_DECLARATIONS = 1000;
const XMLNS = 'xmlns';
// Where a prefix ([^\s=>/]*) and the blanks before '=' (\s*) end.
const NAME_STOP = /[\s=>/]/g;
const BLANK_STOP = /\S/g;

const isXmlChar = (cp: number): boolean =>
  cp === 0x9 ||
  cp === 0xa ||
  cp === 0xd ||
  (cp >= 0x20 && cp <= 0xd7ff) ||
  (cp >= 0xe000 && cp <= 0xfffd) ||
  (cp >= 0x10000 && cp <= 0x10ffff);

// Stops at the first bad reference: collecting every match first cost
// hundreds of MiB on a part of nothing but references.
const hasBadReference = (markup: string): boolean => {
  NUMERIC_REFERENCE.lastIndex = 0;
  for (
    let m = NUMERIC_REFERENCE.exec(markup);
    m != null;
    m = NUMERIC_REFERENCE.exec(markup)
  ) {
    const cp = m[1] != null ? Number.parseInt(m[1], 16) : Number(m[2]);
    if (!isXmlChar(cp)) {
      return true;
    }
  }
  return false;
};

// ']]>' inside one run of character data; tags are skipped with their quoted
// attribute values, where ']]>' is legal. One pass, and the next ']]>'
// position only moves forward, so hostile markup stays linear.
const hasCdataEndInText = (markup: string): boolean => {
  let next = markup.indexOf(']]>');
  if (next < 0) {
    return false;
  }
  let from = 0;
  let inTag = false;
  let quote = '';
  const inRun = (end: number): boolean => {
    while (next >= 0 && next < from) {
      next = markup.indexOf(']]>', next + 1);
    }
    return next >= 0 && next + 3 <= end;
  };
  for (let i = 0; i < markup.length; i++) {
    const c = markup[i];
    if (quote !== '') {
      if (c === quote) quote = '';
    } else if (inTag) {
      if (c === '"' || c === "'") quote = c;
      else if (c === '>') {
        inTag = false;
        from = i + 1;
      }
    } else if (c === '<' || c === GAP) {
      if (inRun(i)) return true;
      inTag = c === '<';
      from = i + 1;
    }
  }
  return !inTag && inRun(markup.length);
};

/** True when expat would refuse the text for a reason xmldom does not report. */
export const isRefusedByExpat = (text: string): boolean => {
  if (INVALID_CHAR.test(text)) {
    return true;
  }
  const markup = stripSpans(text, VERBATIM, GAP);
  return (
    BARE_AMPERSAND.test(markup) ||
    hasCdataEndInText(markup) ||
    hasBadReference(markup)
  );
};

const stopAt = (text: string, stop: RegExp, from: number): number => {
  stop.lastIndex = from;
  return stop.exec(text)?.index ?? text.length;
};

/**
 * Counts what /xmlns(?::[^\s=>/]*)?\s*=/g matches, stopping as soon as the
 * cap is passed. Not that regex: on "xmlns:xmlns:…" every match attempt scans
 * to the end of the run, which is quadratic (600 KB took 29 s). Here a prefix
 * run, and the blanks after it, are scanned once however many attempts start
 * inside the run.
 */
export const hasTooManyNamespaceDeclarations = (text: string): boolean => {
  let count = 0;
  let prefixEnd = -1;
  let blanksAfterPrefix = -1;
  for (let at = text.indexOf(XMLNS); at >= 0; ) {
    const afterXmlns = at + XMLNS.length;
    let equals = -1;
    if (text[afterXmlns] !== ':') {
      equals = stopAt(text, BLANK_STOP, afterXmlns);
    } else {
      if (afterXmlns >= prefixEnd) {
        prefixEnd = stopAt(text, NAME_STOP, afterXmlns + 1);
        blanksAfterPrefix = stopAt(text, BLANK_STOP, prefixEnd);
      }
      equals = blanksAfterPrefix;
    }
    if (text[equals] !== '=') {
      at = text.indexOf(XMLNS, at + 1);
      continue;
    }
    count++;
    if (count > MAX_NAMESPACE_DECLARATIONS) {
      return true;
    }
    at = text.indexOf(XMLNS, equals + 1);
  }
  return false;
};
