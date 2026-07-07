import type { IUser } from '@growi/core';
import mongoose, { type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import {
  type PageDocument,
  type PageModel,
  PageQueryBuilder,
} from '~/server/models/page';

import { aggregatePipelineToIndex } from './aggregate-to-index';

const EDITOR_USERNAME = 'aggIdxEditor';
const PATH_WITH_EDITOR = '/aggIdx_withEditor';
const PATH_WITHOUT_EDITOR = '/aggIdx_withoutEditor';

describe('aggregatePipelineToIndex() lastUpdateUser join', () => {
  let Page: PageModel;
  let User: Model<IUser>;

  const runFor = async (path: string) => {
    const query = new PageQueryBuilder(Page.find({ path })).query;
    const [doc] = await Page.aggregate(aggregatePipelineToIndex(1000, query));
    return doc;
  };

  beforeAll(async () => {
    await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');

    // Clean up first so re-runs (e.g. --repeat) stay idempotent against the
    // unique username index and existing pages.
    await User.deleteMany({ username: EDITOR_USERNAME });
    await Page.deleteMany({
      path: { $in: [PATH_WITH_EDITOR, PATH_WITHOUT_EDITOR] },
    });

    const editor = await User.create({
      name: EDITOR_USERNAME,
      username: EDITOR_USERNAME,
      email: 'aggIdxEditor@example.com',
    });

    const [pageWith, pageWithout] = await Page.insertMany([
      {
        path: PATH_WITH_EDITOR,
        grant: Page.GRANT_PUBLIC,
        creator: editor,
        lastUpdateUser: editor,
      },
      {
        path: PATH_WITHOUT_EDITOR,
        grant: Page.GRANT_PUBLIC,
        creator: editor,
        // no lastUpdateUser
      },
    ]);

    // A revision is required: the pipeline $unwinds revision without
    // preserveNullAndEmptyArrays, so a page with no revision is dropped.
    // Revision.pageId is required, so revisions are created after the pages.
    const Revision = mongoose.model('Revision');
    const [revWith, revWithout] = await Revision.create([
      { pageId: pageWith._id, body: 'with editor', format: 'markdown' },
      { pageId: pageWithout._id, body: 'without editor', format: 'markdown' },
    ]);
    await Page.updateOne({ _id: pageWith._id }, { revision: revWith._id });
    await Page.updateOne(
      { _id: pageWithout._id },
      { revision: revWithout._id },
    );
  });

  afterAll(async () => {
    await User.deleteMany({ username: EDITOR_USERNAME });
    await Page.deleteMany({
      path: { $in: [PATH_WITH_EDITOR, PATH_WITHOUT_EDITOR] },
    });
  });

  it('projects the last-updater username onto the indexed document', async () => {
    const doc = await runFor(PATH_WITH_EDITOR);

    expect(doc.lastUpdateUser.username).toBe(EDITOR_USERNAME);
  });

  it('still indexes a page that has no lastUpdateUser (preserveNullAndEmptyArrays)', async () => {
    const doc = await runFor(PATH_WITHOUT_EDITOR);

    // The $unwind must not drop pages lacking a lastUpdateUser.
    expect(doc).toBeDefined();
    expect(doc.path).toBe(PATH_WITHOUT_EDITOR);
    expect(doc.lastUpdateUser).toBeUndefined();
  });
});
