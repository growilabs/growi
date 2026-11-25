import { htmlToText } from './html';

// Hostile and tag-soup HTML from research.md 18.5.1 / 18.5.8 / 18.10. Every
// expected text is the Python service's output for the same input.

const html = (markup: string): string => htmlToText(Buffer.from(markup));

const timed = (
  markup: string,
): { readonly out: string; readonly ms: number } => {
  const bytes = Buffer.from(markup);
  const start = performance.now();
  const out = htmlToText(bytes);
  return { out, ms: performance.now() - start };
};

// One criterion per timing test: an absolute cap. Each input is sized so the
// linear converter (prototype, research.md 18.9) stays at least 10x under the
// cap and a quadratic one (an open-element stack, or an end tag rescanning
// the rest of the document) goes at least 10x over it.
const CAP_MS = 1_000;

describe('htmlToText with self-closing special tags (htmlparser2 recognizeSelfClosing)', () => {
  it.each([
    [
      'an iframe closed by "/>" inside noscript',
      '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-X" height="0" width="0"/></noscript><p>会議の議事録</p><p>来期の計画</p>',
      '会議の議事録\n来期の計画',
    ],
    [
      'a script closed by "/>" inside template',
      '<template><script src="a.js"/></template><h1>見出し</h1><p>本文</p>',
      '見出し\n本文',
    ],
    [
      'a style closed by "/>" inside svg',
      '<svg><style/></svg><p>本文が消える</p>',
      '本文が消える',
    ],
    [
      'a script closed by " />"',
      '<script src="a.js" /><p>Hello</p><script>var secret=1;</script><p>World</p>',
      'Hello\nWorld',
    ],
    [
      'a textarea closed by "/>"',
      '<p>前</p><textarea/><p>後 &amp; 続き</p>',
      '前\n後 & 続き',
    ],
    ['a title closed by "/>"', '<title/><p>本文</p>', '本文'],
    ['a bare script closed by "/>"', '<script src="a"/><p>x</p>', 'x'],
    [
      'a bare iframe closed by "/>" inside noscript',
      '<noscript><iframe src="x" height="0"/></noscript><p>本文</p>',
      '本文',
    ],
  ])('does not read the rest as raw text after %s', (_name, markup, expected) => {
    expect(html(markup)).toBe(expected);
  });
});

describe('htmlToText with "/ >" (a plain start tag for Python and WHATWG)', () => {
  it('[guards htmlparser2 private field recognizeSelfClosing] reads <title / > as an open title', () => {
    expect(html('<title / >t</title><p>after</p>')).toBe('t\nafter');
  });

  it('reads <script / > as an open script whose body is dropped', () => {
    expect(html('<script / >var x = 1;</script><p>after</p>')).toBe('after');
  });

  it('reads an unknown <x / > as a plain start tag', () => {
    expect(html('<p>a</p><x / ><p>b</p>')).toBe('a\nb');
  });

  it('[guards htmlparser2 private field recognizeSelfClosing] keeps markup inside <title / > as title text', () => {
    expect(html('<title / ><b>x</b></title><p>after</p>')).toBe(
      '<b>x</b>\nafter',
    );
  });

  it('[guards htmlparser2 private field recognizeSelfClosing] keeps a comment opener inside <script / > as script text', () => {
    expect(html('<script / ><!--</script>--><p>after</p>')).toBe('-->\nafter');
  });
});

describe('htmlToText with references in title and textarea', () => {
  it.each([
    [
      'a named reference right after "<" in title',
      '<title>a<&amp;b</title>',
      'a<&b',
    ],
    [
      'numeric references right after "<" in title',
      '<title>x<&#12354;&#12356;</title>',
      'x<あい',
    ],
    [
      'a named reference right after "<" in textarea',
      '<textarea>a<&amp;b</textarea>',
      'a<&b',
    ],
  ])('decodes %s', (_name, markup, expected) => {
    expect(html(markup)).toBe(expected);
  });

  it('drops the numeric references Python drops (C0/C1 controls, noncharacters)', () => {
    expect(
      html('<p>a&#1;b &#x7f;c &#xFFFF;d &#x10FFFF;e &#xFDD0;f &#11;g</p>'),
    ).toBe('ab c d e f g');
  });
});

describe('htmlToText with end tags read in Python grammar', () => {
  it('[guards htmlparser2 private field index] skips a quoted ">" inside an end tag', () => {
    expect(html('<p>前</p></p a="><script>">本文<p>後</p>')).toBe(
      '前\n本文\n後',
    );
  });

  it('skips a quoted "<b>" inside an end tag that starts with "</p<"', () => {
    expect(html('<p>a</p></p<<input value="<b>"><p>b</p>')).toBe('a\nb');
  });

  it('closes a script at an end tag whose quoted attribute holds ">"', () => {
    expect(html('<script>var a;</script x=">">t')).toBe('t');
  });

  it('drops the rest of the document after an end tag that ">" never closes', () => {
    expect(html('<p>keep</p></a x=">tail text')).toBe('keep');
  });

  // Linear: about 3 ms. The quadratic form (each end tag rescanning the rest
  // of the document) took 22 s at this size (research.md 18.5.1).
  it('converts 40,000 end tags not closed by ">" (</a x=">">) in linear time', () => {
    const { out, ms } = timed(`<p>a</p>${'</a x=">"'.repeat(40_000)}`);

    expect(ms).toBeLessThan(CAP_MS);
    expect(out).toBe('a');
  });

  it('converts an end tag with 2,000,000 attributes without throwing', () => {
    const markup = `<p>before</p></a${' x'.repeat(2_000_000)}><p>after</p>`;

    expect(html(markup)).toBe('before\nafter');
  });
});

// research.md 18.5.1: N = 25,000 / 100,000 with htmlparser2's Parser took
// 1.3 / 19.4 s, 0.5 / 9.7 s, 0.2 / 0.6 s and 0.04 / 0.6 s; measured again
// here at 200,000 / 400,000 they extrapolate to more than 10 s, while the
// Tokenizer form stays under 100 ms.
describe('htmlToText with open-element stacking shapes', () => {
  it.each([
    [
      'open <div> then a stray </svg>',
      (n: number) => '<div>'.repeat(n) + '</svg>'.repeat(n),
      200_000,
      '',
    ],
    [
      'nested <div> closed',
      (n: number) => `${'<div>'.repeat(n)}x${'</div>'.repeat(n)}`,
      200_000,
      'x',
    ],
    [
      'unclosed <font>x',
      (n: number) => '<font>x'.repeat(n),
      400_000,
      'x'.repeat(400_000),
    ],
    [
      'unclosed <span> nesting',
      (n: number) => `${'<span>'.repeat(n)}y`,
      400_000,
      'y',
    ],
  ])('converts %s in linear time', (_name, build, n, expected) => {
    const { out, ms } = timed(build(n));

    expect(ms).toBeLessThan(CAP_MS);
    expect(out).toBe(expected);
  });
});

// research.md 18.5.8: shapes aimed at the end-tag reader, the "/ >" handling
// and the reference handling. A quadratic reader rescans about half of the
// 0.6-2.5 MB input per tag, about 10^10 steps at these sizes.
describe('htmlToText with hostile shapes from the fuzzing table', () => {
  it.each([
    [
      '"<&" references in title',
      (n: number) => `<title>${'<&amp;&#12354;'.repeat(n)}</title>`,
      100_000,
      '<&あ'.repeat(100_000),
    ],
    [
      '"<x / >" start tags',
      (n: number) => '<title / >t</title><p / >'.repeat(n),
      50_000,
      Array.from({ length: 50_000 }, () => 't').join('\n'),
    ],
    [
      'end tags with ">" in a quoted attribute',
      (n: number) => '</p a=">">x'.repeat(n),
      100_000,
      Array.from({ length: 100_000 }, () => 'x').join('\n'),
    ],
    [
      'one end tag full of quotes',
      (n: number) => `</a ${'"\'= x/'.repeat(n)}>t`,
      400_000,
      't',
    ],
    [
      'end tags whose quotes pair across tags',
      (n: number) => '</a b="x></a c=\'y>'.repeat(n),
      100_000,
      '',
    ],
    [
      'end tags not closed by ">" after a script',
      (n: number) => `<script>${'</script x=">"'.repeat(n)}`,
      100_000,
      '',
    ],
    [
      'numeric references Python drops',
      (n: number) => `<p>${'&#1;&#xFFFF;'.repeat(n)}</p>`,
      100_000,
      '',
    ],
  ])('converts %s in linear time', (_name, build, n, expected) => {
    const { out, ms } = timed(build(n));

    expect(ms).toBeLessThan(CAP_MS);
    expect(out).toBe(expected);
  });
});
