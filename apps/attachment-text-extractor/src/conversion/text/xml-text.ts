import { decodeText } from './charset';
import { xmlDeclaredEncoding } from './declared-in-head';
import { LineJoiner } from './line-joiner';
import { replaceBatched } from './replace-batched';
import { skipDoctype, skipTag, skipToCloser } from './xml-markup-skip';

// The predefined entities only; custom entities stay literal, so nothing is
// ever expanded.
const PREDEFINED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
const REFERENCE =
  /&(?:(amp|lt|gt|quot|apos)|#([0-9]{1,8})|#x([0-9A-Fa-f]{1,6}));/g;

const isScalarValue = (cp: number): boolean =>
  cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);

const decodeReferences = (text: string): string =>
  replaceBatched(text, REFERENCE, ([reference, named, decimal, hex]) => {
    if (named !== undefined) {
      return PREDEFINED[named] ?? reference;
    }
    const cp =
      decimal !== undefined ? Number(decimal) : Number.parseInt(hex ?? '', 16);
    return isScalarValue(cp) ? String.fromCodePoint(cp) : reference;
  });

const CDATA_OPENER = '<![CDATA[';
const CDATA_CLOSER = ']]>';

// Index past the comment, processing instruction, DOCTYPE or tag at lt (-1
// when it never closes); CDATA is handled by the caller since it keeps text.
const skipMarkup = (markup: string, lt: number): number => {
  if (markup.startsWith('<!--', lt)) {
    return skipToCloser(markup, lt, '<!--', '-->').after;
  }
  if (markup.startsWith('<?', lt)) {
    return skipToCloser(markup, lt, '<?', '?>').after;
  }
  if (markup.slice(lt, lt + 9).toUpperCase() === '<!DOCTYPE') {
    return skipDoctype(markup, lt);
  }
  return skipTag(markup, lt);
};

// The XML is never parsed, so entity expansion (billion laughs) cannot happen.
// A construct that never closes ends the text there instead of failing.
const xmlMarkupToText = (markup: string): string => {
  const lines = new LineJoiner();
  for (let pos = 0; ; ) {
    const lt = markup.indexOf('<', pos);
    if (lt < 0) {
      lines.add(decodeReferences(markup.slice(pos)));
      break;
    }
    lines.add(decodeReferences(markup.slice(pos, lt)));
    let after: number;
    if (markup.startsWith(CDATA_OPENER, lt)) {
      const cdata = skipToCloser(markup, lt, CDATA_OPENER, CDATA_CLOSER);
      const end =
        cdata.after >= 0 ? cdata.after - CDATA_CLOSER.length : markup.length;
      lines.add(markup.slice(cdata.contentStart, end));
      after = cdata.after;
    } else {
      after = skipMarkup(markup, lt);
    }
    if (after < 0) {
      break;
    }
    lines.add('\n');
    pos = after;
  }
  return lines.result();
};

/** Text of an XML document with its tags stripped (never parsed). */
export const xmlToText = (bytes: Uint8Array): string =>
  xmlMarkupToText(decodeText(bytes, xmlDeclaredEncoding(bytes)));
