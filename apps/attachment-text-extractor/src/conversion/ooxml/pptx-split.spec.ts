import { readFileSync } from 'node:fs';
import { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc';

import {
  buildAbsoluteTargetDeck,
  buildArtefactDeck,
  buildContractDeck,
  buildDeckWithPictures,
  buildDeckWithText,
  buildEncryptedPptx,
  buildEntityExpansionRelationshipsDeck,
  buildLargeImagesPptx,
  buildPptx,
  buildUnknownEncodingDeck,
  buildUnsafeTargetDeck,
  buildZip,
  editPart,
  LEGACY_PPT_PATH,
  NOTES_DECK_SLIDE_RELS,
  PLAIN_DOCUMENTS,
  pptxParts,
  replaceOrThrow,
  UNKNOWN_ENCODING_PARTS,
  withRelationship,
} from '../../../test/fixtures';
import { RELATIONSHIPS_NS } from '../../../test/fixtures/ooxml-package';
import {
  readZipDirectory,
  readZipText,
} from '../../../test/fixtures/spec-support';
import type { PageInfo } from '../../contract';
import { conversionErrorOf, conversionLimits } from '../spec-support';
import { convertPptx } from './pptx-split';

// anydoc is the external boundary: the real converter still runs, and the
// spy only records which package went in and what came out.
vi.mock('@firecrawl/anydoc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@firecrawl/anydoc')>();
  return { ...actual, toMarkdownBytes: vi.fn(actual.toMarkdownBytes) };
});

const MIB = 1024 * 1024;
const PRESENTATION = 'ppt/presentation.xml';
const PPTX = formatFromExtension('pptx');
const CUSTOM_XML_TYPE = `${RELATIONSHIPS_NS}/customXml`;
const SLIDE_TYPE = `${RELATIONSHIPS_NS}/slide`;

const anydoc = vi.mocked(toMarkdownBytes);

beforeEach(() => {
  anydoc.mockClear();
});

const limits = conversionLimits;

const sentPackages = (): Buffer[] =>
  anydoc.mock.calls.map(([bytes]) => Buffer.from(bytes));

const sentFormats = (): unknown[] =>
  anydoc.mock.calls.map(([, format]) => format);

const returnedMarkdown = async (): Promise<string[]> =>
  Promise.all(anydoc.mock.results.map((result) => result.value));

const namesIn = (zip: Buffer): string[] =>
  (readZipDirectory(zip) ?? []).map((entry) => entry.name);

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// anydoc separates slides with one blank line and emits nothing for a slide without text.
const joined = (pages: readonly PageInfo[]): string =>
  pages
    .filter((page) => page.content !== '')
    .map((page) => page.content)
    .join('\n');

const notesDeckWith = (name: string, edit: (xml: string) => string): Buffer =>
  buildZip(
    editPart(
      pptxParts([
        {
          title: 'Slide with notes',
          notes: 'notes reached through an absolute target',
        },
      ]),
      name,
      edit,
    ),
  );

const repeatSlideEntries = (xml: string, times: number): string => {
  const entry = /<p:sldId [^>]*\/>/.exec(xml)?.[0];
  if (entry == null) {
    throw new Error('presentation.xml has no slide entry');
  }
  return xml.replace(entry, entry.repeat(times));
};

let largeImagesDeck: Buffer | undefined;
const lazyLargeImagesDeck = (): Buffer => {
  largeImagesDeck ??= buildLargeImagesPptx();
  return largeImagesDeck;
};

// What Python's `_clean` makes of anydoc's whole-deck output for the
// artefact deck: auto alt-text lines and soft line-break markers removed.
const ARTEFACT_DECK_CLEANED =
  '## Artefacts\n\nDisclaimer: AI-generated content may be incorrect.\n\n> line one\n> line two\n\n## Last\n\nend\nof deck\n';

describe('splitting does not change the text anydoc produces', () => {
  it.each([
    ['contract', buildContractDeck, null],
    ['pptx_multi_slide', PLAIN_DOCUMENTS.pptxMultiSlide.build, null],
    ['pptx_large_images_path', lazyLargeImagesDeck, null],
    ['absolute_targets', buildAbsoluteTargetDeck, null],
    ['artefacts', buildArtefactDeck, ARTEFACT_DECK_CLEANED],
  ])(
    'joined slides equal converting the whole deck at once (%s)',
    async (_source, build, cleaned) => {
      const deck = build();
      const whole = await toMarkdownBytes(deck, PPTX);
      anydoc.mockClear();

      const pages = await convertPptx(deck, limits());

      const perSlide = await returnedMarkdown();
      expect(perSlide.filter((text) => text !== '').join('\n')).toBe(whole);
      expect(joined(pages)).toBe(cleaned ?? whole);
    },
    60_000,
  );
});

describe('one element per slide', () => {
  it('numbers the elements in presentation order', async () => {
    const pages = await convertPptx(buildContractDeck(), limits());

    expect(pages.map((page) => [page.pageNumber, page.label])).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => [n, String(n)]),
    );
    expect(pages[0].content).toContain('Moved to the front');
    expect(pages[1].content).toContain('Opening slide');
    expect(pages[1].content).toContain('speaker notes for the opening');
    expect(pages[2].content).toContain('| head A | head B |');
    expect(pages[3].content).toContain('grouped text');
  });

  it('keeps a hidden slide at its position', async () => {
    const pages = await convertPptx(buildContractDeck(), limits());

    expect(pages[4].content).toContain('Hidden slide');
  });

  it('keeps the element and number of a slide without text', async () => {
    const pages = await convertPptx(buildContractDeck(), limits());

    expect(pages[5]).toEqual({ pageNumber: 6, label: '6', content: '' });
  });

  it('returns one element per slide of the fixture deck', async () => {
    const pages = await convertPptx(
      PLAIN_DOCUMENTS.pptxMultiSlide.build(),
      limits(),
    );

    expect(pages.map((page) => page.label)).toEqual(['1', '2', '3']);
    expect(
      pages.map((page) => page.content.includes('second slide body')),
    ).toEqual([false, true, false]);
  });
});

describe('what each per-slide package contains', () => {
  it('holds one slide and only XML parts in each package', async () => {
    await convertPptx(buildContractDeck(), limits());

    const packages = sentPackages();
    expect(packages).toHaveLength(6);
    expect(sentFormats()).toEqual(Array(6).fill(PPTX));
    for (const pkg of packages) {
      const names = namesIn(pkg);
      expect(
        names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)),
      ).toHaveLength(1);
      expect(
        names.every((name) => name.endsWith('.xml') || name.endsWith('.rels')),
      ).toBe(true);
      expect(readZipText(pkg, PRESENTATION).split('sldId ')).toHaveLength(2);
    }
  });

  it('leaves large images out of the packages', async () => {
    const pages = await convertPptx(lazyLargeImagesDeck(), limits());

    const packages = sentPackages();
    expect(pages).toHaveLength(12);
    expect(packages).toHaveLength(12);
    expect(pages[0].content).toContain('slide with images follows');
    expect(Math.max(...packages.map((pkg) => pkg.length))).toBeLessThan(MIB);
  }, 60_000);
});

describe('packages that do not pass the ZIP pre-check go to anydoc whole', () => {
  it('hands an encrypted PPTX over whole and reports encrypted', async () => {
    const deck = buildEncryptedPptx();

    const error = await conversionErrorOf(() => convertPptx(deck, limits()));

    expect(error.kind).toBe('encrypted');
    expect(sentPackages()).toHaveLength(1);
    expect(sameBytes(sentPackages()[0], deck)).toBe(true);
    expect(sentFormats()).toEqual([PPTX]);
  });

  it('hands a non-ZIP input over whole as pptx', async () => {
    const data = readFileSync(LEGACY_PPT_PATH);

    await conversionErrorOf(() => convertPptx(data, limits()));

    expect(sentPackages()).toHaveLength(1);
    expect(sameBytes(sentPackages()[0], data)).toBe(true);
    expect(sentFormats()).toEqual([PPTX]);
  });

  it('returns the whole-file output as one unnumbered, cleaned element', async () => {
    anydoc.mockResolvedValueOnce('whole text\\\nnext\n');

    const pages = await convertPptx(Buffer.from('not a zip at all'), limits());

    expect(pages).toEqual([
      { pageNumber: null, label: null, content: 'whole text\nnext\n' },
    ]);
  });
});

describe('cleanup of PowerPoint artefacts in anydoc output', () => {
  const AUTO_ALT_TEXTS = [
    'A screenshot of a computer\n\nAI-generated content may be incorrect.',
    'A picture containing text\n\nDescription automatically generated',
    'A close up of a sign\n\nDescription automatically generated with medium confidence',
    'テキスト が含まれている画像\n\n自動的に生成された説明',
    'コンピューターのスクリーンショット\n\nAI 生成コンテンツは誤りを含む可能性があります。',
  ];

  const FIXED_SENTENCES = [
    'AI-generated content may be incorrect.',
    'Description automatically generated',
    'Description automatically generated with high confidence',
    '自動的に生成された説明',
    'AI 生成コンテンツは誤りを含む可能性があります。',
  ];

  const TEMPLATES = [
    'Disclaimer: {}',
    '社内ルール: {}',
    '| table-ish line {}',
    '{}',
    'Figure 3.\v{}',
  ];

  it('removes alt text PowerPoint generated automatically', async () => {
    const [page] = await convertPptx(
      buildDeckWithPictures(AUTO_ALT_TEXTS),
      limits(),
    );

    for (const marker of [
      'screenshot',
      'picture containing',
      'close up',
      'grouped chart',
      '画像',
      '自動的',
      'AI',
    ]) {
      expect(page.content).not.toContain(marker);
    }
    expect(page.content).toBe(
      '## Pictures\n\ngrouped caption\n\nafter pictures\n',
    );
  });

  it.each(
    TEMPLATES.flatMap((template) =>
      FIXED_SENTENCES.map((sentence): [string, string] => [template, sentence]),
    ),
  )('keeps author text ending with a fixed sentence (%j, %j)', async (template, sentence) => {
    const text = template.replace('{}', sentence);

    const [page] = await convertPptx(buildDeckWithText(text), limits());

    expect(page.content).toBe(`${text.replaceAll('\v', '\n')}\n`);
  });

  it.each(
    FIXED_SENTENCES,
  )('keeps notes ending with a fixed sentence (%s)', async (sentence) => {
    const deck = buildPptx([
      { title: 'Notes', notes: `Speaker: remember ${sentence}` },
    ]);

    const [page] = await convertPptx(deck, limits());

    expect(page.content).toContain(`Speaker: remember ${sentence}`);
  });

  it('keeps alt text the author wrote', async () => {
    const [page] = await convertPptx(
      buildDeckWithPictures(['Network diagram of the office']),
      limits(),
    );

    expect(page.content).toContain('Network diagram of the office');
  });

  it('removes line-break markers at the end of lines', async () => {
    const [page] = await convertPptx(
      buildDeckWithText('first line\vsecond line\vthird line'),
      limits(),
    );

    expect(page.content).toBe('first line\nsecond line\nthird line\n');
  });

  it('keeps an escaped backslash the author typed', async () => {
    const [page] = await convertPptx(
      buildDeckWithText('path C:\\\vnext line'),
      limits(),
    );

    // anydoc escapes a literal backslash as "\\"; only the line-break marker after it goes.
    expect(page.content).toBe('path C:\\\\\nnext line\n');
  });
});

describe('relationship targets are resolved inside the package only', () => {
  it('resolves absolute relationship targets', async () => {
    const [page] = await convertPptx(buildAbsoluteTargetDeck(), limits());

    expect(page.content).toContain('notes reached through an absolute target');
  });

  it.each([
    ['../../../outside.xml', false],
    ['/../outside.xml', false],
    ['http://example.invalid/remote.xml', true],
    ['../missing/part.xml', false],
  ])('skips an unsafe, external or missing target (%s)', async (target, external) => {
    const [page] = await convertPptx(
      buildUnsafeTargetDeck(target, external),
      limits(),
    );

    expect(page.content).toContain('Slide with notes');
    expect(
      namesIn(sentPackages()[0]).filter(
        (name) =>
          name.includes('outside') ||
          name.includes('missing') ||
          name.includes('remote'),
      ),
    ).toEqual([]);
  });

  it('keeps hyperlinked other slides out of the package', async () => {
    const deck = buildZip(
      editPart(
        pptxParts([{ title: 'Linking slide' }, { title: 'Linked slide' }]),
        NOTES_DECK_SLIDE_RELS,
        (rels) =>
          withRelationship(rels, {
            id: 'rId99',
            type: SLIDE_TYPE,
            target: 'slide2.xml',
          }),
      ),
    );

    const pages = await convertPptx(deck, limits());

    expect(pages.map((page) => page.content.includes('Linked slide'))).toEqual([
      false,
      true,
    ]);
    expect(namesIn(sentPackages()[0])).not.toContain('ppt/slides/slide2.xml');
  });

  it('does not copy the content types part in as a part', async () => {
    const deck = notesDeckWith(NOTES_DECK_SLIDE_RELS, (rels) =>
      withRelationship(rels, {
        id: 'rId98',
        type: CUSTOM_XML_TYPE,
        target: '/[Content_Types].xml',
      }),
    );

    await convertPptx(deck, limits());

    expect(
      namesIn(sentPackages()[0]).filter(
        (name) => name === '[Content_Types].xml',
      ),
    ).toHaveLength(1);
  });
});

describe('limits and malformed packages', () => {
  it('rejects a slide list longer than the entry limit', async () => {
    const deck = buildZip(
      editPart(pptxParts([{ title: 'only slide' }]), PRESENTATION, (xml) =>
        repeatSlideEntries(xml, 200),
      ),
    );
    const entries = (readZipDirectory(deck) ?? []).length;

    const error = await conversionErrorOf(() =>
      convertPptx(deck, limits({ maxArchiveEntries: entries })),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  it('caps the bytes read across slides', async () => {
    const deck = buildZip(
      editPart(
        pptxParts([{ title: 'huge slide', textboxes: ['x'.repeat(400_000)] }]),
        PRESENTATION,
        (xml) => repeatSlideEntries(xml, 3),
      ),
    );
    const declared = (readZipDirectory(deck) ?? []).reduce(
      (sum, entry) => sum + entry.uncompressedSize,
      0,
    );
    expect(declared).toBeLessThan(MIB);

    const error = await conversionErrorOf(() =>
      convertPptx(deck, limits({ maxArchiveUncompressedBytes: MIB })),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  it('treats a presentation.xml that is not well-formed as malformed', async () => {
    const deck = notesDeckWith(PRESENTATION, (xml) =>
      xml.slice(0, Math.floor(xml.length / 2)),
    );

    const error = await conversionErrorOf(() => convertPptx(deck, limits()));

    expect(error.kind).toBe('malformed');
  });

  it.each(
    UNKNOWN_ENCODING_PARTS,
  )('treats an unknown encoding in the XML declaration as malformed (%s)', async (part) => {
    const error = await conversionErrorOf(() =>
      convertPptx(buildUnknownEncodingDeck(part), limits()),
    );

    expect(error.kind).toBe('malformed');
  });

  it('refuses entity expansion in the relationships as malformed', async () => {
    const error = await conversionErrorOf(() =>
      convertPptx(buildEntityExpansionRelationshipsDeck(), limits()),
    );

    expect(error.kind).toBe('malformed');
  });

  it('treats a slide entry pointing at no relationship as malformed', async () => {
    const deck = notesDeckWith(PRESENTATION, (xml) =>
      replaceOrThrow(
        xml,
        /r:id="rId\d+"\/><\/p:sldIdLst>/,
        'r:id="rId404"/></p:sldIdLst>',
      ),
    );

    const error = await conversionErrorOf(() => convertPptx(deck, limits()));

    expect(error.kind).toBe('malformed');
  });

  it('returns no elements for a presentation without slides', async () => {
    expect(await convertPptx(buildPptx([]), limits())).toEqual([]);
  });
});
