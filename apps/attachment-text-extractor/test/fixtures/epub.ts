import { escapeXml } from './xml-text';
import { buildMimetypeFirstZip, type ZipEntry } from './zip';

export interface EpubChapter {
  /** Shown in the table of contents and the chapter's `<title>`. */
  readonly title: string;
  /** The chapter's `<body>` content (XHTML). */
  readonly bodyXhtml: string;
}

export interface EpubBook {
  readonly title: string;
  readonly language: string;
  readonly chapters: readonly EpubChapter[];
}

// The layout and whitespace follow the Python service's tests/fixture_files.py,
// so a one-chapter book converts to the same Markdown there and here.

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

const CONTAINER_XML = `${XML_HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
 <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const chapterFile = (index: number): string => `chapter${index + 1}.xhtml`;

const packageXml = ({ title, language, chapters }: EpubBook): string => {
  const items = chapters
    .map(
      (_, i) =>
        `  <item id="ch${i + 1}" href="${chapterFile(i)}" media-type="application/xhtml+xml"/>\n`,
    )
    .join('');
  const spine = chapters
    .map((_, i) => `<itemref idref="ch${i + 1}"/>`)
    .join('');
  return `${XML_HEAD}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
 <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="uid">urn:uuid:00000000-0000-4000-8000-000000000000</dc:identifier>
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:language>${escapeXml(language)}</dc:language>
  <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
 </metadata>
 <manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${items} </manifest>
 <spine>${spine}</spine>
</package>
`;
};

const navXml = (chapters: readonly EpubChapter[]): string => {
  const entries = chapters
    .map(
      (chapter, i) =>
        `<li><a href="${chapterFile(i)}">${escapeXml(chapter.title)}</a></li>`,
    )
    .join('');
  return `${XML_HEAD}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>${entries}</ol></nav></body>
</html>
`;
};

const chapterXml = ({ title, bodyXhtml }: EpubChapter): string =>
  `${XML_HEAD}<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escapeXml(title)}</title></head>
<body>${bodyXhtml}</body>
</html>
`;

/** An EPUB 3 book with a navigation document and one file per chapter. */
export const buildEpub = (book: EpubBook): Buffer => {
  const chapterEntries: ZipEntry[] = book.chapters.map((chapter, i) => ({
    name: `OEBPS/${chapterFile(i)}`,
    data: chapterXml(chapter),
  }));
  return buildMimetypeFirstZip('application/epub+zip', [
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: packageXml(book) },
    { name: 'OEBPS/nav.xhtml', data: navXml(book.chapters) },
    ...chapterEntries,
  ]);
};
