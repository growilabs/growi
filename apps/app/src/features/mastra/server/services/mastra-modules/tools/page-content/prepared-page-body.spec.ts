import pako from 'pako';

import { countLines, preparePageBody, sliceLines } from './prepared-page-body';

const DATA_URI = `data:image/png;base64,${'A'.repeat(10_000)}`;
const DIAGRAM =
  '<mxGraphModel><root><mxCell id="2" value="Web" vertex="1" /><mxCell id="3" value="DB" vertex="1" /></root></mxGraphModel>';

describe('preparePageBody', () => {
  describe('embedded content', () => {
    it('replaces a Markdown image whose URL is a data URI', () => {
      const { body } = preparePageBody(`before ![chart](${DATA_URI}) after`);

      expect(body).toBe('before [embedded image] after');
    });

    it('keeps a Markdown image that links to a file', () => {
      const source = 'see ![chart](/attachment/abc.png)';

      expect(preparePageBody(source).body).toBe(source);
    });

    it('replaces only the data URI inside an HTML <img>', () => {
      const { body } = preparePageBody(`<img src="${DATA_URI}" alt="chart">`);

      expect(body).toBe('<img src="[embedded image]" alt="chart">');
    });

    it('replaces an HTML <img> data URI inside a blockquote', () => {
      const { body } = preparePageBody(
        `> quoted\n> <img src="${DATA_URI}">\n> end`,
      );

      expect(body).toBe('> quoted\n> <img src="[embedded image]">\n> end');
    });

    it('replaces the data URI of a reference-style image definition, keeping its label', () => {
      const { body } = preparePageBody(
        `see ![chart][ref]\n\n[ref]: ${DATA_URI}`,
      );

      expect(body).toBe('see ![chart][ref]\n\n[ref]: [embedded image]');
    });

    it('replaces the URL of a link whose text repeats it, not the text', () => {
      const { body } = preparePageBody(
        '[data:text/plain,hi](data:text/plain,hi)',
      );

      expect(body).toBe('[data:text/plain,hi]([embedded data])');
    });

    it('replaces the data URI of a link, keeping its text', () => {
      const { body } = preparePageBody(
        'get [the file](data:application/pdf;base64,JVBERi0xLjQ=) here',
      );

      expect(body).toBe('get [the file]([embedded data]) here');
    });

    it('replaces a non-image data URI inside HTML', () => {
      const { body } = preparePageBody(
        '<a href="data:application/pdf;base64,JVBERi0xLjQ=">the file</a>',
      );

      expect(body).toBe('<a href="[embedded data]">the file</a>');
    });

    it('keeps the closing parenthesis of a CSS url() around a data URI', () => {
      const { body } = preparePageBody(
        '<div style="background:url(data:image/png;base64,AAAA)">hi</div>',
      );

      expect(body).toBe(
        '<div style="background:url([embedded image])">hi</div>',
      );
    });

    it('leaves a word that only ends in "data:" inside HTML alone', () => {
      const source = '<p>metadata:value</p>';

      expect(preparePageBody(source).body).toBe(source);
    });

    it.each([
      [
        'a Markdown image',
        '![chart](DATA:IMAGE/PNG;base64,AAAA)',
        '[embedded image]',
      ],
      [
        'an HTML <img>',
        '<img src="Data:image/png;base64,AAAA">',
        '<img src="[embedded image]">',
      ],
    ])('replaces an upper-case data URI in %s', (_label, source, expected) => {
      expect(preparePageBody(source).body).toBe(expected);
    });

    it('replaces an upper-case data URI of a link', () => {
      const { body } = preparePageBody('[file](DATA:text/plain,hi)');

      expect(body).toBe('[file]([embedded data])');
    });

    it.each([
      ['a backtick fence', `\`\`\`drawio\n${DIAGRAM}\n\`\`\``],
      ['a tilde fence', `~~~drawio\n${DIAGRAM}\n~~~`],
    ])('replaces a drawio code block written with %s', (_label, block) => {
      const { body } = preparePageBody(`# Architecture\n\n${block}\n\nafter`);

      expect(body).toBe(
        '# Architecture\n\n[draw.io diagram: Web / DB]\n\nafter',
      );
    });

    it('replaces a drawio block nested in a list item', () => {
      const { body } = preparePageBody(
        `- item\n\n  \`\`\`drawio\n  ${DIAGRAM}\n  \`\`\`\n- next`,
      );

      expect(body).toBe('- item\n\n  [draw.io diagram: Web / DB]\n- next');
    });

    it('leaves a drawio fence quoted inside another code block alone', () => {
      const source = `\`\`\`\`markdown\n\`\`\`drawio\n${DIAGRAM}\n\`\`\`\n\`\`\`\``;

      expect(preparePageBody(source).body).toBe(source);
    });

    it('leaves a mermaid block alone', () => {
      const source = '```mermaid\ngraph TD\n  A --> B\n```';

      expect(preparePageBody(source).body).toBe(source);
    });

    it('stops inflating compressed drawio blocks once the page has used up its inflate limit', () => {
      const inflatesTo6MiB = Buffer.from(
        pako.deflateRaw(
          `<mxGraphModel><root><mxCell id="2" value="Big" vertex="1" /></root>${'x'.repeat(6 * 1024 * 1024)}</mxGraphModel>`,
        ),
      ).toString('base64');
      const block = `\`\`\`drawio\n${inflatesTo6MiB}\n\`\`\``;

      const { body } = preparePageBody(`${block}\n\n${block}`);

      expect(body).toBe('[draw.io diagram: Big]\n\n[draw.io diagram]');
    });

    it('replaces several embeds in one page, leaving the text between them intact', () => {
      const { body } = preparePageBody(
        `a ![x](${DATA_URI}) b\n\n\`\`\`drawio\n${DIAGRAM}\n\`\`\`\n\nc ![y](${DATA_URI}) d`,
      );

      expect(body).toBe(
        'a [embedded image] b\n\n[draw.io diagram: Web / DB]\n\nc [embedded image] d',
      );
    });
  });

  describe('outline and lines', () => {
    it('numbers outline entries by the replaced body, so they match slice offsets', () => {
      const prepared = preparePageBody(
        `# Top\n\n\`\`\`drawio\n${DIAGRAM}\n${DIAGRAM}\n\`\`\`\n\n## After`,
      );

      expect(prepared.outline).toEqual([
        { line: 1, level: 1, heading: 'Top' },
        { line: 5, level: 2, heading: 'After' },
      ]);
      expect(sliceLines(prepared, 5, 1).slice).toBe('## After');
    });

    it('normalises CRLF line endings', () => {
      const prepared = preparePageBody('L1\r\nL2\r\nL3');

      expect(countLines(prepared)).toBe(3);
      expect(sliceLines(prepared, 1, 3).slice).toBe('L1\nL2\nL3');
    });
  });
});

describe('sliceLines', () => {
  const prepared = preparePageBody('L1\nL2\nL3\nL4\nL5');

  it('returns the requested lines and whether any remain', () => {
    expect(sliceLines(prepared, 2, 2)).toEqual({
      slice: 'L2\nL3',
      hasMore: true,
    });
  });

  it('reports no more lines when the slice reaches the last line', () => {
    expect(sliceLines(prepared, 4, 2)).toEqual({
      slice: 'L4\nL5',
      hasMore: false,
    });
  });

  it('stops at the last line when the slice runs past it', () => {
    expect(sliceLines(prepared, 4, 10)).toEqual({
      slice: 'L4\nL5',
      hasMore: false,
    });
  });

  it('returns an empty slice past the last line', () => {
    expect(sliceLines(prepared, 6, 2)).toEqual({ slice: '', hasMore: false });
  });
});
