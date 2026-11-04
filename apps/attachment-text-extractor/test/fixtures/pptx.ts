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
import { escapeXml } from './xml-text';
import { buildZip } from './zip';

export interface PptxSlide {
  readonly title?: string;
  /** One paragraph per line. */
  readonly body?: string;
}

const NAMESPACES = `xmlns:a="${DRAWINGML_NS}" xmlns:r="${RELATIONSHIPS_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
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

const shapeTree = (shapes: string): string =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>`;

const paragraphs = (text: string): string =>
  text
    .split('\n')
    .map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`)
    .join('');

// The title placeholder has no idx (= idx 0): python-pptx finds the slide
// title only there (research.md 9.3).
const placeholder = (kind: 'title' | 'body', text: string): string => {
  const id = kind === 'title' ? 2 : 3;
  const ph = kind === 'title' ? '<p:ph type="title"/>' : '<p:ph idx="1"/>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${kind} ${id}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paragraphs(text)}</p:txBody></p:sp>`;
};

const PLACEHOLDERS = placeholder('title', '') + placeholder('body', '');

const THEME_XML = `${XML_DECLARATION}<a:theme xmlns:a="${DRAWINGML_NS}" name="T"><a:themeElements><a:clrScheme name="C">${COLOR_SLOTS.map((slot) => `<a:${slot}><a:srgbClr val="000000"/></a:${slot}>`).join('')}</a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="M"><a:fillStyleLst>${'<a:noFill/>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln/>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:noFill/>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

// The bullet in bodyStyle makes anydoc write body paragraphs as "- " items,
// as it does for python-pptx's default template (research.md 9.4).
const MASTER_XML = `${XML_DECLARATION}<p:sldMaster ${NAMESPACES}>${shapeTree(PLACEHOLDERS)}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="&#8226;"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr/></p:otherStyle></p:txStyles><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const LAYOUT_XML = `${XML_DECLARATION}<p:sldLayout ${NAMESPACES}>${shapeTree(PLACEHOLDERS)}</p:sldLayout>`;

const slideXml = ({ title, body }: PptxSlide): string => {
  const shapes =
    (title == null ? '' : placeholder('title', title)) +
    (body == null ? '' : placeholder('body', body));
  return `${XML_DECLARATION}<p:sld ${NAMESPACES}>${shapeTree(shapes)}</p:sld>`;
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

const slideParts = (slides: readonly PptxSlide[]): OoxmlPart[] =>
  slides.flatMap((slide, i) => [
    { name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(slide) },
    {
      name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: relationshipsXml([layoutRelationship]),
    },
  ]);

const contentTypes = (slideCount: number): string =>
  contentTypesXml({
    overrides: [
      ['/ppt/presentation.xml', `${PML}.presentation.main+xml`],
      ['/ppt/slideMasters/slideMaster1.xml', `${PML}.slideMaster+xml`],
      ['/ppt/slideLayouts/slideLayout1.xml', `${PML}.slideLayout+xml`],
      [
        '/ppt/theme/theme1.xml',
        'application/vnd.openxmlformats-officedocument.theme+xml',
      ],
      ...Array.from(
        { length: slideCount },
        (_, i) =>
          [`/ppt/slides/slide${i + 1}.xml`, `${PML}.slide+xml`] as const,
      ),
    ],
  });

/** The parts of a PPTX with one master, one layout and the given slides. */
export const pptxParts = (slides: readonly PptxSlide[]): OoxmlPart[] => [
  { name: '[Content_Types].xml', data: contentTypes(slides.length) },
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
  ...slideParts(slides),
];

export const buildPptx = (slides: readonly PptxSlide[]): Buffer =>
  buildZip(pptxParts(slides));
