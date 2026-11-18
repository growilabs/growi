import {
  contentTypesXml,
  DRAWINGML_NS,
  type OoxmlPart,
  packageRelationshipsPart,
  RELATIONSHIPS_NS,
  relationshipsXml,
  XML_DECLARATION,
} from './ooxml-package';
import { escapeXml } from './xml-text';
import { buildZip } from './zip';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const PICTURE_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const IMAGE_NAMESPACES = ` xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="${DRAWINGML_NS}" xmlns:pic="${PICTURE_NS}"`;
// One inch, the width python-docx is given for each picture in the fixtures.
const IMAGE_EMU = 914400;

// A newline inside a paragraph becomes <w:br/>, as python-docx writes it
// (research.md 9.7).
const paragraphXml = (text: string): string => {
  const runs = escapeXml(text)
    .split('\n')
    .map((line) => `<w:t>${line}</w:t>`)
    .join('<w:br/>');
  return `<w:p><w:r>${runs}</w:r></w:p>`;
};

const imageRelationshipId = (index: number): string => `rIdImg${index + 1}`;

// One paragraph per picture, as python-docx's add_picture writes it.
const pictureParagraphXml = (index: number): string => {
  const id = index + 1;
  const extent = `cx="${IMAGE_EMU}" cy="${IMAGE_EMU}"`;
  return `<w:p><w:r><w:drawing><wp:inline><wp:extent ${extent}/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic><a:graphicData uri="${PICTURE_NS}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${imageRelationshipId(index)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${extent}/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
};

const documentXml = (
  paragraphs: readonly string[],
  imageCount: number,
): string => {
  const namespaces = imageCount > 0 ? IMAGE_NAMESPACES : '';
  const pictures = Array.from({ length: imageCount }, (_, i) =>
    pictureParagraphXml(i),
  );
  return `${XML_DECLARATION}<w:document xmlns:w="${W_NS}" xmlns:r="${RELATIONSHIPS_NS}"${namespaces}><w:body>${paragraphs.map(paragraphXml).join('')}${pictures.join('')}</w:body></w:document>`;
};

const STYLES_XML = `${XML_DECLARATION}<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

const mediaName = (index: number): string => `media/image${index + 1}.png`;

/**
 * The parts of a DOCX with one paragraph per string, then one picture
 * paragraph per PNG image.
 */
export const docxParts = (
  paragraphs: readonly string[],
  images: readonly Uint8Array[] = [],
): OoxmlPart[] => [
  {
    name: '[Content_Types].xml',
    data: contentTypesXml({
      defaults: images.length > 0 ? [['png', 'image/png']] : [],
      overrides: [
        ['/word/document.xml', `${WML}.document.main+xml`],
        ['/word/styles.xml', `${WML}.styles+xml`],
      ],
    }),
  },
  packageRelationshipsPart('word/document.xml'),
  { name: 'word/document.xml', data: documentXml(paragraphs, images.length) },
  { name: 'word/styles.xml', data: STYLES_XML },
  {
    name: 'word/_rels/document.xml.rels',
    data: relationshipsXml([
      { id: 'rIdStyles', type: 'styles', target: 'styles.xml' },
      ...images.map((_, i) => ({
        id: imageRelationshipId(i),
        type: 'image',
        target: mediaName(i),
      })),
    ]),
  },
  ...images.map((image, i) => ({ name: `word/${mediaName(i)}`, data: image })),
];

export const buildDocx = (
  paragraphs: readonly string[],
  images: readonly Uint8Array[] = [],
): Buffer => buildZip(docxParts(paragraphs, images));
