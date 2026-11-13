import { buildEpub } from './epub';
import { anydocMarkdown, readZipEntries } from './spec-support';

const LOCAL_HEADER_SIZE = 30;

const book = buildEpub({
  title: 'Two Chapter Book',
  language: 'en',
  chapters: [
    {
      title: 'Chapter 1',
      bodyXhtml: '<h1>One</h1><p>first chapter marker</p>',
    },
    {
      title: 'Chapter 2',
      bodyXhtml: '<h1>Two</h1><p>second chapter marker</p>',
    },
  ],
});

describe('buildEpub', () => {
  it('starts with the uncompressed EPUB mimetype entry', () => {
    expect(
      book.toString('latin1', LOCAL_HEADER_SIZE, LOCAL_HEADER_SIZE + 28),
    ).toBe('mimetypeapplication/epub+zip');
  });

  it('points the container at a package document that exists', () => {
    const entries = readZipEntries(book);

    const container = entries.get('META-INF/container.xml')?.toString() ?? '';
    const packagePath = /full-path="([^"]+)"/.exec(container)?.[1];

    expect(packagePath).toBe('OEBPS/content.opf');
    expect(entries.has(packagePath ?? '')).toBe(true);
  });

  it('writes the title and every chapter, in spine order, for anydoc', async () => {
    const markdown = await anydocMarkdown(book, 'epub');

    expect(markdown).toMatch(
      /Two Chapter Book[\s\S]*first chapter marker[\s\S]*second chapter marker/,
    );
  });
});
