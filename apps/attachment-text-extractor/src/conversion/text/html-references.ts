import { decodeHTML } from 'entities';

import { replaceBatched } from './replace-batched';

const NUMERIC_REFERENCE = /&#(?:([0-9]+)|[xX]([0-9a-fA-F]+));?/g;

/** Code points Python's html.unescape turns into '' when written as a numeric reference. */
export const droppedByPython = (cp: number): boolean =>
  cp <= 0x10ffff &&
  ((cp >= 0x1 && cp <= 0x8) ||
    cp === 0xb ||
    (cp >= 0xe && cp <= 0x1f) ||
    cp === 0x7f ||
    (cp >= 0xfdd0 && cp <= 0xfdef) ||
    (cp & 0xfffe) === 0xfffe);

const dropNumericReferences = (text: string): string =>
  replaceBatched(text, NUMERIC_REFERENCE, ([reference, decimal, hex]) => {
    const cp =
      decimal !== undefined ? Number(decimal) : Number.parseInt(hex ?? '', 16);
    return droppedByPython(cp) ? '' : reference;
  });

/**
 * The htmlparser2 Tokenizer leaves a reference right after "<" inside title /
 * textarea undecoded ("<&amp;"); every other reference there has already gone
 * to ontextentity, so decoding the remaining text once is safe.
 */
export const decodeRcdataText = (text: string): string =>
  text.includes('&') ? decodeHTML(dropNumericReferences(text)) : text;
