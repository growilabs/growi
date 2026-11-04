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
