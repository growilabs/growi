import { renderMarkdownToTextHast } from '~/server/service/markdown-pipeline';

import golden from './__fixtures__/rendered-text-golden.json';
import type { MarkdownRange } from './markdown-occurrence';
import {
  anchorForMarkdownRange,
  resolveMarkdownQuoteAnchor,
} from './markdown-quote-anchor';
import { renderedTextWithSourceOf } from './rendered-text-source-map';

/** What the browser's `renderedTextOf` produced for each markdown (research.md「画面の表示テキストの実測」). */
const GOLDEN: Record<string, { md: string; text: string }> = golden;

/**
 * Fixtures whose browser text contains, inside a single block, characters the
 * server cannot produce (the admonition label, the lsx widget), so a quote
 * taken there is not guaranteed to be a browser substring (design.md「既知の制約」).
 */
const BROWSER_ONLY_BLOCK_CONTENT = new Set(['admonition', 'lsx']);

/**
 * Fixtures where the browser inserts characters at a block start (the `#` of a
 * heading, the footnote section heading and `↩`), so only a range spanning
 * from one block into such a block breaks the substring guarantee.
 */
const BROWSER_ADDS_AT_BLOCK_START = new Set([
  'heading',
  'headings2',
  'mixed',
  'footnote',
]);

const blocksOf = (md: string): MarkdownRange[] => {
  const blocks: MarkdownRange[] = [];
  let start = 0;
  for (const separator of md.matchAll(/\n\n+/g)) {
    blocks.push({ start, end: separator.index });
    start = separator.index + separator[0].length;
  }
  blocks.push({ start, end: md.length });
  return blocks;
};

const allRangesWithin = ({ start, end }: MarkdownRange): MarkdownRange[] => {
  const ranges: MarkdownRange[] = [];
  for (let i = start; i < end; i++) {
    for (let j = i + 1; j <= end; j++) {
      ranges.push({ start: i, end: j });
    }
  }
  return ranges;
};

// Distinct bodies get distinct ids, as distinct revisions would.
const asRevision = (body: string) => ({ id: body, body });

const renderWithSource = async (md: string) =>
  renderedTextWithSourceOf(await renderMarkdownToTextHast(md), md);

describe('anchorForMarkdownRange — the browser can find every stored quote', () => {
  const guaranteed = Object.entries(GOLDEN).filter(
    ([name]) => !BROWSER_ONLY_BLOCK_CONTENT.has(name),
  );

  it.each(
    guaranteed,
  )('%s: every range inside one block yields a quote found in the browser text', async (_name, {
    md,
    text: browserText,
  }) => {
    const rendered = await renderWithSource(md);

    const anchors = blocksOf(md)
      .flatMap(allRangesWithin)
      .map((range) => anchorForMarkdownRange(rendered, range))
      .flatMap((result) => (result.kind === 'anchored' ? [result.anchor] : []));

    for (const anchor of anchors) {
      expect(browserText).toContain(anchor.quote);
    }
    // Guards against a vacuous pass: a fixture with visible text anchors something.
    if (browserText.trim() !== '') {
      expect(anchors.length).toBeGreaterThan(0);
    }
  });

  it.each(
    guaranteed.filter(([name]) => !BROWSER_ADDS_AT_BLOCK_START.has(name)),
  )('%s: every range across blocks yields a quote found in the browser text', async (_name, {
    md,
    text: browserText,
  }) => {
    const rendered = await renderWithSource(md);

    for (const range of allRangesWithin({ start: 0, end: md.length })) {
      const result = anchorForMarkdownRange(rendered, range);
      if (result.kind === 'anchored') {
        expect(browserText).toContain(result.anchor.quote);
      }
    }
  });
});

describe('resolveMarkdownQuoteAnchor', () => {
  describe('builds the anchor from the rendered text, not from the markdown', () => {
    it.each([
      [
        'strips the markup of a fully selected **bold**',
        'paragraphs',
        '**bold**',
        'bold',
      ],
      [
        'keeps the text around inline markup',
        'paragraphs',
        'with **bold** and',
        'with bold and',
      ],
      [
        'cuts inside the markup when the range ends there',
        'paragraphs',
        'with **bo',
        'with bo',
      ],
      [
        'joins paragraphs with the rendered newline',
        'paragraphs',
        '*em*.\n\nSecond',
        'em.\nSecond',
      ],
      ['quotes a table cell', 'table', 'c1', 'c1'],
      [
        'quotes a whole table row as its cell text',
        'table',
        '| c1 | d1 |',
        'c1d1',
      ],
      ['quotes inside a fenced code block', 'fencedCode', 'a = 1', 'a = 1'],
      [
        'drops the trailing newline of a whole fenced code block',
        'fencedCode',
        '```js\nconst a = 1;\n```',
        'const a = 1;',
      ],
      [
        'quotes a cell of a csv block rendered as a table',
        'csvFence',
        'v1',
        'v1',
      ],
      ['replaces an emoji shortcode with the emoji', 'emoji', ':smile:', '😄'],
      [
        'keeps the text around an emoji',
        'emoji',
        'hello :smile: world',
        'hello 😄 world',
      ],
      [
        'uses the link text, not the URL',
        'link',
        '[link text](https://example.com)',
        'link text',
      ],
      ['quotes a nested list item', 'list', 'nested', 'nested'],
      [
        'skips formulas inside the range',
        'inlineMath',
        'before $x^2$ after',
        'before  after',
      ],
      [
        'quotes the label of a [[...]] link',
        'pukiwikiLink',
        'see [[Foo]] for',
        'see Foo for',
      ],
      [
        'quotes the label of a [[label>path]] link',
        'pukiwikiLinkWithLabel',
        '[[label>/path]]',
        'label',
      ],
      [
        'skips a growi directive the browser does not show',
        'growiDirectiveBare',
        'cost $HOME here',
        'cost  here',
      ],
      [
        'quotes the text after the heading marker',
        'heading',
        '# Heading One',
        'Heading One',
      ],
    ])('%s', async (_title, fixture, markdownQuote, expectedQuote) => {
      const { md, text: browserText } = GOLDEN[fixture];

      const result = await resolveMarkdownQuoteAnchor(
        asRevision(md),
        markdownQuote,
      );

      expect(result).toEqual({
        kind: 'anchored',
        anchor: expect.objectContaining({ quote: expectedQuote }),
      });
      expect(browserText).toContain(expectedQuote);
    });

    it('quotes a footnote definition written before later text, though it is rendered at the end', async () => {
      const md = 'a[^1]\n\n[^1]: :smile: note\n\nlater para';

      const result = await resolveMarkdownQuoteAnchor(
        asRevision(md),
        ':smile: note',
      );

      expect(result).toEqual({
        kind: 'anchored',
        anchor: expect.objectContaining({ quote: '😄 note' }),
      });
    });

    it('anchors a range near the end of a long paragraph full of entities', async () => {
      const md = `${'あ&hearts;'.repeat(40_000)} target end`;

      const result = await resolveMarkdownQuoteAnchor(asRevision(md), 'target');

      expect(result).toEqual({
        kind: 'anchored',
        anchor: {
          quote: 'target',
          prefix: `${'あ♥'.repeat(20)} `.slice(-40),
          suffix: ' end',
          approxOffset: 'あ♥'.length * 40_000 + 1,
        },
      });
    });

    it('unescapes markdown escapes and entities', async () => {
      const result = await resolveMarkdownQuoteAnchor(
        asRevision('a \\*b\\* &amp; c'),
        '\\*b\\*',
      );

      expect(result).toEqual({
        kind: 'anchored',
        anchor: expect.objectContaining({ quote: '*b*' }),
      });
    });

    it('takes prefix, suffix and approxOffset from the rendered text', async () => {
      const md = `${'**word** '.repeat(10)}TARGET${' *tail*'.repeat(10)}`;
      const renderedBefore = 'word '.repeat(10);
      const renderedAfter = ' tail'.repeat(10);

      const result = await resolveMarkdownQuoteAnchor(asRevision(md), 'TARGET');

      expect(result).toEqual({
        kind: 'anchored',
        anchor: {
          quote: 'TARGET',
          prefix: renderedBefore.slice(-40),
          suffix: renderedAfter.slice(0, 40),
          approxOffset: renderedBefore.length,
        },
      });
    });

    it('anchors the occurrence chosen by the offset', async () => {
      const md = 'same\n\n**same**';

      const result = await resolveMarkdownQuoteAnchor(
        asRevision(md),
        'same',
        8,
      );

      expect(result).toEqual({
        kind: 'anchored',
        anchor: expect.objectContaining({ quote: 'same', approxOffset: 5 }),
      });
    });
  });

  describe('refuses a range that shows no text in the browser', () => {
    it.each([
      [
        'an image only',
        GOLDEN.image.md,
        '![alt text](https://example.com/a.png)',
      ],
      ['an inline formula only', GOLDEN.inlineMath.md, '$x^2$'],
      ['a block formula only', GOLDEN.blockMath.md, '$$\nE=mc^2\n$$'],
      [
        'markup only',
        'see [](https://example.com) here',
        '[](https://example.com)',
      ],
      ['the blank line between paragraphs only', GOLDEN.paragraphs.md, '\n\n'],
      ['a drawio block', GOLDEN.drawioFence.md, 'abc'],
    ])('%s', async (_title, md, markdownQuote) => {
      expect(
        await resolveMarkdownQuoteAnchor(asRevision(md), markdownQuote),
      ).toEqual({
        kind: 'not-anchorable',
      });
    });

    it.each([
      'drawio',
      'mermaid',
      'plantuml',
    ])('refuses a range that reaches into a %s block, even with text before it', async (language) => {
      const md = `before\n\n\`\`\`${language}\ndiagram source\n\`\`\``;

      expect(
        await resolveMarkdownQuoteAnchor(asRevision(md), 'before\n\n```'),
      ).toEqual({
        kind: 'not-anchorable',
      });
    });

    it('refuses a diagram block whose fence carries a title', async () => {
      const md = '```mermaid:My chart\ngraph TD\n```';

      expect(
        await resolveMarkdownQuoteAnchor(asRevision(md), 'graph TD'),
      ).toEqual({
        kind: 'not-anchorable',
      });
    });
  });

  it('leaves diagram source out of the rendered text used for nearby anchors', async () => {
    const md = 'before\n\n```drawio\nlong diagram source\n```\n\nafter';

    const result = await resolveMarkdownQuoteAnchor(asRevision(md), 'after');

    expect(result).toEqual({
      kind: 'anchored',
      anchor: expect.objectContaining({ prefix: 'before\n\n' }),
    });
  });

  it('passes the occurrence errors through', async () => {
    expect(
      await resolveMarkdownQuoteAnchor(asRevision('one two'), 'three'),
    ).toEqual({
      kind: 'not-found',
    });
    expect(await resolveMarkdownQuoteAnchor(asRevision('a b a'), 'a')).toEqual({
      kind: 'ambiguous',
      total: 2,
      candidates: [
        expect.objectContaining({ offset: 0 }),
        expect.objectContaining({ offset: 4 }),
      ],
    });
    expect(
      await resolveMarkdownQuoteAnchor(asRevision('a b a'), 'a', 1),
    ).toEqual({
      kind: 'offset-mismatch',
      total: 2,
      candidates: [
        expect.objectContaining({ offset: 0 }),
        expect.objectContaining({ offset: 4 }),
      ],
    });
  });
});
