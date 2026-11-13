import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SPEC_TMP_PREFIX } from '../../../test/fixtures';
import { conversionErrorOf } from '../spec-support';
import { parseXmlPart, serializeXmlPart } from './safe-xml';

const NS_DOCUMENT =
  '<r:root xmlns:r="urn:r" xmlns:mc="urn:mc" mc:Ignorable="x"><r:child/></r:root>';
const UTF8_DECLARATION = "<?xml version='1.0' encoding='UTF-8'?>";

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8');
const latin1 = (text: string): Buffer => Buffer.from(text, 'latin1');
const utf16le = (text: string): Buffer => Buffer.from(text, 'utf16le');
const utf16be = (text: string): Buffer => utf16le(text).swap16();

const parse = (body: Uint8Array) => parseXmlPart(body, 'part');

const kindOf = async (body: Uint8Array): Promise<string> =>
  (await conversionErrorOf(() => parse(body))).kind;

const elapsedMs = async (run: () => unknown): Promise<number> => {
  const started = performance.now();
  await run();
  return performance.now() - started;
};

// Each level declares its own prefix and is named with the root's, so every
// name lookup walks all declaring ancestors (research.md 18.5.4).
const nestedNamespaceDeclarations = (depth: number): string => {
  const open = Array.from(
    { length: depth },
    (_, i) => `<a:e xmlns:n${i}="urn:${i}">`,
  ).join('');
  return `<a:r xmlns:a="urn:a">${open}${'</a:e>'.repeat(depth)}</a:r>`;
};

describe('parseXmlPart (ports of test_ooxml_xml.py)', () => {
  it('returns the document with its root element', () => {
    const document = parse(bytes(NS_DOCUMENT));

    expect(document.documentElement?.localName).toBe('root');
  });

  it.each([
    ['an unclosed element', bytes('<a><b></a>')],
    ['an empty part', Buffer.alloc(0)],
    [
      'an unknown declared encoding',
      bytes('<?xml version="1.0" encoding="no-such-encoding"?><a/>'),
    ],
    [
      'a UTF-16 declaration over 8-bit bytes',
      bytes('<?xml version="1.0" encoding="UTF-16"?><a/>'),
    ],
  ])('refuses %s as malformed', async (_, body) => {
    expect(await kindOf(body)).toBe('malformed');
  });

  it('refuses entity expansion as malformed', async () => {
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "xxxx"><!ENTITY y "&x;&x;&x;">]><a>&y;</a>';

    expect(await kindOf(bytes(bomb))).toBe('malformed');
  });

  it('names the part in the failure detail', async () => {
    const error = await conversionErrorOf(() =>
      parseXmlPart(bytes('<a>'), 'workbook.xml'),
    );

    expect(error.detail).toContain('workbook.xml');
  });

  it('refuses a malformed part that declares prefixes', async () => {
    expect(await kindOf(bytes('<r:a xmlns:r="urn:r"><b></r:a>'))).toBe(
      'malformed',
    );
  });

  it('keeps the document prefixes when written back', () => {
    const out = serializeXmlPart(parse(bytes(NS_DOCUMENT))).toString('utf8');

    expect(out).toContain('<r:root');
    expect(out).toContain('xmlns:mc="urn:mc"');
    expect(out).toContain('mc:Ignorable="x"');
    expect(out).not.toContain('ns0');
  });

  it('exposes local names without the prefix', () => {
    expect(
      parse(bytes('<x:sheet xmlns:x="urn:x"/>')).documentElement?.localName,
    ).toBe('sheet');
    expect(parse(bytes('<plain/>')).documentElement?.localName).toBe('plain');
  });
});

// Verdicts taken from Python's ooxml_xml.parse (defusedxml / expat), run on
// the same bytes (research.md 18.5.4).
describe('parseXmlPart refuses what expat refuses', () => {
  it.each([
    ['a bare ampersand', bytes('<a>&</a>')],
    [']]> in character data', bytes('<a>]]></a>')],
    ['a character XML does not allow', bytes('<a>\u0001</a>')],
    ['a numeric reference to NUL', bytes('<a>&#0;</a>')],
    ['a numeric reference to U+FFFE', bytes('<a>&#xFFFE;</a>')],
    [
      'an external entity (XXE)',
      bytes(
        '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/hostname">]><a>&x;</a>',
      ),
    ],
    ['a parameter entity', bytes('<!DOCTYPE a [<!ENTITY % p "x">]><a/>')],
    [
      'an internal entity declared but unused',
      bytes('<!DOCTYPE a [<!ENTITY x "y">]><a/>'),
    ],
    ['an undeclared entity', bytes('<a>&nope;</a>')],
    ['an unquoted attribute value', bytes('<a b=c/>')],
    ['attributes without a space between', bytes('<a b="1"c="2"/>')],
    ['the reserved prefix xmlns declared', bytes('<a xmlns:xmlns="u"/>')],
    [
      'a byte windows-1252 leaves undefined in Python',
      latin1('<?xml version="1.0" encoding="windows-1252"?><a>\u0081</a>'),
    ],
    [
      'the encoding name UTF-9',
      bytes('<?xml version="1.0" encoding="UTF-9"?><a/>'),
    ],
    [
      'a multi-byte encoding declaration (Shift_JIS)',
      bytes('<?xml version="1.0" encoding="Shift_JIS"?><a/>'),
    ],
  ])('refuses %s as malformed', async (_, body) => {
    expect(await kindOf(body)).toBe('malformed');
  });

  it('never echoes the file an external entity points at', async () => {
    const dir = await mkdtemp(
      path.join(tmpdir(), `${SPEC_TMP_PREFIX}safe-xml-`),
    );
    try {
      const marker = 'xxe-marker-6f1c2b';
      const target = path.join(dir, 'secret.txt');
      await writeFile(target, marker);
      const body = bytes(
        `<!DOCTYPE a [<!ENTITY x SYSTEM "file://${target}">]><a>&x;</a>`,
      );

      const error = await conversionErrorOf(() => parse(body));

      expect(error.kind).toBe('malformed');
      expect(error.message).not.toContain(marker);
      expect(error.detail).not.toContain(marker);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('parseXmlPart accepts what expat accepts', () => {
  it.each([
    [']]> inside an attribute value', bytes('<a b="]]>"/>')],
    ['a numeric reference to an astral character', bytes('<a>&#x1F600;</a>')],
    [']] and > split by a comment', bytes('<r>]]<!--c-->></r>')],
    [
      '& and ]]> inside comments, CDATA and processing instructions',
      bytes('<r><!-- & ]]> --><![CDATA[ & ]]><?p & ]]>?></r>'),
    ],
    [
      'a DOCTYPE with only a SYSTEM id',
      bytes('<!DOCTYPE a SYSTEM "x.dtd"><a/>'),
    ],
    [
      'a DOCTYPE with only an ELEMENT declaration',
      bytes('<!DOCTYPE a [<!ELEMENT a ANY>]><a/>'),
    ],
    [
      'UTF-16 with a byte order mark',
      Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le('<a>x</a>')]),
    ],
    ['UTF-16LE without a byte order mark', utf16le('<a>x</a>')],
    ['UTF-16BE without a byte order mark', utf16be('<a>x</a>')],
  ])('accepts %s', (_, body) => {
    expect(parse(body).documentElement?.localName).toMatch(/^[ar]$/);
  });

  it('reads the bytes after a UTF-8 BOM in the declared ISO-8859-1, as expat does', () => {
    const body = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      latin1('<?xml version="1.0" encoding="ISO-8859-1"?><a n="Ã©"/>'),
    ]);

    expect(parse(body).documentElement?.getAttribute('n')).toBe('Ã©');
  });

  it('keeps U+0085 and U+2028 in text (XML 1.0 line ends only)', () => {
    const document = parse(bytes('<r>a\u0085b\u2028c</r>'));

    expect(document.documentElement?.textContent).toBe('a\u0085b\u2028c');
  });
});

describe('serializeXmlPart', () => {
  it('writes a UTF-8 declaration in place of the original one', () => {
    const body = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      utf16le('<?xml version="1.0" encoding="UTF-16"?><sheet name="𠮷"/>'),
    ]);

    const out = serializeXmlPart(parse(body));

    expect(out.toString('utf8').startsWith(UTF8_DECLARATION)).toBe(true);
    expect(out.toString('utf8')).not.toContain('UTF-16');
  });

  it('writes back an edited document that parses again', () => {
    const document = parse(
      bytes('<workbook xmlns="urn:w"><sheet name="old"/></workbook>'),
    );
    const sheet = document.getElementsByTagName('sheet').item(0);
    sheet?.setAttribute('name', '売上𠮷');

    const reparsed = parse(serializeXmlPart(document));

    expect(
      reparsed.getElementsByTagName('sheet').item(0)?.getAttribute('name'),
    ).toBe('売上𠮷');
  });

  it('drops the DOCTYPE when writing back', () => {
    const out = serializeXmlPart(
      parse(bytes('<!DOCTYPE r SYSTEM "x.dtd"><r/>')),
    ).toString('utf8');

    expect(out).not.toContain('DOCTYPE');
    expect(out).toContain('<r/>');
  });
});

// Node-specific expectations (research.md 18.7 item 9, 22.6): recorded
// differences from Python's parse, not to be aligned back (Req 2.3).
describe('parseXmlPart where Node deliberately differs from Python', () => {
  it('caps namespace declarations at 1,000 (Python accepts more)', async () => {
    const declarations = (count: number): Buffer =>
      bytes(
        `<r ${Array.from({ length: count }, (_, i) => `xmlns:p${i}="u${i}"`).join(' ')}/>`,
      );

    expect(parse(declarations(1000)).documentElement?.localName).toBe('r');
    expect(await kindOf(declarations(1001))).toBe('limit_exceeded');
  });

  it('counts xmlns= in text toward the cap too (Python accepts it)', async () => {
    expect(await kindOf(bytes(`<r>${'xmlns='.repeat(1001)}</r>`))).toBe(
      'limit_exceeded',
    );
  });

  it('accepts two attributes with the same expanded name (Python refuses: xmldom does not resolve namespaces for this check)', () => {
    const document = parse(
      bytes('<r xmlns:a="u" xmlns:b="u" a:x="1" b:x="2"/>'),
    );

    expect(document.documentElement?.localName).toBe('r');
  });

  it('accepts the WHATWG-only encoding name x-cp1252 (expat refuses it)', () => {
    const body = bytes('<?xml version="1.0" encoding="x-cp1252"?><a/>');

    expect(parse(body).documentElement?.localName).toBe('a');
  });

  it('refuses cp437, which Python has a codec for and WHATWG does not', async () => {
    const body = latin1(
      '<?xml version="1.0" encoding="cp437"?><a n="\u0081"/>',
    );

    expect(await kindOf(body)).toBe('malformed');
  });

  it('does not apply ATTLIST default attributes (expat adds state="hidden")', () => {
    const document = parse(
      bytes('<!DOCTYPE r [<!ATTLIST r state CDATA "hidden">]><r/>'),
    );

    expect(document.documentElement?.hasAttribute('state')).toBe(false);
  });

  it('refuses & inside a quoted DOCTYPE SYSTEM id (Python accepts it)', async () => {
    expect(await kindOf(bytes('<!DOCTYPE r SYSTEM "a&b"><r/>'))).toBe(
      'malformed',
    );
  });
});

// One absolute cap per shape. Each cap is at least 10x above the measured
// linear time and at least 10x below the measured quadratic time of the
// rejected implementations (research.md 18.5.4).
describe('parseXmlPart on hostile input stays linear', () => {
  it('refuses 200,000 unclosed <!-- within 2 s (a lazy regex strip took ~22 s)', async () => {
    const body = bytes(`<r>${'<!--'.repeat(200_000)}</r>`);
    let kind = '';

    const ms = await elapsedMs(async () => {
      kind = await kindOf(body);
    });

    expect(kind).toBe('malformed');
    expect(ms).toBeLessThan(2_000);
  });

  it('refuses 40,000 nested namespace declarations within 1.5 s (xmldom alone took ~15 s)', async () => {
    const body = bytes(nestedNamespaceDeclarations(40_000));
    let kind = '';

    const ms = await elapsedMs(async () => {
      kind = await kindOf(body);
    });

    expect(kind).toBe('limit_exceeded');
    expect(ms).toBeLessThan(1_500);
  });

  it('refuses the same nesting hidden behind <!-- in a DOCTYPE SYSTEM id within 1.5 s', async () => {
    const body = bytes(
      `<!DOCTYPE a:r SYSTEM "<!--">${nestedNamespaceDeclarations(40_000)}<!-- -->`,
    );
    let kind = '';

    const ms = await elapsedMs(async () => {
      kind = await kindOf(body);
    });

    expect(kind).toBe('limit_exceeded');
    expect(ms).toBeLessThan(1_500);
  });

  it('refuses a billion-laughs DOCTYPE within 1 s', async () => {
    const levels = Array.from(
      { length: 9 },
      (_, i) => `<!ENTITY l${i + 1} "${`&l${i};`.repeat(10)}">`,
    ).join('');
    const body = bytes(
      `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY l0 "lol">${levels}]><r>&l9;</r>`,
    );
    let kind = '';

    const ms = await elapsedMs(async () => {
      kind = await kindOf(body);
    });

    expect(kind).toBe('malformed');
    expect(ms).toBeLessThan(1_000);
  });
});
