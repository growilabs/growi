import {
  contentTypesXml,
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

// A newline inside a paragraph becomes <w:br/>, as python-docx writes it
// (research.md 9.7).
const paragraphXml = (text: string): string => {
  const runs = escapeXml(text)
    .split('\n')
    .map((line) => `<w:t>${line}</w:t>`)
    .join('<w:br/>');
  return `<w:p><w:r>${runs}</w:r></w:p>`;
};

const documentXml = (paragraphs: readonly string[]): string =>
  `${XML_DECLARATION}<w:document xmlns:w="${W_NS}" xmlns:r="${RELATIONSHIPS_NS}"><w:body>${paragraphs.map(paragraphXml).join('')}</w:body></w:document>`;

const STYLES_XML = `${XML_DECLARATION}<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

/** The parts of a DOCX with one paragraph per string. */
export const docxParts = (paragraphs: readonly string[]): OoxmlPart[] => [
  {
    name: '[Content_Types].xml',
    data: contentTypesXml({
      overrides: [
        ['/word/document.xml', `${WML}.document.main+xml`],
        ['/word/styles.xml', `${WML}.styles+xml`],
      ],
    }),
  },
  packageRelationshipsPart('word/document.xml'),
  { name: 'word/document.xml', data: documentXml(paragraphs) },
  { name: 'word/styles.xml', data: STYLES_XML },
  {
    name: 'word/_rels/document.xml.rels',
    data: relationshipsXml([
      { id: 'rIdStyles', type: 'styles', target: 'styles.xml' },
    ]),
  },
];

export const buildDocx = (paragraphs: readonly string[]): Buffer =>
  buildZip(docxParts(paragraphs));
