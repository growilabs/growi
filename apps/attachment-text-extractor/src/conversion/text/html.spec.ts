import { encodeText } from '../../../test/fixtures/text-encoding';
import { htmlToText } from './html';

const html = (markup: string): string => htmlToText(Buffer.from(markup));

const elapsedMs = (run: () => void): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe('htmlToText', () => {
  it('extracts text with block newlines', () => {
    const out = html(
      '<body><h1>Title</h1><p>Hello <b>big</b> world</p><ul><li>one</li><li>two</li></ul></body>',
    );

    expect(out).toBe('Title\nHello big world\none\ntwo');
  });

  it.each([
    'script',
    'style',
    'template',
    'noscript',
    'svg',
  ])('drops the content of <%s>', (tag) => {
    expect(
      html(`<p>before</p><${tag}>SECRET <b>inner</b></${tag}><p>after</p>`),
    ).toBe('before\nafter');
  });

  it('drops a script inside svg and keeps the text after it', () => {
    const out = html(
      '<p>a</p><svg><script>alert(1)</script><text>vector</text></svg><p>b</p>',
    );

    expect(out).toBe('a\nb');
  });

  it('does not let a self-closing svg swallow the rest', () => {
    expect(html('<p>a</p><svg/><p>b</p>')).toBe('a\nb');
  });

  it('drops only the tail after an unclosed script', () => {
    expect(html('<p>keep</p><script>var x = 1; <p>gone</p>')).toBe('keep');
  });

  it('drops comments and CDATA and survives unterminated constructs', () => {
    expect(html('<p>a</p><!-- hidden --><p>b</p>')).toBe('a\nb');
    expect(html('<p>a</p><![CDATA[ cdata ]]><p>b</p>')).toBe('a\nb');
    expect(html('<p>a</p><!-- never closed')).toBe('a');
    expect(html("<p>a</p><div attr='never closed")).toBe('a');
    expect(html('<p>a</p><![CDATA[ never closed')).toBe('a');
  });

  it('decodes entities and turns invalid numeric references into U+FFFD', () => {
    expect(html('<p>Tom &amp; Jerry &lt;3 &#12354;</p>')).toBe(
      'Tom & Jerry <3 あ',
    );
    expect(html('<p>x&#0;y &#xD800;z &#99999999;w</p>')).toBe(
      'x\uFFFDy \uFFFDz \uFFFDw',
    );
  });

  it('decodes with the charset declared by <meta charset>', () => {
    const body = encodeText('привет', 'koi8-r');

    const declared = htmlToText(
      Buffer.concat([
        Buffer.from('<meta charset="koi8-r"><p>'),
        body,
        Buffer.from('</p>'),
      ]),
    );
    const undeclared = htmlToText(
      Buffer.concat([Buffer.from('<p>'), body, Buffer.from('</p>')]),
    );

    expect(declared).toBe('привет');
    expect(undeclared).not.toBe('привет');
  });

  it('lets a declared charset win over bytes that are valid UTF-8', () => {
    const out = htmlToText(
      Buffer.concat([
        Buffer.from('<meta charset="windows-1252"><p>caf'),
        Buffer.from([0xc3, 0xa9]),
        Buffer.from('</p>'),
      ]),
    );

    expect(out).toBe('cafÃ©');
  });

  it('decodes with the charset of an http-equiv Content-Type', () => {
    const head = Buffer.from(
      '<meta http-equiv="Content-Type" content="text/html; charset=KOI8-R">',
    );

    const out = htmlToText(
      Buffer.concat([head, encodeText('<p>привет</p>', 'koi8-r')]),
    );

    expect(out).toBe('привет');
  });

  it.each([
    'no-such-codec',
    'unicode_escape',
    'utf-16',
    'utf-7',
    '../../x',
    'a'.repeat(5000),
  ])('ignores a hostile declared charset (%#)', (declared) => {
    const out = html(`<meta charset="${declared}"><p>plain ascii body</p>`);

    expect(out).toBe('plain ascii body');
  });

  // Linear: about 0.3 s. Every input here would take minutes if each token
  // rescanned the rest of the line.
  it('converts a ten-megabyte single line in linear time', () => {
    let out = '';
    const ms = elapsedMs(() => {
      out = html(`<p>${'word '.repeat(2_000_000)}</p>`);
    });

    expect(ms).toBeLessThan(3_000);
    expect(out.startsWith('word word')).toBe(true);
  });

  // research.md 18.5.1 tightened Python's 10 s to 1 s: linear takes about
  // 40 ms, an open-element stack about 3 s.
  it('converts a hundred thousand nested divs without recursion', () => {
    let out = '';
    const ms = elapsedMs(() => {
      out = html(`${'<div>'.repeat(100_000)}deep${'</div>'.repeat(100_000)}`);
    });

    expect(ms).toBeLessThan(1_000);
    expect(out).toBe('deep');
  });

  it('converts many unclosed tags without quadratic time', () => {
    const outs: string[] = [];
    const ms = elapsedMs(() => {
      outs.push(html('<a '.repeat(100_000)));
      outs.push(html('<!--'.repeat(100_000)));
      outs.push(html('<'.repeat(200_000)));
    });

    expect(ms).toBeLessThan(1_000);
    // The document ends inside an unclosed start tag: Python prints nothing,
    // Node may print the tag name at the end (research.md 18.7-8), so either is
    // accepted; the rest must match Python.
    expect(outs[0]).toMatch(/^(?:<?a)?$/);
    expect(outs.slice(1)).toEqual(['', '<'.repeat(200_000)]);
  });

  it('keeps an ideographic space and collapses ASCII spaces', () => {
    expect(html('<p>a\u3000b   c\t\td</p>')).toBe('a\u3000b c d');
  });

  it('trims lines and drops blank lines', () => {
    expect(html('<p>  a  </p>\n\n\n<p>   </p><p>b</p>')).toBe('a\nb');
  });

  it('never lets a lone surrogate reach the result', () => {
    const out = htmlToText(
      Buffer.concat([
        Buffer.from('<p>a&#xD800;b '),
        Buffer.from([0xed, 0xa0, 0x80]),
        Buffer.from(' c</p>'),
      ]),
    );

    expect(out.isWellFormed()).toBe(true);
    expect(out.startsWith('a\uFFFDb ')).toBe(true);
  });
});

// Inputs and expected outputs checked against the Python service's
// _html_to_text (research.md 18.5.1 "32 additional inputs").
describe('htmlToText matches the Python service on ordinary markup', () => {
  it.each([
    [
      'table cells',
      '<table><tr><td>c1</td><td>c2</td></tr><tr><th>h</th><td>d</td></tr></table>',
      'c1 c2\nh d',
    ],
    ['unclosed table cells', '<table><tr><td>c1<td>c2</table>', 'c1 c2'],
    ['<br> in both forms', 'a<br>b<br/>c', 'a\nb\nc'],
    ['unclosed <p>', '<p>one<p>two<p>three', 'one\ntwo\nthree'],
    ['<pre>', '<pre>  a\n    b  </pre>', 'a\nb'],
    ['references without a semicolon', '<p>a&nbspb &amp c</p>', 'a\u00A0b & c'],
    [
      'tags inside <textarea>',
      '<textarea><b>x</b> &amp; y</textarea><p>z</p>',
      '<b>x</b> & y\nz',
    ],
    [
      'tags inside <iframe>',
      '<iframe><p>inner</p></iframe><p>after</p>',
      '<p>inner</p>\nafter',
    ],
    ['upper-case tags', '<P>A</P><DIV>B</DIV><SCRIPT>s</SCRIPT>', 'A\nB'],
    [
      'a script that writes a split end tag',
      '<script>document.write("</scr" + "ipt>");</script><p>after</p>',
      'after',
    ],
    ['a comment closed by --!>', '<p>a</p><!-- c --!><p>b</p>', 'a\nb'],
    [
      'DOCTYPE and a processing instruction',
      '<!DOCTYPE html><?xml version="1.0"?><p>body</p>',
      'body',
    ],
    ['<math>', '<p>a</p><math><mi>x</mi></math><p>b</p>', 'a\nx\nb'],
    ['">" inside an attribute', '<a title="x > y">link</a>', 'link'],
    ['an unclosed comment', '<p>a</p><!-- open <p>b</p>', 'a'],
    ['text after an svg', '<svg><text>v</text></svg>after', 'after'],
    ['<xmp>', '<xmp><b>raw</b></xmp>', '<b>raw</b>'],
    ['<plaintext>', '<p>a</p><plaintext><b>raw</b>', 'a\n<b>raw</b>'],
    ['<noembed>', '<noembed><p>n</p></noembed><p>m</p>', '<p>n</p>\nm'],
    ['<title>', '<title>T &amp; U</title><p>b</p>', 'T & U\nb'],
    [
      'nested and upper-case references',
      '<p>&amp;amp; &AMP; &Eacute;</p>',
      '&amp; & É',
    ],
  ])('%s', (_name, markup, expected) => {
    expect(html(markup)).toBe(expected);
  });
});

// research.md 18.7 item 8: the only differences from the Python service left
// after 18.5.1. The Node output keeps more text, never less, so both are
// accepted; a later fix that matches Python must not fail these tests.
describe('htmlToText where Node may differ from the Python service', () => {
  it('keeps the text before a start tag left open at the end of the document (Node may append the tag name)', () => {
    expect(['本文', '本文\np']).toContain(html('<p>本文</p><p'));
  });

  it('keeps the text around "<!-->" (Node closes the empty comment like WHATWG and may keep the text up to "-->")', () => {
    expect(['a\nb', 'a\n本文-->\nb']).toContain(
      html('<p>a</p><!-->本文--><p>b</p>'),
    );
    expect(html('<p>a</p><!-->本文')).toBe('a\n本文');
  });
});
