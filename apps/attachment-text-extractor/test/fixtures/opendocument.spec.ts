import { buildOpenDocument, type OpenDocumentKind } from './opendocument';
import { anydocMarkdown, readZipEntries } from './spec-support';

const LOCAL_HEADER_SIZE = 30;

describe('buildOpenDocument', () => {
  it.each<[OpenDocumentKind, string, string]>([
    [
      'text',
      'odt',
      '<office:text><text:p>odt body marker</text:p></office:text>',
    ],
    [
      'spreadsheet',
      'ods',
      '<office:spreadsheet><table:table table:name="Only"><table:table-row>' +
        '<table:table-cell office:value-type="string"><text:p>ods body marker</text:p>' +
        '</table:table-cell></table:table-row></table:table></office:spreadsheet>',
    ],
    [
      'presentation',
      'odp',
      '<office:presentation><draw:page draw:name="p1"><draw:frame><draw:text-box>' +
        '<text:p>odp body marker</text:p></draw:text-box></draw:frame></draw:page>' +
        '</office:presentation>',
    ],
  ])('writes an OpenDocument %s package whose body anydoc extracts', async (kind, extension, body) => {
    const document = buildOpenDocument(kind, body);

    const mimetype = `application/vnd.oasis.opendocument.${kind}`;
    expect(
      document.toString('latin1', LOCAL_HEADER_SIZE, LOCAL_HEADER_SIZE + 8),
    ).toBe('mimetype');
    expect(readZipEntries(document).get('mimetype')?.toString()).toBe(mimetype);
    expect(
      readZipEntries(document).get('META-INF/manifest.xml')?.toString(),
    ).toContain(`manifest:media-type="${mimetype}"`);
    expect(await anydocMarkdown(document, extension)).toContain(
      `${extension} body marker`,
    );
  });
});
