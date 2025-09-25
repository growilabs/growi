/**
 * @typedef {import('../src/micromark-extension-growi-directive/index.js').HtmlOptions} HtmlOptions
 * @typedef {import('../src/micromark-extension-growi-directive/index.js').Handle} Handle
 */

import { htmlVoidElements } from 'html-void-elements';
import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';

import { DirectiveType } from '../src/mdast-util-growi-directive/lib/index.js';
import {
  directiveHtml as html,
  directive as syntax,
} from '../src/micromark-extension-growi-directive/index.js';

const own = {}.hasOwnProperty;

describe('micromark-extension-directive (syntax)', () => {
  describe('text', () => {
    it('should support an escaped colon which would otherwise be a directive', () => {
      expect(micromark('\\$a', options())).toBe('<p>$a</p>');
    });

    it('should support a directive after an escaped colon', () => {
      expect(micromark('\\$$a', options())).toBe('<p>$</p>');
    });

    // it('should not support a directive after a colon', () => {
    //   expect(micromark('a :$b', options())).toBe('<p>a :$b</p>');
    // });

    it('should not support a colon not followed by an alpha', () => {
      expect(micromark('$', options())).toBe('<p>$</p>');
    });

    it('should support a colon followed by an alpha', () => {
      expect(micromark('a $a', options())).toBe('<p>a </p>');
    });

    it('should not support a colon followed by a digit', () => {
      expect(micromark('$9', options())).toBe('<p>$9</p>');
    });

    it('should not support a colon followed by a dash', () => {
      expect(micromark('$-', options())).toBe('<p>$-</p>');
    });

    it('should not support a colon followed by an underscore', () => {
      expect(micromark('$_', options())).toBe('<p>$_</p>');
    });

    it('should support a digit in a name', () => {
      expect(micromark('a $a9', options())).toBe('<p>a </p>');
    });

    it('should support a dash in a name', () => {
      expect(micromark('a $a-b', options())).toBe('<p>a </p>');
    });

    it('should *not* support a dash at the end of a name', () => {
      expect(micromark('$a-', options())).toBe('<p>$a-</p>');
    });

    it('should support an underscore in a name', () => {
      expect(micromark('a $a_b', options())).toBe('<p>a </p>');
    });

    it('should *not* support an underscore at the end of a name', () => {
      expect(micromark('$a_', options())).toBe('<p>$a_</p>');
    });

    it('should *not* support a colon right after a name', () => {
      expect(micromark('$a$', options())).toBe('<p>$a$</p>');
    });

    it('should not interfere w/ emphasis (`_`)', () => {
      expect(micromark('_$directive_', options())).toBe(
        '<p><em>$directive</em></p>',
      );
    });

    it('should support a name followed by an unclosed `[`', () => {
      expect(micromark('$a[', options())).toBe('<p>[</p>');
    });

    it('should support a name followed by an unclosed `(`', () => {
      expect(micromark('$a(', options())).toBe('<p>(</p>');
    });

    it('should support a name followed by an unclosed `[` w/ content', () => {
      expect(micromark('$a[b', options())).toBe('<p>[b</p>');
    });

    it('should support a name followed by an unclosed `(` w/ content', () => {
      expect(micromark('$a(b', options())).toBe('<p>(b</p>');
    });

    it('should support an empty label', () => {
      expect(micromark('a $a[]', options())).toBe('<p>a </p>');
    });

    it('should support a whitespace only label', () => {
      expect(micromark('a $a[ \t]', options())).toBe('<p>a </p>');
    });

    it('should support an eol in an label', () => {
      expect(micromark('$a[\n]', options())).toBe('<p></p>');
    });

    it('should support content in an label', () => {
      expect(micromark('$a[a b c]asd', options())).toBe('<p>asd</p>');
    });

    it('should support markdown in an label', () => {
      expect(micromark('$a[a *b* c]asd', options())).toBe('<p>asd</p>');
    });

    // == Resolved as text directive
    // t.equal(
    //   micromark('$a[]asd', options()),
    //   '<p>$a[]asd</p>',
    //   'should not support content after a label',
    // );

    it('should support a directive in an label', () => {
      expect(micromark('a $b[c :d[e] f] g', options())).toBe('<p>a  g</p>');
    });

    it('should support content after a label', () => {
      expect(micromark('$a[]asd', options())).toBe('<p>asd</p>');
    });

    it('should support empty attributes', () => {
      expect(micromark('a $a()', options())).toBe('<p>a </p>');
    });

    it('should support whitespace only attributes', () => {
      expect(micromark('a $a( \t)', options())).toBe('<p>a </p>');
    });

    it('should support an eol in attributes', () => {
      expect(micromark('$a(\n)', options())).toBe('<p></p>');
    });

    it('should support attributes w/o values', () => {
      expect(micromark('a $a(a b c)', options())).toBe('<p>a </p>');
    });

    it('should support attributes w/ unquoted values', () => {
      expect(micromark('a $a(a=b c=d)', options())).toBe('<p>a </p>');
    });

    it('should support attributes w/ class shortcut', () => {
      expect(micromark('a $a(.a .b)', options())).toBe('<p>a </p>');
    });

    it('should support attributes w/ class shortcut w/o whitespace between', () => {
      expect(micromark('a $a(.a.b)', options())).toBe('<p>a </p>');
    });

    it('should support attributes w/ id shortcut', () => {
      expect(micromark('a $a(#a #b)', options())).toBe('<p>a </p>');
    });

    it('should support attributes w/ id shortcut w/o whitespace between', () => {
      expect(micromark('a $a(#a#b)', options())).toBe('<p>a </p>');
    });

    it('should support attributes w/ shortcuts combined w/ other attributes', () => {
      expect(micromark('a $a(#a.b.c#d e f=g #h.i.j)', options())).toBe(
        '<p>a </p>',
      );
    });

    it('should support attrs which starts w/ continuous dots', () => {
      expect(micromark('a $a(..b)', options())).toBe('<p>a </p>');
    });

    it('should support attrs which start w/ `#`', () => {
      expect(micromark('a $a(.#b)', options())).toBe('<p>a </p>');
    });

    it('should support attrs w/ (`.`)', () => {
      expect(micromark('a $a(.)', options())).toBe('<p>a </p>');
    });

    it('should support with the attr `(.a=b)`', () => {
      expect(micromark('a $a(.a=b)', options())).toBe('<p>a </p>');
    });

    it('should support with the attr `(.a"b)`', () => {
      expect(micromark('a $a(.a"b)', options())).toBe('<p>a </p>');
    });

    it('should support with the attr `(.a<b)`', () => {
      expect(micromark('a $a(.a<b)', options())).toBe('<p>a </p>');
    });

    it('should support most characters in shortcuts', () => {
      expect(micromark('a $a(.a💚b)', options())).toBe('<p>a </p>');
    });

    it('should support an underscore in attribute names', () => {
      expect(micromark('a $a(_)', options())).toBe('<p>a </p>');
    });

    it('should support a colon in attribute names', () => {
      expect(micromark('a $a(xml:lang)', options())).toBe('<p>a </p>');
    });

    it('should support double quoted attributes', () => {
      expect(micromark('a $a(a="b" c="d e f")', options())).toBe('<p>a </p>');
    });

    it('should support single quoted attributes', () => {
      expect(micromark("a $a(a='b' c='d e f')", options())).toBe('<p>a </p>');
    });

    it('should support whitespace around initializers', () => {
      expect(micromark('a $a(a = b c\t=\t\'d\' f  =\r"g")', options())).toBe(
        '<p>a </p>',
      );
    });

    it('should not support `=` to start an unquoted attribute value', () => {
      expect(micromark('$a(b==)', options())).toBe('<p>(b==)</p>');
    });

    it('should not support a missing attribute value after `=`', () => {
      expect(micromark('$a(b=)', options())).toBe('<p>(b=)</p>');
    });

    it('should not support an apostrophe in an unquoted attribute value', () => {
      expect(micromark("$a(b=c')", options())).toBe("<p>(b=c')</p>");
    });

    it('should not support a grave accent in an unquoted attribute value', () => {
      expect(micromark('$a(b=c`)', options())).toBe('<p>(b=c`)</p>');
    });

    it('should support most other characters in attribute keys', () => {
      expect(micromark('a $a(b💚=a💚b)', options())).toBe('<p>a </p>');
    });

    it('should support most other characters in unquoted attribute values', () => {
      expect(micromark('a $a(b=a💚b)', options())).toBe('<p>a </p>');
    });

    it('should not support an EOF in a quoted attribute value', () => {
      expect(micromark('$a(b="c', options())).toBe('<p>(b=&quot;c</p>');
    });

    it('should support most other characters in quoted attribute values', () => {
      expect(micromark('a $a(b="a💚b")', options())).toBe('<p>a </p>');
    });

    it('should support EOLs in quoted attribute values', () => {
      expect(micromark('$a(b="\nc\r  d")', options())).toBe('<p></p>');
    });

    it('should not support an EOF after a quoted attribute value', () => {
      expect(micromark('$a(b="c"', options())).toBe('<p>(b=&quot;c&quot;</p>');
    });
  });

  describe('leaf', () => {
    it('should support a directive', () => {
      expect(micromark('$b', options())).toBe('');
    });

    it('should not support one colon', () => {
      expect(micromark(':', options())).toBe('<p>:</p>');
    });

    it('should not support two colons not followed by an alpha', () => {
      expect(micromark('::', options())).toBe('<p>::</p>');
    });

    it('should support two colons followed by an alpha', () => {
      expect(micromark('$a', options())).toBe('');
    });

    it('should not support two colons followed by a digit', () => {
      expect(micromark('$9', options())).toBe('<p>$9</p>');
    });

    it('should not support two colons followed by a dash', () => {
      expect(micromark('$-', options())).toBe('<p>$-</p>');
    });

    it('should support a digit in a name', () => {
      expect(micromark('$a9', options())).toBe('');
    });

    it('should support a dash in a name', () => {
      expect(micromark('$a-b', options())).toBe('');
    });

    // == Resolved as text directive
    // it('should not support a name followed by an unclosed `[`', () => {
    //   expect(micromark('$a[', options())).toBe('<p>$a[</p>');
    // });

    // == Resolved as text directive
    // it('should not support a name followed by an unclosed `{`', () => {
    //   expect(micromark('$a{', options())).toBe('<p>$a{</p>');
    // });

    // == Resolved as text directive
    // it('should not support a name followed by an unclosed `[` w/ content', () => {
    //   expect(micromark('$a[b', options())).toBe('<p>$a[b</p>');
    // });

    // == Resolved as text directive
    // it('should not support a name followed by an unclosed `{` w/ content', () => {
    //   expect(micromark('$a{b', options())).toBe('<p>$a{b</p>');
    // });

    it('should support an empty label', () => {
      expect(micromark('$a[]', options())).toBe('');
    });

    it('should support a whitespace only label', () => {
      expect(micromark('$a[ \t]', options())).toBe('');
    });

    // == Resolved as text directive
    // it('should not support an eol in an label', () => {
    //   expect(micromark('$a[\n]', options())).toBe('<p>$a[\n]</p>');
    // });

    it('should support content in an label', () => {
      expect(micromark('$a[a b c]', options())).toBe('');
    });

    it('should support markdown in an label', () => {
      expect(micromark('$a[a *b* c]', options())).toBe('');
    });

    // == Resolved as text directive
    // it('should not support content after a label', () => {
    //   expect(micromark('$a[]asd', options())).toBe('<p>$a[]asd</p>');
    // });

    it('should support empty attributes', () => {
      expect(micromark('$a()', options())).toBe('');
    });

    it('should support whitespace only attributes', () => {
      expect(micromark('$a( \t)', options())).toBe('');
    });

    // == Resolved as text directive
    // it('should not support an eol in attributes', () => {
    //   expect(micromark('$a(\n)', options())).toBe('<p>$a(\n)</p>');
    // });

    it('should support attributes w/o values', () => {
      expect(micromark('$a(a b c)', options())).toBe('');
    });

    it('should support attributes w/ unquoted values', () => {
      expect(micromark('$a(a=b c=d)', options())).toBe('');
    });

    it('should support attributes w/ class shortcut', () => {
      expect(micromark('$a(.a .b)', options())).toBe('');
    });

    it('should support attributes w/ id shortcut', () => {
      expect(micromark('$a(#a #b)', options())).toBe('');
    });

    it('should support most characters in shortcuts', () => {
      expect(micromark('$a(.a💚b)', options())).toBe('');
    });

    it('should support double quoted attributes', () => {
      expect(micromark('$a(a="b" c="d e f")', options())).toBe('');
    });

    it('should support single quoted attributes', () => {
      expect(micromark("$a(a='b' c='d e f')", options())).toBe('');
    });

    it('should support whitespace around initializers', () => {
      expect(micromark("$a(a = b c\t=\t'd')", options())).toBe('');
    });

    // == Resolved as text directive
    // it('should not support EOLs around initializers', () => {
    //   expect(micromark('$a(f  =\rg)', options())).toBe('<p>$a(f  =\rg)</p>');
    // });

    // == Resolved as text directive
    // it('should not support `=` to start an unquoted attribute value', () => {
    //   expect(micromark('$a(b==)', options())).toBe('<p>$a(b==)</p>');
    // });

    it('should support most other characters in attribute keys', () => {
      expect(micromark('$a(b💚=a💚b)', options())).toBe('');
    });

    it('should support most other characters in unquoted attribute values', () => {
      expect(micromark('$a(b=a💚b)', options())).toBe('');
    });

    it('should not support an EOF in a quoted attribute value', () => {
      expect(micromark('$a(b="c', options())).toBe('<p>(b=&quot;c</p>');
    });

    it('should support most other characters in quoted attribute values', () => {
      expect(micromark('$a(b="a💚b")', options())).toBe('');
    });

    it('should not support EOLs in quoted attribute values', () => {
      expect(micromark('$a(b="\nc\r  d")', options())).toBe('<p></p>');
    });

    it('should not support an EOF after a quoted attribute value', () => {
      expect(micromark('$a(b="c"', options())).toBe('<p>(b=&quot;c&quot;</p>');
    });

    it('should support whitespace after directives', () => {
      expect(micromark('$a(b=c) \t ', options())).toBe('');
    });

    it('should support a block quote after a leaf', () => {
      expect(micromark('$a(b=c)\n>a', options())).toBe(
        '<blockquote>\n<p>a</p>\n</blockquote>',
      );
    });

    it('should support code (fenced) after a leaf', () => {
      expect(micromark('$a(b=c)\n```js\na', options())).toBe(
        '<pre><code class="language-js">a\n</code></pre>\n',
      );
    });

    it('should support code (indented) after a leaf', () => {
      expect(micromark('$a(b=c)\n    a', options())).toBe(
        '<pre><code>a\n</code></pre>',
      );
    });

    it('should support a definition after a leaf', () => {
      expect(micromark('$a(b=c)\n[a]: b', options())).toBe('');
    });

    it('should support a heading (atx) after a leaf', () => {
      expect(micromark('$a(b=c)\n# a', options())).toBe('<h1>a</h1>');
    });

    it('should support a heading (setext) after a leaf', () => {
      expect(micromark('$a(b=c)\na\n=', options())).toBe('<h1>a</h1>');
    });

    it('should support html after a leaf', () => {
      expect(micromark('$a(b=c)\n<!-->', options())).toBe('<!-->');
    });

    it('should support a list after a leaf', () => {
      expect(micromark('$a(b=c)\n* a', options())).toBe(
        '<ul>\n<li>a</li>\n</ul>',
      );
    });

    it('should support a paragraph after a leaf', () => {
      expect(micromark('$a(b=c)\na', options())).toBe('<p>a</p>');
    });

    it('should support a thematic break after a leaf', () => {
      expect(micromark('$a(b=c)\n***', options())).toBe('<hr />');
    });

    it('should support a block quote before a leaf', () => {
      expect(micromark('>a\n$a(b=c)', options())).toBe(
        '<blockquote>\n<p>a</p>\n</blockquote>\n',
      );
    });

    it('should support code (fenced) before a leaf', () => {
      expect(micromark('```js\na\n```\n$a(b=c)', options())).toBe(
        '<pre><code class="language-js">a\n</code></pre>\n',
      );
    });

    it('should support code (indented) before a leaf', () => {
      expect(micromark('    a\n$a(b=c)', options())).toBe(
        '<pre><code>a\n</code></pre>\n',
      );
    });

    it('should support a definition before a leaf', () => {
      expect(micromark('[a]: b\n$a(b=c)', options())).toBe('');
    });

    it('should support a heading (atx) before a leaf', () => {
      expect(micromark('# a\n$a(b=c)', options())).toBe('<h1>a</h1>\n');
    });

    it('should support a heading (setext) before a leaf', () => {
      expect(micromark('a\n=\n$a(b=c)', options())).toBe('<h1>a</h1>\n');
    });

    it('should support html before a leaf', () => {
      expect(micromark('<!-->\n$a(b=c)', options())).toBe('<!-->\n');
    });

    it('should support a list before a leaf', () => {
      expect(micromark('* a\n$a(b=c)', options())).toBe(
        '<ul>\n<li>a</li>\n</ul>\n',
      );
    });

    it('should support a paragraph before a leaf', () => {
      expect(micromark('a\n$a(b=c)', options())).toBe('<p>a</p>\n');
    });

    it('should support a thematic break before a leaf', () => {
      expect(micromark('***\n$a(b=c)', options())).toBe('<hr />\n');
    });

    it('should not support lazyness (1)', () => {
      expect(micromark('> $a\nb', options({ '*': h }))).toBe(
        '<blockquote><a></a>\n</blockquote>\n<p>b</p>',
      );
    });

    it('should not support lazyness (2)', () => {
      expect(micromark('> a\n$b', options({ '*': h }))).toBe(
        '<blockquote>\n<p>a</p>\n</blockquote>\n<b></b>',
      );
    });
  });
});

describe('micromark-extension-directive (compile)', () => {
  it('should support a directives (abbr)', () => {
    expect(
      micromark(
        [
          'a $abbr',
          'a $abbr[HTML]',
          'a $abbr(title="HyperText Markup Language")',
          'a $abbr[HTML](title="HyperText Markup Language")',
        ].join('\n\n'),
        options({ abbr }),
      ),
    ).toBe(
      [
        '<p>a <abbr></abbr></p>',
        '<p>a <abbr>HTML</abbr></p>',
        '<p>a <abbr title="HyperText Markup Language"></abbr></p>',
        '<p>a <abbr title="HyperText Markup Language">HTML</abbr></p>',
      ].join('\n'),
    );
  });

  it('should support directives (youtube)', () => {
    expect(
      micromark(
        [
          'Text:',
          'a $youtube',
          'a $youtube[Cat in a box a]',
          'a $youtube(v=1)',
          'a $youtube[Cat in a box b](v=2)',
          'Leaf:',
          '$youtube',
          '$youtube[Cat in a box c]',
          '$youtube(v=3)',
          '$youtube[Cat in a box d](v=4)',
        ].join('\n\n'),
        options({ youtube }),
      ),
    ).toBe(
      [
        '<p>Text:</p>',
        '<p>a </p>',
        '<p>a </p>',
        '<p>a <iframe src="https://www.youtube.com/embed/1" allowfullscreen></iframe></p>',
        '<p>a <iframe src="https://www.youtube.com/embed/2" allowfullscreen title="Cat in a box b"></iframe></p>',
        '<p>Leaf:</p>',
        '<iframe src="https://www.youtube.com/embed/3" allowfullscreen></iframe>',
        '<iframe src="https://www.youtube.com/embed/4" allowfullscreen title="Cat in a box d"></iframe>',
      ].join('\n'),
    );
  });

  it('should support directives (lsx)', () => {
    expect(
      micromark(
        [
          'Text:',
          'a $lsx',
          'a $lsx()',
          'a $lsx(num=1)',
          'a $lsx(/)',
          'a $lsx(/,num=5,depth=1)',
          'a $lsx(/, num=5, depth=1)',
          'a $lsx(💚)',
          'Leaf:',
          '$lsx',
          '$lsx()',
          '$lsx(num=1)',
          '$lsx(/)',
          '$lsx(/,num=5,depth=1)',
          '$lsx(/, num=5, depth=1)',
          '$lsx(💚)',
        ].join('\n\n'),
        options({ lsx }),
      ),
    ).toBe(
      [
        '<p>Text:</p>',
        '<p>a <lsx ></lsx></p>',
        '<p>a <lsx ></lsx></p>',
        '<p>a <lsx num="1"></lsx></p>',
        '<p>a <lsx prefix="/"></lsx></p>',
        '<p>a <lsx prefix="/" num="5" depth="1"></lsx></p>',
        '<p>a <lsx prefix="/" num="5" depth="1"></lsx></p>',
        '<p>a <lsx prefix="💚"></lsx></p>',
        '<p>Leaf:</p>',
        '<lsx ></lsx>',
        '<lsx ></lsx>',
        '<lsx num="1"></lsx>',
        '<lsx prefix="/"></lsx>',
        '<lsx prefix="/" num="5" depth="1"></lsx>',
        '<lsx prefix="/" num="5" depth="1"></lsx>',
        '<lsx prefix="💚"></lsx>',
      ].join('\n'),
    );
  });

  it('should support fall through directives (`*`)', () => {
    expect(
      micromark(
        'a $youtube[Cat in a box]\n$br a',
        options({ youtube, '*': h }),
      ),
    ).toBe('<p>a <youtube>Cat in a box</youtube>\n<br> a</p>');
  });

  it('should support fall through directives (`*`)', () => {
    expect(
      micromark('a $a[$img(src="x" alt=y)](href="z")', options({ '*': h })),
    ).toBe('<p>a <a href="z"><img src="x" alt="y"></a></p>');
  });
});

describe('content', () => {
  it('should support character escapes and character references in label', () => {
    expect(micromark('a $abbr[x\\&y&amp;z]', options({ abbr }))).toBe(
      '<p>a <abbr>x&amp;y&amp;z</abbr></p>',
    );
  });

  it('should support escaped brackets in a label', () => {
    expect(micromark('a $abbr[x\\[y\\]z]', options({ abbr }))).toBe(
      '<p>a <abbr>x[y]z</abbr></p>',
    );
  });

  it('should support balanced brackets in a label', () => {
    expect(micromark('a $abbr[x[y]z]', options({ abbr }))).toBe(
      '<p>a <abbr>x[y]z</abbr></p>',
    );
  });

  it('should support balanced brackets in a label, 32 levels deep', () => {
    expect(
      micromark(
        'a $abbr[1[2[3[4[5[6[7[8[9[10[11[12[13[14[15[16[17[18[19[20[21[22[23[24[25[26[27[28[29[30[31[32[x]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]',
        options({ abbr }),
      ),
    ).toBe(
      '<p>a <abbr>1[2[3[4[5[6[7[8[9[10[11[12[13[14[15[16[17[18[19[20[21[22[23[24[25[26[27[28[29[30[31[32[x]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]</abbr></p>',
    );
  });

  it('should *not* support balanced brackets in a label, 33 levels deep', () => {
    expect(
      micromark(
        '$abbr[1[2[3[4[5[6[7[8[9[10[11[12[13[14[15[16[17[18[19[20[21[22[23[24[25[26[27[28[29[30[31[32[33[x]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]',
        options({ abbr }),
      ),
    ).toBe(
      '<p><abbr></abbr>[1[2[3[4[5[6[7[8[9[10[11[12[13[14[15[16[17[18[19[20[21[22[23[24[25[26[27[28[29[30[31[32[33[x]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]</p>',
    );
  });

  it('should support EOLs in a label', () => {
    expect(micromark('$abbr[a\nb\rc]', options({ abbr }))).toBe(
      '<p><abbr>a\nb\rc</abbr></p>',
    );
  });

  it('should support EOLs at the edges of a label (1)', () => {
    expect(micromark('$abbr[\na\r]', options({ abbr }))).toBe(
      '<p><abbr>\na\r</abbr></p>',
    );
  });

  it('should support EOLs at the edges of a label (2)', () => {
    expect(micromark('$abbr[\n]', options({ abbr }))).toBe(
      '<p><abbr>\n</abbr></p>',
    );
  });

  // == does not work but I don't know why.. -- 2022.08.12 Yuki Takei
  // it('should support EOLs around nested directives', () => {
  //   expect(micromark('$abbr[a\n$abbr[b]\nc]', options({ abbr })))
  //     .toBe('<p><abbr>a\n<abbr>b</abbr>\nc</abbr></p>');
  // });

  it('should support EOLs inside nested directives (1)', () => {
    expect(micromark('$abbr[$abbr[\n]]', options({ abbr }))).toBe(
      '<p><abbr><abbr>\n</abbr></abbr></p>',
    );
  });

  it('should support EOLs inside nested directives (2)', () => {
    expect(micromark('$abbr[$abbr[a\nb]]', options({ abbr }))).toBe(
      '<p><abbr><abbr>a\nb</abbr></abbr></p>',
    );
  });

  it('should support EOLs inside nested directives (3)', () => {
    expect(micromark('$abbr[$abbr[\nb\n]]', options({ abbr }))).toBe(
      '<p><abbr><abbr>\nb\n</abbr></abbr></p>',
    );
  });

  it('should support EOLs inside nested directives (4)', () => {
    expect(micromark('$abbr[$abbr[\\\n]]', options({ abbr }))).toBe(
      '<p><abbr><abbr><br />\n</abbr></abbr></p>',
    );
  });

  it('should support markdown in a label', () => {
    expect(micromark('a $abbr[a *b* **c** d]', options({ abbr }))).toBe(
      '<p>a <abbr>a <em>b</em> <strong>c</strong> d</abbr></p>',
    );
  });

  it('should support character references in unquoted attribute values', () => {
    expect(micromark('a $abbr(title=a&apos;b)', options({ abbr }))).toBe(
      '<p>a <abbr title="a\'b"></abbr></p>',
    );
  });

  it('should support character references in double attribute values', () => {
    expect(micromark('a $abbr(title="a&apos;b")', options({ abbr }))).toBe(
      '<p>a <abbr title="a\'b"></abbr></p>',
    );
  });

  it('should support character references in single attribute values', () => {
    expect(micromark("a $abbr(title='a&apos;b')", options({ abbr }))).toBe(
      '<p>a <abbr title="a\'b"></abbr></p>',
    );
  });

  it('should support unknown character references in attribute values', () => {
    expect(
      micromark('a $abbr(title="a&somethingelse;b")', options({ abbr })),
    ).toBe('<p>a <abbr title="a&amp;somethingelse;b"></abbr></p>');
  });

  it('should support EOLs between attributes', () => {
    expect(micromark('$span(a\nb)', options({ '*': h }))).toBe(
      '<p><span a="" b=""></span></p>',
    );
  });

  it('should support EOLs at the edges of attributes', () => {
    expect(micromark('$span(\na\n)', options({ '*': h }))).toBe(
      '<p><span a=""></span></p>',
    );
  });

  it('should support EOLs before initializer', () => {
    expect(micromark('$span(a\r= b)', options({ '*': h }))).toBe(
      '<p><span a="b"></span></p>',
    );
  });

  it('should support EOLs after initializer', () => {
    expect(micromark('$span(a=\r\nb)', options({ '*': h }))).toBe(
      '<p><span a="b"></span></p>',
    );
  });

  it('should support EOLs between an unquoted attribute value and a next attribute name', () => {
    expect(micromark('$span(a=b\nc)', options({ '*': h }))).toBe(
      '<p><span a="b" c=""></span></p>',
    );
  });

  it('should support EOLs in a double quoted attribute value', () => {
    expect(micromark('$span(a="b\nc")', options({ '*': h }))).toBe(
      '<p><span a="b\nc"></span></p>',
    );
  });

  it('should support EOLs in a single quoted attribute value', () => {
    expect(micromark("$span(a='b\nc')", options({ '*': h }))).toBe(
      '<p><span a="b\nc"></span></p>',
    );
  });

  it('should support attrs which contains `#` (1)', () => {
    expect(micromark('a $span(#a#b)', options({ '*': h }))).toBe(
      '<p>a <span #a#b=""></span></p>',
    );
  });

  it('should support attrs which contains `#` (2)', () => {
    expect(micromark('a $span(id=a id="b" #c#d)', options({ '*': h }))).toBe(
      '<p>a <span id="b" #c#d=""></span></p>',
    );
  });

  it('should support attrs with dot notation', () => {
    expect(micromark('a $span(.a.b)', options({ '*': h }))).toBe(
      '<p>a <span .a.b=""></span></p>',
    );
  });

  describe('spec for growi plugin', () => {
    it('should support name with slash', () => {
      expect(micromark('a $lsx(/Sandbox)', options())).toBe('<p>a </p>');
    });

    it('should support name=value and an attribute w/o value', () => {
      expect(micromark('a $lsx(key=value, reverse)', options())).toBe(
        '<p>a </p>',
      );
    });

    it('should support consecutive attributes w/o value', () => {
      expect(micromark('a $lsx(key=value, reverse, reverse2)', options())).toBe(
        '<p>a </p>',
      );
    });

    it('should support name=value after an empty value attribute', () => {
      expect(micromark('a $lsx(/Sandbox, key=value, reverse)', options())).toBe(
        '<p>a </p>',
      );
    });
  });
});

/** @type {Handle} */
function abbr(d) {
  if (d.type !== DirectiveType.Text) return false;

  this.tag('<abbr');

  if (d.attributes && 'title' in d.attributes) {
    this.tag(` title="${this.encode(d.attributes.title)}"`);
  }

  this.tag('>');
  this.raw(d.label || '');
  this.tag('</abbr>');
}

/** @type {Handle} */
function youtube(d) {
  const attrs = d.attributes || {};
  const v = attrs.v;
  /** @type {string} */
  let prop;

  if (!v) return false;

  const list = [
    `src="https://www.youtube.com/embed/${this.encode(v)}"`,
    'allowfullscreen',
  ];

  if (d.label) {
    list.push(`title="${this.encode(d.label)}"`);
  }

  // eslint-disable-next-line no-restricted-syntax
  for (prop in attrs) {
    if (prop !== 'v') {
      list.push(`${this.encode(prop)}="${this.encode(attrs[prop])}"`);
    }
  }

  this.tag(`<iframe ${list.join(' ')}>`);

  if (d.content) {
    this.lineEndingIfNeeded();
    this.raw(d.content);
    this.lineEndingIfNeeded();
  }

  this.tag('</iframe>');
}

/** @type {Handle} */
function lsx(d) {
  const attrs = d.attributes || {};

  const props = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const key in attrs) {
    if (attrs[key].length === 0) {
      props.push(`prefix="${key}"`);
    } else {
      props.push(`${key}="${attrs[key]}"`);
    }
  }

  this.tag(`<lsx ${props.join(' ')}>`);
  this.tag('</lsx>');
}

/** @type {Handle} */
function h(d) {
  const content = d.content || d.label;
  const attrs = d.attributes || {};
  /** @type {Array.<string>} */
  const list = [];
  /** @type {string} */
  let prop;

  // eslint-disable-next-line no-restricted-syntax
  for (prop in attrs) {
    if (own.call(attrs, prop)) {
      list.push(`${this.encode(prop)}="${this.encode(attrs[prop])}"`);
    }
  }

  this.tag(`<${d.name}`);
  if (list.length > 0) this.tag(` ${list.join(' ')}`);
  this.tag('>');

  if (content) {
    if (d.type === 'containerGrowiPluginDirective') this.lineEndingIfNeeded();
    this.raw(content);
    if (d.type === 'containerGrowiPluginDirective') this.lineEndingIfNeeded();
  }

  if (!htmlVoidElements.includes(d.name)) this.tag(`</${d.name}>`);
}

/**
 * @param {HtmlOptions} [options]
 */
function options(options) {
  return {
    allowDangerousHtml: true,
    extensions: [syntax()],
    htmlExtensions: [html(options)],
  };
}
