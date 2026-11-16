import { toAnswerSources } from './opened-pages';

describe('toAnswerSources', () => {
  it('titles each page by its last path segment and links it by page id under the site URL', () => {
    expect(
      toAnswerSources(
        [
          {
            pageId: '6650a1b2c3d4e5f607182930',
            path: '/team/meeting/2026-11-01',
          },
          { pageId: '6650a1b2c3d4e5f607182931', path: '/handbook' },
        ],
        'https://wiki.example.com',
      ),
    ).toEqual([
      {
        title: '2026-11-01',
        url: 'https://wiki.example.com/6650a1b2c3d4e5f607182930',
      },
      {
        title: 'handbook',
        url: 'https://wiki.example.com/6650a1b2c3d4e5f607182931',
      },
    ]);
  });

  it('links the root page by its path, as the browser does', () => {
    expect(
      toAnswerSources(
        [{ pageId: '6650a1b2c3d4e5f607182932', path: '/' }],
        'https://wiki.example.com/',
      ),
    ).toEqual([{ title: '/', url: 'https://wiki.example.com/' }]);
  });

  it('keeps a site URL that has a sub-path', () => {
    expect(
      toAnswerSources(
        [{ pageId: '6650a1b2c3d4e5f607182933', path: '/a' }],
        'https://example.com/growi/',
      ),
    ).toEqual([
      { title: 'a', url: 'https://example.com/growi/6650a1b2c3d4e5f607182933' },
    ]);
  });
});
