import { inflateSync } from 'node:zlib';

// A minimal text reader for the PDFs Chromium writes, independent of anydoc
// and of the service's PDF library: per page, each text object (BT ... ET)
// becomes one line, its glyph codes mapped through the font's ToUnicode CMap.
// Chromium writes one text object per printed line (or column, in vertical
// writing), glyphs in reading order, which is what lets a spec see where a
// line ends. It reads only what Chromium writes (2-byte codes, Tj / TJ).

interface PdfObject {
  readonly dict: string;
  readonly stream?: Buffer;
}

const readObjects = (pdf: Buffer): Map<number, PdfObject> => {
  const text = pdf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  for (const match of text.matchAll(/(\d+) 0 obj\b/g)) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endobj', start);
    const body = text.slice(start, end);
    const streamAt = body.search(/\bstream\r?\n/);
    if (streamAt < 0) {
      objects.set(Number(match[1]), { dict: body });
      continue;
    }
    const dict = body.slice(0, streamAt);
    const length = Number(dict.match(/\/Length (\d+)/)?.[1]);
    const dataStart = start + body.indexOf('\n', streamAt) + 1;
    const raw = pdf.subarray(dataStart, dataStart + length);
    const stream = /\/FlateDecode/.test(dict) ? inflateSync(raw) : raw;
    objects.set(Number(match[1]), { dict, stream });
  }
  return objects;
};

const refs = (value: string): number[] =>
  [...value.matchAll(/(\d+) 0 R/g)].map(([, id]) => Number(id));

const objectAt = (objects: Map<number, PdfObject>, id: number): PdfObject => {
  const object = objects.get(id);
  if (object == null) {
    throw new Error(`no PDF object ${id}`);
  }
  return object;
};

const utf16be = (hex: string): string =>
  Buffer.from(hex, 'hex').swap16().toString('utf16le');

const hexPlus = (hex: string, offset: number): string =>
  (Number.parseInt(hex, 16) + offset).toString(16).padStart(hex.length, '0');

// bfchar: <code> <unicode>; bfrange: <lo> <hi> <unicode> | [<u1> <u2> ...].
const readToUnicode = (cmap: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const [, body] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, unicode] of body.matchAll(/<(\w+)>\s*<(\w+)>/g)) {
      map.set(code.toLowerCase(), utf16be(unicode));
    }
  }
  for (const [, body] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const ranges = body.matchAll(/<(\w+)>\s*<(\w+)>\s*(<\w+>|\[[^\]]*\])/g);
    for (const [, lo, hi, target] of ranges) {
      const targets = [...target.matchAll(/<(\w+)>/g)].map(([, t]) => t);
      const count = Number.parseInt(hi, 16) - Number.parseInt(lo, 16);
      for (let i = 0; i <= count; i++) {
        const unicode = target.startsWith('[')
          ? targets[i]
          : hexPlus(targets[0], i);
        map.set(hexPlus(lo, i).toLowerCase(), utf16be(unicode));
      }
    }
  }
  return map;
};

const textObjectLine = (
  textObject: string,
  toUnicode: Map<string, string>,
): string =>
  [...textObject.matchAll(/<([0-9a-fA-F]+)>/g)]
    .flatMap(([, hex]) => hex.toLowerCase().match(/.{4}/g) ?? [])
    .map((code) => toUnicode.get(code) ?? '�')
    .join('');

/** The text of each page in page order; one line per text object. */
export const pdfPageTexts = (pdf: Buffer): string[] => {
  const objects = readObjects(pdf);
  const all = [...objects.values()];
  const toUnicode = new Map(
    all
      .flatMap(({ dict }) => refs(dict.match(/\/ToUnicode \d+ 0 R/)?.[0] ?? ''))
      .flatMap((id) => [
        ...readToUnicode(
          objectAt(objects, id).stream?.toString('latin1') ?? '',
        ),
      ]),
  );
  const pagesNode = all.find(({ dict }) => /\/Type\s*\/Pages\b/.test(dict));
  const kids = refs(pagesNode?.dict.match(/\/Kids\s*\[([^\]]*)\]/)?.[1] ?? '');
  return kids.map((pageId) => {
    const contents = objectAt(objects, pageId).dict.match(
      /\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/,
    )?.[1];
    const content = refs(contents ?? '')
      .map((id) => objectAt(objects, id).stream?.toString('latin1') ?? '')
      .join('\n');
    return [...content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)]
      .map(([, textObject]) => textObjectLine(textObject, toUnicode))
      .join('\n');
  });
};
