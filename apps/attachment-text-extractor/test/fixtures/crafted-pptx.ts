import {
  editPart,
  type OoxmlPart,
  RELATIONSHIPS_NS,
  replaceOrThrow,
} from './ooxml-package';
import { buildGrayPng } from './png';
import { buildPptx, type PptxPicture, pptxParts } from './pptx';
import { buildZip } from './zip';

// Decks built inside the Python service's conversion/test_pptx_split.py.

export const NOTES_DECK_SLIDE_RELS = 'ppt/slides/_rels/slide1.xml.rels';
const PRESENTATION = 'ppt/presentation.xml';
const CUSTOM_XML_TYPE = `${RELATIONSHIPS_NS}/customXml`;

/** The parts whose XML declaration the encoding variants rewrite. */
export const UNKNOWN_ENCODING_PARTS: readonly string[] = [
  PRESENTATION,
  'ppt/_rels/presentation.xml.rels',
  '[Content_Types].xml',
];

// Python's `_png()`: 8x8 flat gray.
const smallPicture = (description?: string): PptxPicture => ({
  image: buildGrayPng(8, Buffer.alloc(64, 128)),
  description,
});

const notesDeckParts = (): OoxmlPart[] =>
  pptxParts([
    {
      title: 'Slide with notes',
      notes: 'notes reached through an absolute target',
    },
  ]);

export const buildNotesDeck = (): Buffer => buildZip(notesDeckParts());

const editedNotesDeck = (
  name: string,
  edit: (text: string) => string,
): OoxmlPart[] => editPart(notesDeckParts(), name, edit);

/** Slide 1's `../` targets made absolute `/ppt/` targets. */
export const buildAbsoluteTargetDeck = (): Buffer =>
  buildZip(
    editedNotesDeck(NOTES_DECK_SLIDE_RELS, (rels) =>
      replaceOrThrow(rels, /Target="\.\.\//g, 'Target="/ppt/'),
    ),
  );

export interface ExtraRelationship {
  readonly id: string;
  /** The full relationship type URI. */
  readonly type: string;
  readonly target: string;
  readonly external?: boolean;
}

/** Appends a relationship just before `</Relationships>`, as Python's `_with_relationship` does. */
export const withRelationship = (
  rels: string,
  { id, type, target, external = false }: ExtraRelationship,
): string => {
  const mode = external ? ' TargetMode="External"' : '';
  return replaceOrThrow(
    rels,
    '</Relationships>',
    `<Relationship Id="${id}" Type="${type}" Target="${target}"${mode}/></Relationships>`,
  );
};

/**
 * Adds a customXml relationship from slide 1 to `target`, and an
 * `outside.xml` at the package root that a reader clamping `../` to the root
 * instead of refusing it would pick up.
 */
export const buildUnsafeTargetDeck = (
  target: string,
  external: boolean,
): Buffer =>
  buildZip([
    ...editedNotesDeck(NOTES_DECK_SLIDE_RELS, (rels) =>
      withRelationship(rels, {
        id: 'rId99',
        type: CUSTOM_XML_TYPE,
        target,
        external,
      }),
    ),
    { name: 'outside.xml', data: '<x>outside marker</x>' },
  ]);

const ENTITY_EXPANSION_RELS =
  '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;">]>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t" Target="&b;"/></Relationships>';

export const buildEntityExpansionRelationshipsDeck = (): Buffer =>
  buildZip(editedNotesDeck(NOTES_DECK_SLIDE_RELS, () => ENTITY_EXPANSION_RELS));

/** The first encoding declaration in `part` replaced with `UTF-9`. */
export const buildUnknownEncodingDeck = (part: string): Buffer =>
  buildZip(
    editedNotesDeck(part, (xml) =>
      replaceOrThrow(xml, /encoding=(['"])[^'"]*\1/, 'encoding="UTF-9"'),
    ),
  );

/**
 * Notes, a table, an image, a group, a hidden slide, an empty slide, and the
 * last slide moved to the front of the slide list (Python's `_contract_deck`).
 */
export const buildContractDeck = (): Buffer =>
  buildZip(
    editPart(
      pptxParts([
        {
          title: 'Opening slide',
          body: 'first bullet\nsecond bullet',
          notes: 'speaker notes for the opening',
        },
        {
          title: 'Table slide',
          table: [
            ['head A', 'head B'],
            ['cell 1', 'cell 2'],
          ],
        },
        {
          title: 'Image and group',
          pictures: [smallPicture()],
          group: { textboxes: ['grouped text'] },
        },
        { title: 'Hidden slide', hidden: true },
        {},
        { title: 'Moved to the front' },
      ]),
      PRESENTATION,
      (xml) =>
        replaceOrThrow(
          xml,
          /(<p:sldIdLst>)(.*)(<p:sldId [^>]*\/>)(<\/p:sldIdLst>)/,
          '$1$3$2$4',
        ),
    ),
  );

/**
 * Auto-generated alt text, author lines ending in the same sentence, and soft
 * line breaks across slides (Python's `_artefact_deck`).
 */
export const buildArtefactDeck = (): Buffer =>
  buildPptx([
    {
      title: 'Artefacts',
      pictures: [
        smallPicture('A cat\n\nAI-generated content may be incorrect.'),
      ],
      textboxes: ['Disclaimer: AI-generated content may be incorrect.'],
      notes: 'line one\vline two',
    },
    {
      pictures: [smallPicture('A dog\n\nDescription automatically generated')],
    },
    { title: 'Last', textboxes: ['end\vof deck'] },
  ]);

/** Pictures with the given alt texts, a group of a picture and a caption, then a text box. */
export const buildDeckWithPictures = (
  descriptions: readonly string[],
): Buffer =>
  buildPptx([
    {
      title: 'Pictures',
      pictures: descriptions.map((description) => smallPicture(description)),
      group: {
        pictures: [
          smallPicture(
            'A grouped chart\n\nAI-generated content may be incorrect.',
          ),
        ],
        textboxes: ['grouped caption'],
      },
      textboxes: ['after pictures'],
    },
  ]);

/** One untitled slide with one text box. */
export const buildDeckWithText = (text: string): Buffer =>
  buildPptx([{ textboxes: [text] }]);
