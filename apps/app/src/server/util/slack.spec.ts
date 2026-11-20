import { prepareSlackMessageForComment } from './slack';

describe('prepareSlackMessageForComment', () => {
  const siteUrl = 'https://growi.example.com';
  const user = { username: 'alice', image: null };

  it('links to the commented page by the pageId of a Prisma comment record', () => {
    const comment = {
      id: '6650a1b2c3d4e5f6a7b8c9d1',
      pageId: '6650a1b2c3d4e5f6a7b8c9d0',
      comment: 'nice page',
    };

    const message = prepareSlackMessageForComment(
      comment,
      user,
      'GROWI',
      siteUrl,
      'general',
      '/path/to/page',
    );

    expect(message.text).toBe(
      ':speech_balloon: alice commented on <https://growi.example.com/6650a1b2c3d4e5f6a7b8c9d0|/path/to/page>',
    );
  });
});
