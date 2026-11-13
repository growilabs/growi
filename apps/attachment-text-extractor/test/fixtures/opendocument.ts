import { buildMimetypeFirstZip } from './zip';

export type OpenDocumentKind = 'text' | 'spreadsheet' | 'presentation';

// Strings are kept as in the Python service's tests/fixture_files.py, so the
// packages convert to the same Markdown there and here.

const manifestXml = (mimetype: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
 <manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
`;

const contentXml = (bodyXml: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
 office:version="1.2">
 <office:body>${bodyXml}</office:body>
</office:document-content>
`;

/**
 * An ODF package (.odt / .ods / .odp). `bodyXml` is the content of
 * `<office:body>`, e.g. `<office:text>...</office:text>`; the `office`,
 * `text`, `table`, `draw` and `svg` prefixes are declared.
 */
export const buildOpenDocument = (
  kind: OpenDocumentKind,
  bodyXml: string,
): Buffer => {
  const mimetype = `application/vnd.oasis.opendocument.${kind}`;
  return buildMimetypeFirstZip(mimetype, [
    { name: 'content.xml', data: contentXml(bodyXml) },
    { name: 'META-INF/manifest.xml', data: manifestXml(mimetype) },
  ]);
};
