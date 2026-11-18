import { buildGrayPng } from './png';
import { buildPptx } from './pptx';
import { anydocMarkdown, readZipEntries, readZipText } from './spec-support';

const THREE_SLIDES = [
  { title: 'Slide One', body: 'first slide body' },
  { title: 'Slide Two', body: 'second slide body' },
  { title: 'Slide Three', body: 'third slide body' },
];

const slideTargets = (pptx: Buffer): string[] => {
  const presentation = readZipText(pptx, 'ppt/presentation.xml');
  const rels = readZipText(pptx, 'ppt/_rels/presentation.xml.rels');
  const ids = [...presentation.matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map(
    (match) => match[1],
  );
  return ids.map((id) => {
    const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(
      rels,
    )?.[1];
    if (target == null) {
      throw new Error(`no relationship for ${id}`);
    }
    return `ppt/${target}`;
  });
};

describe('buildPptx', () => {
  it('lists one slide per input, each pointing at an existing slide part', () => {
    const pptx = buildPptx(THREE_SLIDES);

    const targets = slideTargets(pptx);
    const entries = readZipEntries(pptx);

    expect(targets).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/slide3.xml',
    ]);
    for (const target of targets) {
      expect(entries.has(target)).toBe(true);
    }
  });

  it('gives slides numeric relationship ids, as python-pptx does', () => {
    const presentation = readZipText(
      buildPptx(THREE_SLIDES),
      'ppt/presentation.xml',
    );

    expect(presentation).toMatch(/r:id="rId\d+"\/><\/p:sldIdLst>/);
  });

  it('writes titles as headings and body text as bullets in anydoc output', async () => {
    const markdown = await anydocMarkdown(buildPptx(THREE_SLIDES), 'pptx');

    expect(markdown).toBe(
      '## Slide One\n\n- first slide body\n\n' +
        '## Slide Two\n\n- second slide body\n\n' +
        '## Slide Three\n\n- third slide body\n',
    );
  });

  it('marks the title as the placeholder python-pptx treats as the title (idx 0)', () => {
    const slide = readZipText(
      buildPptx([{ title: 'Only Title' }]),
      'ppt/slides/slide1.xml',
    );

    expect(slide).toMatch(/<p:ph type="title"\/>/);
    expect(slide).not.toContain('idx="1"');
  });

  it('splits body text into one paragraph per line', async () => {
    const markdown = await anydocMarkdown(
      buildPptx([{ title: 'Lines', body: 'line one\nline two' }]),
      'pptx',
    );

    expect(markdown).toContain('- line one\n- line two');
  });
});

const SMALL_PNG = buildGrayPng(8, Buffer.alloc(64, 128));

describe('buildPptx shapes beyond the placeholders', () => {
  it('writes speaker notes as a notes slide that anydoc includes', async () => {
    const pptx = buildPptx([
      { title: 'With notes', notes: 'speaker notes text' },
    ]);

    expect(readZipText(pptx, 'ppt/slides/_rels/slide1.xml.rels')).toContain(
      'Target="../notesSlides/notesSlide1.xml"',
    );
    expect(await anydocMarkdown(pptx, 'pptx')).toContain('speaker notes text');
  });

  it('embeds each picture as a media part with its alt text', () => {
    const pptx = buildPptx([
      {
        title: 'Pictures',
        pictures: [
          { image: SMALL_PNG },
          { image: SMALL_PNG, description: 'A cat\n\nsecond line' },
        ],
      },
    ]);

    const slide = readZipText(pptx, 'ppt/slides/slide1.xml');
    const rels = readZipText(pptx, 'ppt/slides/_rels/slide1.xml.rels');
    expect(readZipEntries(pptx).get('ppt/media/image2.png')).toEqual(SMALL_PNG);
    expect(rels).toContain('Target="../media/image1.png"');
    expect(rels).toContain('Target="../media/image2.png"');
    // python-pptx names a picture after its file when no alt text is given.
    expect(slide).toContain('descr="image.png"');
    expect(slide).toContain('descr="A cat&#10;&#10;second line"');
    expect(readZipText(pptx, '[Content_Types].xml')).toContain(
      'Extension="png" ContentType="image/png"',
    );
  });

  it('writes pictures, then the group, then text boxes, then the table, in that order', async () => {
    const pptx = buildPptx([
      {
        title: 'Shapes',
        pictures: [{ image: SMALL_PNG, description: 'first picture' }],
        group: {
          pictures: [{ image: SMALL_PNG, description: 'grouped picture' }],
          textboxes: ['grouped text'],
        },
        textboxes: ['loose text'],
        table: [
          ['head A', 'head B'],
          ['cell 1', 'cell 2'],
        ],
      },
    ]);

    const slide = readZipText(pptx, 'ppt/slides/slide1.xml');
    const markdown = await anydocMarkdown(pptx, 'pptx');

    const order = ['first picture', '<p:grpSp>', 'loose text', '<a:tbl>'].map(
      (marker) => slide.indexOf(marker),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(slide.indexOf('grouped picture')).toBeLessThan(
      slide.indexOf('</p:grpSp>'),
    );
    expect(markdown).toContain('grouped text');
    expect(markdown).toContain('loose text');
    expect(markdown).toContain('| head A | head B |');
    expect(markdown).toContain('| cell 1 | cell 2 |');
  });

  it('marks a hidden slide with show="0" and leaves others unmarked', () => {
    const pptx = buildPptx([
      { title: 'Shown' },
      { title: 'Hidden', hidden: true },
    ]);

    expect(readZipText(pptx, 'ppt/slides/slide1.xml')).not.toContain('show=');
    expect(readZipText(pptx, 'ppt/slides/slide2.xml')).toMatch(
      /<p:sld [^>]*show="0"/,
    );
  });

  it('writes a vertical tab as a line break inside the paragraph, as python-pptx does', async () => {
    const pptx = buildPptx([{ textboxes: ['end\vof deck'] }]);

    expect(readZipText(pptx, 'ppt/slides/slide1.xml')).toContain(
      '<a:t>end</a:t></a:r><a:br/><a:r><a:t>of deck</a:t>',
    );
    // anydoc writes the break as a Markdown hard break.
    expect(await anydocMarkdown(pptx, 'pptx')).toBe('end\\\nof deck\n');
  });
});
