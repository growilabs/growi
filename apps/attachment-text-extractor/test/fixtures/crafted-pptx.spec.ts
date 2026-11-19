import {
  buildAbsoluteTargetDeck,
  buildArtefactDeck,
  buildContractDeck,
  buildDeckWithPictures,
  buildDeckWithText,
  buildEntityExpansionRelationshipsDeck,
  buildNotesDeck,
  buildUnknownEncodingDeck,
  buildUnsafeTargetDeck,
  NOTES_DECK_SLIDE_RELS,
  UNKNOWN_ENCODING_PARTS,
  withRelationship,
} from './crafted-pptx';
import { anydocMarkdown, readZipEntries, readZipText } from './spec-support';

const NOTES_TEXT = 'notes reached through an absolute target';

const slideOrder = (pptx: Buffer): string[] => {
  const presentation = readZipText(pptx, 'ppt/presentation.xml');
  const rels = readZipText(pptx, 'ppt/_rels/presentation.xml.rels');
  return [...presentation.matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map(
    (match) =>
      new RegExp(`Id="${match[1]}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? '',
  );
};

describe('buildNotesDeck', () => {
  it('is one titled slide whose notes anydoc reads through the slide relationships', async () => {
    const pptx = buildNotesDeck();

    const markdown = await anydocMarkdown(pptx, 'pptx');

    expect(slideOrder(pptx)).toEqual(['slides/slide1.xml']);
    expect(readZipText(pptx, NOTES_DECK_SLIDE_RELS)).toContain(
      'Target="../notesSlides/notesSlide1.xml"',
    );
    expect(markdown).toContain('## Slide with notes');
    expect(markdown).toContain(NOTES_TEXT);
  });
});

describe('notes-deck variants that move or add relationship targets', () => {
  it('rewrites every ../ target of slide 1 to an absolute /ppt/ target', async () => {
    const pptx = buildAbsoluteTargetDeck();

    const rels = readZipText(pptx, NOTES_DECK_SLIDE_RELS);

    expect(rels).not.toContain('Target="../');
    expect(rels).toContain('Target="/ppt/notesSlides/notesSlide1.xml"');
    expect(await anydocMarkdown(pptx, 'pptx')).toContain(NOTES_TEXT);
  });

  it.each([
    ['../../../outside.xml', false],
    ['/../outside.xml', false],
    ['http://example.invalid/remote.xml', true],
    ['../missing/part.xml', false],
  ])('adds a customXml relationship to %s and an outside.xml at the package root', (target, external) => {
    const pptx = buildUnsafeTargetDeck(target, external);

    const rels = readZipText(pptx, NOTES_DECK_SLIDE_RELS);
    const relationship = /<Relationship Id="rId99"[^>]*\/>/.exec(rels)?.[0];

    expect(relationship).toContain(`Target="${target}"`);
    expect(relationship).toContain('relationships/customXml"');
    expect(relationship?.includes('TargetMode="External"')).toBe(external);
    expect(readZipText(pptx, 'outside.xml')).toBe('<x>outside marker</x>');
  });

  it('appends a relationship just before the closing tag, leaving the others', () => {
    const rels =
      '<Relationships xmlns="r"><Relationship Id="rId1" Type="t" Target="a.xml"/></Relationships>';

    expect(
      withRelationship(rels, { id: 'rId9', type: 'x', target: 'b.xml' }),
    ).toBe(
      '<Relationships xmlns="r"><Relationship Id="rId1" Type="t" Target="a.xml"/>' +
        '<Relationship Id="rId9" Type="x" Target="b.xml"/></Relationships>',
    );
  });
});

describe('notes-deck variants with XML the service must refuse', () => {
  it('declares entities in the slide relationships', () => {
    const rels = readZipText(
      buildEntityExpansionRelationshipsDeck(),
      NOTES_DECK_SLIDE_RELS,
    );

    expect(rels).toMatch(
      /<!DOCTYPE r \[<!ENTITY a "a{10}"><!ENTITY b "(&a;){6}">\]>/,
    );
    expect(rels).toContain('Target="&b;"');
  });

  it.each(
    UNKNOWN_ENCODING_PARTS,
  )('declares the unknown encoding UTF-9 in %s', (part) => {
    const xml = readZipText(buildUnknownEncodingDeck(part), part);

    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-9"/);
  });
});

describe('buildContractDeck', () => {
  it('puts the last slide first and keeps the others in order', () => {
    expect(slideOrder(buildContractDeck())).toEqual([
      'slides/slide6.xml',
      'slides/slide1.xml',
      'slides/slide2.xml',
      'slides/slide3.xml',
      'slides/slide4.xml',
      'slides/slide5.xml',
    ]);
  });

  it('holds notes, a table, an image and a group, a hidden slide and an empty slide', async () => {
    const pptx = buildContractDeck();

    const markdown = await anydocMarkdown(pptx, 'pptx');
    const entries = readZipEntries(pptx);

    expect(markdown.indexOf('Moved to the front')).toBe(
      markdown.indexOf('## ') + 3,
    );
    expect(markdown).toContain('- first bullet\n- second bullet');
    expect(markdown).toContain('speaker notes for the opening');
    expect(markdown).toContain('| head A | head B |');
    expect(markdown).toContain('grouped text');
    expect(entries.has('ppt/media/image1.png')).toBe(true);
    expect(readZipText(pptx, 'ppt/slides/slide4.xml')).toContain('show="0"');
    expect(readZipText(pptx, 'ppt/slides/slide5.xml')).not.toContain('<a:t>');
  });
});

describe('buildArtefactDeck', () => {
  it('has auto alt text on pictures, author lines with the same sentence, and soft breaks', () => {
    const pptx = buildArtefactDeck();

    const first = readZipText(pptx, 'ppt/slides/slide1.xml');

    expect(slideOrder(pptx)).toHaveLength(3);
    expect(first).toContain(
      'descr="A cat&#10;&#10;AI-generated content may be incorrect."',
    );
    expect(first).toContain(
      '<a:t>Disclaimer: AI-generated content may be incorrect.</a:t>',
    );
    expect(readZipText(pptx, 'ppt/notesSlides/notesSlide1.xml')).toContain(
      '<a:t>line one</a:t></a:r><a:br/><a:r><a:t>line two</a:t>',
    );
    expect(readZipText(pptx, 'ppt/slides/slide2.xml')).toContain(
      'descr="A dog&#10;&#10;Description automatically generated"',
    );
    expect(readZipText(pptx, 'ppt/slides/slide3.xml')).toContain(
      '<a:t>end</a:t></a:r><a:br/><a:r><a:t>of deck</a:t>',
    );
  });
});

describe('buildDeckWithPictures', () => {
  it('writes one slide with the pictures, a grouped picture and caption, then a text box', async () => {
    const pptx = buildDeckWithPictures(['first alt', 'second alt']);

    const slide = readZipText(pptx, 'ppt/slides/slide1.xml');
    const markdown = await anydocMarkdown(pptx, 'pptx');

    expect(slideOrder(pptx)).toHaveLength(1);
    const positions = [
      'descr="first alt"',
      'descr="second alt"',
      'descr="A grouped chart&#10;&#10;AI-generated content may be incorrect."',
      '<a:t>grouped caption</a:t>',
      '<a:t>after pictures</a:t>',
    ].map((marker) => slide.indexOf(marker));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(markdown.startsWith('## Pictures\n')).toBe(true);
  });
});

describe('buildDeckWithText', () => {
  it('writes one slide with no title and one text box holding the text', async () => {
    const pptx = buildDeckWithText('first line\vsecond line');

    expect(readZipText(pptx, 'ppt/slides/slide1.xml')).not.toContain(
      'type="title"',
    );
    expect(await anydocMarkdown(pptx, 'pptx')).toBe(
      'first line\\\nsecond line\n',
    );
  });
});
