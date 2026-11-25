import { startOffsets } from './offsets';
import {
  contentTypesXml,
  DRAWINGML_NS,
  type OoxmlPart,
  packageRelationshipsPart,
  RELATIONSHIPS_NS,
  type Relationship,
  relationshipsXml,
  XML_DECLARATION,
} from './ooxml-package';
import {
  groupXml,
  pictureXml,
  placeholderXml,
  shapeTree,
  tableXml,
  textboxXml,
} from './pptx-shapes';
import { buildZip } from './zip';

export interface PptxPicture {
  /** PNG bytes. */
  readonly image: Uint8Array;
  /** Alt text; python-pptx writes the file name, `image.png`, by default. */
  readonly description?: string;
}

export interface PptxGroup {
  readonly pictures?: readonly PptxPicture[];
  readonly textboxes?: readonly string[];
}

/**
 * Text uses "\n" between paragraphs and "\v" for a line break inside one.
 * Shapes follow the placeholders in this order: pictures, the group, text
 * boxes, the table (python-pptx keeps insertion order; research.md 9.5.3).
 */
export interface PptxSlide {
  readonly title?: string;
  /** One paragraph per line. */
  readonly body?: string;
  readonly notes?: string;
  readonly pictures?: readonly PptxPicture[];
  readonly group?: PptxGroup;
  readonly textboxes?: readonly string[];
  readonly table?: readonly (readonly string[])[];
  /** Written as `show="0"`, as python-pptx's hidden slides are. */
  readonly hidden?: boolean;
}

const NAMESPACES = `xmlns:a="${DRAWINGML_NS}" xmlns:r="${RELATIONSHIPS_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
const DEFAULT_PICTURE_DESCRIPTION = 'image.png';
const FIRST_SHAPE_ID = 10;
const COLOR_SLOTS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
];

const PLACEHOLDERS = placeholderXml('title', '') + placeholderXml('body', '');

const THEME_XML = `${XML_DECLARATION}<a:theme xmlns:a="${DRAWINGML_NS}" name="T"><a:themeElements><a:clrScheme name="C">${COLOR_SLOTS.map((slot) => `<a:${slot}><a:srgbClr val="000000"/></a:${slot}>`).join('')}</a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="M"><a:fillStyleLst>${'<a:noFill/>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln/>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:noFill/>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

// The bullet in bodyStyle makes anydoc write body paragraphs as "- " items,
// as it does for python-pptx's default template (research.md 9.4).
const MASTER_XML = `${XML_DECLARATION}<p:sldMaster ${NAMESPACES}>${shapeTree(PLACEHOLDERS)}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="&#8226;"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr/></p:otherStyle></p:txStyles><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const LAYOUT_XML = `${XML_DECLARATION}<p:sldLayout ${NAMESPACES}>${shapeTree(PLACEHOLDERS)}</p:sldLayout>`;

const slidePictures = (slide: PptxSlide): readonly PptxPicture[] => [
  ...(slide.pictures ?? []),
  ...(slide.group?.pictures ?? []),
];

// The layout is rId1; pictures follow in slidePictures order.
const pictureRelationshipId = (index: number): string => `rId${index + 2}`;

const slideShapes = (slide: PptxSlide): string => {
  let nextId = FIRST_SHAPE_ID;
  const takeId = (): number => nextId++;
  const picture = (item: PptxPicture, index: number): string =>
    pictureXml(
      takeId(),
      pictureRelationshipId(index),
      item.description ?? DEFAULT_PICTURE_DESCRIPTION,
    );
  const own = slide.pictures ?? [];
  const pictures = own.map(picture).join('');
  const group =
    slide.group == null
      ? ''
      : groupXml(
          takeId(),
          (slide.group.pictures ?? [])
            .map((item, i) => picture(item, own.length + i))
            .join('') +
            (slide.group.textboxes ?? [])
              .map((text) => textboxXml(takeId(), text))
              .join(''),
        );
  const textboxes = (slide.textboxes ?? [])
    .map((text) => textboxXml(takeId(), text))
    .join('');
  const table = slide.table == null ? '' : tableXml(takeId(), slide.table);
  return pictures + group + textboxes + table;
};

const slideXml = (slide: PptxSlide): string => {
  const shapes =
    (slide.title == null ? '' : placeholderXml('title', slide.title)) +
    (slide.body == null ? '' : placeholderXml('body', slide.body)) +
    slideShapes(slide);
  const show = slide.hidden === true ? ' show="0"' : '';
  return `${XML_DECLARATION}<p:sld ${NAMESPACES}${show}>${shapeTree(shapes)}</p:sld>`;
};

// Slide relationship ids are rId<number>, as python-pptx writes them; the
// Python split tests match `r:id="rId\d+"` (research.md 9.5.4).
const slideRelationshipId = (index: number): string => `rId${index + 3}`;

const presentationXml = (slideCount: number): string => {
  const ids = Array.from(
    { length: slideCount },
    (_, i) => `<p:sldId id="${256 + i}" r:id="${slideRelationshipId(i)}"/>`,
  ).join('');
  return `${XML_DECLARATION}<p:presentation ${NAMESPACES}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
};

const presentationRelationships = (slideCount: number): Relationship[] => [
  { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
  { id: 'rId2', type: 'theme', target: 'theme/theme1.xml' },
  ...Array.from({ length: slideCount }, (_, i) => ({
    id: slideRelationshipId(i),
    type: 'slide',
    target: `slides/slide${i + 1}.xml`,
  })),
];

const layoutRelationship: Relationship = {
  id: 'rId1',
  type: 'slideLayout',
  target: '../slideLayouts/slideLayout1.xml',
};

const notesParts = (notes: string, n: number): OoxmlPart[] => [
  {
    name: `ppt/notesSlides/notesSlide${n}.xml`,
    data: `${XML_DECLARATION}<p:notes ${NAMESPACES}>${shapeTree(placeholderXml('body', notes))}</p:notes>`,
  },
  {
    name: `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
    data: relationshipsXml([
      { id: 'rId1', type: 'slide', target: `../slides/slide${n}.xml` },
    ]),
  },
];

// Media files are numbered across the deck, starting at `firstMedia`.
const slideParts = (
  slide: PptxSlide,
  n: number,
  firstMedia: number,
): OoxmlPart[] => {
  const pictures = slidePictures(slide);
  const media = pictures.map((_, i) => `media/image${firstMedia + i}.png`);
  const relationships: Relationship[] = [
    layoutRelationship,
    ...media.map((name, i) => ({
      id: pictureRelationshipId(i),
      type: 'image',
      target: `../${name}`,
    })),
    ...(slide.notes == null
      ? []
      : [
          {
            id: `rId${pictures.length + 2}`,
            type: 'notesSlide',
            target: `../notesSlides/notesSlide${n}.xml`,
          },
        ]),
  ];
  return [
    { name: `ppt/slides/slide${n}.xml`, data: slideXml(slide) },
    {
      name: `ppt/slides/_rels/slide${n}.xml.rels`,
      data: relationshipsXml(relationships),
    },
    ...pictures.map((picture, i) => ({
      name: `ppt/${media[i]}`,
      data: picture.image,
    })),
    ...(slide.notes == null ? [] : notesParts(slide.notes, n)),
  ];
};

const allSlideParts = (slides: readonly PptxSlide[]): OoxmlPart[] => {
  const firstMedia = startOffsets(
    1,
    slides.map((slide) => slidePictures(slide).length),
  );
  return slides.flatMap((slide, i) => slideParts(slide, i + 1, firstMedia[i]));
};

const contentTypes = (slides: readonly PptxSlide[]): string =>
  contentTypesXml({
    defaults: slides.some((slide) => slidePictures(slide).length > 0)
      ? [['png', 'image/png']]
      : [],
    overrides: [
      ['/ppt/presentation.xml', `${PML}.presentation.main+xml`],
      ['/ppt/slideMasters/slideMaster1.xml', `${PML}.slideMaster+xml`],
      ['/ppt/slideLayouts/slideLayout1.xml', `${PML}.slideLayout+xml`],
      [
        '/ppt/theme/theme1.xml',
        'application/vnd.openxmlformats-officedocument.theme+xml',
      ],
      ...slides.map(
        (_, i) =>
          [`/ppt/slides/slide${i + 1}.xml`, `${PML}.slide+xml`] as const,
      ),
      ...slides.flatMap((slide, i) =>
        slide.notes == null
          ? []
          : [
              [
                `/ppt/notesSlides/notesSlide${i + 1}.xml`,
                `${PML}.notesSlide+xml`,
              ] as const,
            ],
      ),
    ],
  });

/** The parts of a PPTX with one master, one layout and the given slides. */
export const pptxParts = (slides: readonly PptxSlide[]): OoxmlPart[] => [
  { name: '[Content_Types].xml', data: contentTypes(slides) },
  packageRelationshipsPart('ppt/presentation.xml'),
  { name: 'ppt/presentation.xml', data: presentationXml(slides.length) },
  {
    name: 'ppt/_rels/presentation.xml.rels',
    data: relationshipsXml(presentationRelationships(slides.length)),
  },
  { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER_XML },
  {
    name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    data: relationshipsXml([
      { ...layoutRelationship },
      { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
    ]),
  },
  { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT_XML },
  {
    name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    data: relationshipsXml([
      {
        id: 'rId1',
        type: 'slideMaster',
        target: '../slideMasters/slideMaster1.xml',
      },
    ]),
  },
  { name: 'ppt/theme/theme1.xml', data: THEME_XML },
  ...allSlideParts(slides),
];

export const buildPptx = (slides: readonly PptxSlide[]): Buffer =>
  buildZip(pptxParts(slides));
