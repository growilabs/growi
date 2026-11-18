import { encodeText } from '../../../test/fixtures/text-encoding';
import { xmlToText } from './xml-text';

const xml = (markup: string | Buffer): string =>
  xmlToText(typeof markup === 'string' ? Buffer.from(markup) : markup);

const timed = (
  markup: string | Buffer,
): { readonly out: string; readonly ms: number } => {
  const bytes = typeof markup === 'string' ? Buffer.from(markup) : markup;
  const start = performance.now();
  const out = xmlToText(bytes);
  return { out, ms: performance.now() - start };
};

const lines = (line: string, count: number): string =>
  Array.from({ length: count }, () => line).join('\n');

describe('xmlToText', () => {
  it('strips tags and keeps the text', () => {
    expect(
      xml("<?xml version='1.0'?><root><a>one</a><b x='1'>two</b></root>"),
    ).toBe('one\ntwo');
  });

  it('keeps CDATA and drops comments and processing instructions', () => {
    const out = xml(
      '<r><!-- hidden --><?pi secret?><a><![CDATA[<kept> & raw]]></a></r>',
    );

    expect(out).toBe('<kept> & raw');
  });

  // Python's cap; the output proves nothing was expanded.
  it('does not expand a billion-laughs DOCTYPE', () => {
    const entities = Array.from({ length: 10 }, (_, i) =>
      i === 0
        ? '<!ENTITY lol0 "lol">'
        : `<!ENTITY lol${i} "${`&lol${i - 1};`.repeat(10)}">`,
    ).join('');

    const { out, ms } = timed(
      `<?xml version='1.0'?><!DOCTYPE lolz [${entities}]><lolz>&lol9;</lolz>`,
    );

    expect(ms).toBeLessThan(2_000);
    expect(out).toBe('&lol9;');
  });

  it('removes a whole DOCTYPE with ">" in quotes, comments and entities', () => {
    const doctype =
      '<!DOCTYPE root SYSTEM "a>b.dtd" [<!-- a > b ] --><!ENTITY e "x > y ]"><?pi > ?><!ELEMENT root (#PCDATA)>]>';

    expect(xml(`<?xml version='1.0'?>${doctype}<root>body</root>`)).toBe(
      'body',
    );
  });

  it.each([
    ['<!DOCTYPE x [', 't'],
    ['<!DOCTYPE x "', 't'],
    ["<a b='", 't'],
    ['<!-- x', 't'],
    ['<![CDATA[ x', 't\nx'],
    ['<?pi', 't'],
    ['<', 't'],
  ])('survives the unterminated construct %s', (fragment, expected) => {
    expect(xml(`<r>t</r>${fragment}`)).toBe(expected);
  });

  it('does not leak ">" inside an attribute value into the text', () => {
    expect(xml('<a title="x > y">body</a>')).toBe('body');
  });

  it('decodes predefined and numeric references but not custom entities', () => {
    expect(xml('<a>x &amp; y &lt; &#65; &custom;</a>')).toBe(
      'x & y < A &custom;',
    );
  });

  it('keeps an invalid numeric reference literally', () => {
    expect(xml('<a>&#0; &#xD800; &#99999999;</a>')).toBe(
      '&#0; &#xD800; &#99999999;',
    );
  });

  it('decodes with the encoding the XML declaration names', () => {
    const body = encodeText('привет', 'koi8-r');

    const declared = xml(
      Buffer.concat([
        Buffer.from("<?xml version='1.0' encoding='koi8-r'?><r>"),
        body,
        Buffer.from('</r>'),
      ]),
    );
    const undeclared = xml(
      Buffer.concat([
        Buffer.from("<?xml version='1.0'?><r>"),
        body,
        Buffer.from('</r>'),
      ]),
    );

    expect(declared).toBe('привет');
    expect(undeclared).not.toBe('привет');
  });

  it('ignores a hostile declared encoding', () => {
    expect(xml("<?xml version='1.0' encoding='bogus-enc'?><r>ok</r>")).toBe(
      'ok',
    );
    expect(xml("<?xml version='1.0' encoding='UTF-16'?><r>ok</r>")).toBe('ok');
  });

  // Python's cap (10 s); Python itself takes about 1.2 s. Rescanning the rest
  // per tag would cost about 10^12 steps.
  it('converts a large input in linear time', () => {
    const { out, ms } = timed(`<r>${'<a>x</a>'.repeat(500_000)}</r>`);

    expect(ms).toBeLessThan(10_000);
    expect(out.split('x').length - 1).toBe(500_000);
  }, 20_000);

  // Python's cap (5 s); Python takes about 0.1 s.
  it('converts a start tag with many quoted attributes in linear time', () => {
    const { out, ms } = timed(`<a${" b='x'".repeat(400_000)}>t</a>`);

    expect(ms).toBeLessThan(5_000);
    expect(out).toBe('t');
  }, 20_000);

  // Python's cap (5 s) for the three inputs together; Python takes about
  // 0.2 s.
  it('does not stall on a tag with an unclosed quote or a far ">"', () => {
    const outs: string[] = [];
    const start = performance.now();
    outs.push(xml(`<a b='${'x'.repeat(4_000_000)}`));
    outs.push(xml(`<a ${'x'.repeat(4_000_000)}>t</a>`));
    outs.push(xml(`<a ${'\'"'.repeat(1_000_000)}>t</a>`));
    const ms = performance.now() - start;

    expect(ms).toBeLessThan(5_000);
    expect(outs).toEqual(['', 't', '']);
  }, 20_000);

  // Python's cap (5 s); Python takes about 0.1 s.
  it('converts a DOCTYPE internal subset with many entities in linear time', () => {
    const { out, ms } = timed(
      `<!DOCTYPE r [${"<!ENTITY a 'x'>".repeat(300_000)}]><r>t</r>`,
    );

    expect(ms).toBeLessThan(5_000);
    expect(out).toBe('t');
  }, 20_000);

  it('keeps an ideographic space and collapses ASCII spaces', () => {
    expect(xml('<r>a\u3000b   c</r>')).toBe('a\u3000b c');
  });

  it('trims lines and drops blank lines', () => {
    expect(xml('<r>\n  <a> x </a>\n\n\n  <b>y</b>\n</r>')).toBe('x\ny');
  });

  it('never lets a lone surrogate reach the result', () => {
    const out = xml(
      Buffer.concat([
        Buffer.from('<r>a&#xD800;b '),
        Buffer.from([0xed, 0xa0, 0x80]),
        Buffer.from(' c</r>'),
      ]),
    );

    expect(out.isWellFormed()).toBe(true);
    expect(out.startsWith('a&#xD800;b ')).toBe(true);
  });
});

// Unterminated or repeated markup openers (brief item 4). Python converts
// each in at most 0.4 s; a scanner that rescans the 0.8-2 MB tail from every
// opener needs about 10^11 steps. The 3 s cap keeps a linear converter more
// than 10x under it, and the outputs are Python's.
describe('xmlToText with repeated or unterminated openers', () => {
  it.each([
    ['200,000 unclosed comments', '<!--'.repeat(200_000), ''],
    [
      '200,000 closed comments between texts',
      `<r>${'<!-- c -->t'.repeat(200_000)}</r>`,
      lines('t', 200_000),
    ],
    [
      '200,000 CDATA openers',
      '<![CDATA['.repeat(200_000),
      '<![CDATA['.repeat(199_999),
    ],
    ['200,000 processing-instruction openers', '<?'.repeat(200_000), ''],
    ['800,000 "<"', '<'.repeat(800_000), ''],
    [
      'a DOCTYPE subset of 200,000 unclosed comments',
      `<!DOCTYPE x [${'<!--'.repeat(200_000)}`,
      '',
    ],
    [
      'a DOCTYPE subset of 200,000 comments holding quotes',
      `<!DOCTYPE r [${'<!-- " \' -->'.repeat(200_000)}]><r>t</r>`,
      't',
    ],
    [
      '200,000 references',
      `<r>${'&amp;&#65;&custom;'.repeat(200_000)}</r>`,
      '&A&custom;'.repeat(200_000),
    ],
    ['200,000 unclosed start tags', `<r>${'<a>'.repeat(200_000)}`, ''],
    [
      '200,000 nested elements',
      `${'<a>'.repeat(200_000)}t${'</a>'.repeat(200_000)}`,
      't',
    ],
  ])('converts %s in linear time', (_name, markup, expected) => {
    const { out, ms } = timed(markup);

    expect(ms).toBeLessThan(3_000);
    expect(out).toBe(expected);
  });
});
