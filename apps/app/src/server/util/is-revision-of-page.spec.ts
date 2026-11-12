import { Types } from 'mongoose';

import { isRevisionOfPage } from './is-revision-of-page';

describe('isRevisionOfPage', () => {
  const pageId = new Types.ObjectId();

  it('accepts a revision of the page, whether the page id is an ObjectId or a string', () => {
    const revision = { pageId: pageId.toString() };

    expect(isRevisionOfPage(revision, pageId)).toBe(true);
    expect(isRevisionOfPage(revision, pageId.toString())).toBe(true);
  });

  it('rejects a revision of another page', () => {
    expect(
      isRevisionOfPage({ pageId: new Types.ObjectId().toString() }, pageId),
    ).toBe(false);
  });

  it('rejects a missing revision', () => {
    expect(isRevisionOfPage(null, pageId)).toBe(false);
    expect(isRevisionOfPage(undefined, pageId)).toBe(false);
  });
});
