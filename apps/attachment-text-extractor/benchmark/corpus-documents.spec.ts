import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BENCHMARK_CORPUS_DIR, type DocumentAnswer } from './answers';
import { GENERATED_DOCUMENTS } from './corpus';
import { isPlainCharacter } from './plain-character';
import {
  decodeText,
  pageTexts,
  textDecoderLabel,
  xlsxSheetNames,
} from './spec-support';

// Characters the user ruled out of the Shift_JIS / EUC-JP / ISO-2022-JP
// documents: iconv-lite cannot write 〜, and ～ has no JIS X 0208 code
// (research.md 9.10).
const WAVE_DASHES = /[〜～]/u;
const LEGACY_JAPANESE_ENCODINGS = new Set([
  'shift_jis',
  'cp932',
  'euc-jp',
  'iso-2022-jp',
]);
const BYTE_ORDER_MARKS: Record<string, Buffer> = {
  'utf-8-bom': Buffer.from([0xef, 0xbb, 0xbf]),
  'utf-16le-bom': Buffer.from([0xff, 0xfe]),
  'utf-16be-bom': Buffer.from([0xfe, 0xff]),
};
// <meta charset="..."> or <meta http-equiv="Content-Type" content="...; charset=...">.
const META_CHARSET = /<meta\b[^>]*\bcharset=["']?([\w-]+)/i;
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi;

const committedBytes = (answer: DocumentAnswer): Buffer =>
  readFileSync(join(BENCHMARK_CORPUS_DIR, answer.fileName));

const cases = GENERATED_DOCUMENTS.map(
  (document) => [document.answer.fileName, document] as const,
);

describe.each(cases)('%s', (_fileName, { answer, build }) => {
  it('builds the same bytes every time, and the committed file is that build', () => {
    const first = build();

    expect(build().equals(first)).toBe(true);
    expect(committedBytes(answer).equals(first)).toBe(true);
  });

  it('holds every expected phrase on its expected page, and on no other page', async () => {
    const pages = await pageTexts(committedBytes(answer), answer);

    expect(pages).toHaveLength(answer.expectedPages.length);
    for (const phrase of answer.phrases) {
      const holding = pages.flatMap((text, index) =>
        text.includes(phrase.text) ? [index + 1] : [],
      );
      expect({ phrase: phrase.text, pages: holding }).toEqual({
        phrase: phrase.text,
        pages: [phrase.page],
      });
    }
  });
});

describe.each(
  cases.filter(([, { answer }]) => answer.format === 'xlsx'),
)('%s sheets', (_fileName, { answer }) => {
  it('are named and ordered as the expected pages say', () => {
    expect(xlsxSheetNames(committedBytes(answer))).toEqual(
      answer.expectedPages.map((page) => page.sheetName),
    );
  });
});

describe.each(
  cases.filter(([, { answer }]) => answer.encoding != null),
)('%s bytes', (_fileName, { answer }) => {
  const encoding = answer.encoding ?? 'utf-8';

  it('decode strictly in the declared encoding', () => {
    expect(() => decodeText(committedBytes(answer), encoding)).not.toThrow();
  });

  it('start with a byte order mark exactly when the encoding has one', () => {
    const bytes = committedBytes(answer);
    const marks = Object.values(BYTE_ORDER_MARKS).filter((mark) =>
      bytes.subarray(0, mark.length).equals(mark),
    );

    expect(marks).toEqual(
      encoding in BYTE_ORDER_MARKS ? [BYTE_ORDER_MARKS[encoding]] : [],
    );
  });

  it.runIf(LEGACY_JAPANESE_ENCODINGS.has(encoding))(
    'read as UTF-8 yield none of the Japanese phrases, so the service has to detect the charset',
    () => {
      const asUtf8 = new TextDecoder('utf-8').decode(committedBytes(answer));
      const japanese = answer.phrases.filter((phrase) =>
        /[^\x20-\x7e]/.test(phrase.text),
      );

      expect(japanese.length).toBeGreaterThan(0);
      for (const phrase of japanese) {
        expect(asUtf8).not.toContain(phrase.text);
      }
    },
  );

  it.runIf(LEGACY_JAPANESE_ENCODINGS.has(encoding))(
    'hold no wave dash or fullwidth tilde',
    () => {
      expect(decodeText(committedBytes(answer), encoding)).not.toMatch(
        WAVE_DASHES,
      );
    },
  );
});

describe.each(
  cases.filter(([, { answer }]) => answer.features.includes('meta-charset')),
)('%s meta charset', (_fileName, { answer }) => {
  it('names the encoding the file is written in', () => {
    const source = decodeText(
      committedBytes(answer),
      answer.encoding ?? 'utf-8',
    );
    const declared = source.match(META_CHARSET)?.[1];

    expect(declared).toBeDefined();
    expect(new TextDecoder(declared).encoding).toBe(
      new TextDecoder(textDecoderLabel(answer.encoding ?? 'utf-8')).encoding,
    );
  });
});

describe.each(
  cases.filter(([, { answer }]) => answer.features.includes('script-style')),
)('%s script and style', (_fileName, { answer }) => {
  it('hold every phrase that must stay out of the extracted text', () => {
    const source = decodeText(
      committedBytes(answer),
      answer.encoding ?? 'utf-8',
    );
    const hidden = [...source.matchAll(SCRIPT_OR_STYLE)]
      .map((match) => match[2])
      .join('\n');

    expect(answer.absentPhrases?.length ?? 0).toBeGreaterThan(0);
    for (const phrase of answer.absentPhrases ?? []) {
      expect(hidden).toContain(phrase);
    }
  });

  // Otherwise a correct extraction, which keeps the body, would be marked
  // down for leaking them.
  it('leave none of those phrases in the body, even with whitespace ignored', () => {
    const body = decodeText(committedBytes(answer), answer.encoding ?? 'utf-8')
      .replace(SCRIPT_OR_STYLE, '')
      .replace(/\s+/gu, '');

    expect(answer.absentPhrases?.length ?? 0).toBeGreaterThan(0);
    for (const phrase of answer.absentPhrases ?? []) {
      expect(body).not.toContain(phrase.replace(/\s+/gu, ''));
    }
  });
});

// Documents without declared source characters (the Apache POI copies) are
// not scored for mojibake; answers.spec checks which documents declare them.
describe.each(
  cases.filter(([, { answer }]) => answer.sourceCharacters != null),
)('%s source characters', (_fileName, { answer }) => {
  it('declare every character the file holds beyond printable ASCII and whitespace', async () => {
    const held = new Set(
      (await pageTexts(committedBytes(answer), answer)).join('\n'),
    );
    const declared = new Set(answer.sourceCharacters ?? '');
    const undeclared = [...held].filter(
      (char) => !isPlainCharacter(char) && !declared.has(char),
    );

    expect(undeclared).toEqual([]);
  });
});
