import type { IPage, IUserHasId } from '@growi/core';
import { Origin } from '@growi/core';
import type { RequestHandler } from 'express';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { updatePageHandlersFactory } from './update-page';

const TEST_USERNAME = 'update-page-conflict-check-user';
const PAGE_PATH_PREFIX = '/update-page-conflict-check';

describe('update-page — overwrite prevention (conflict check)', () => {
  let crowi: Crowi;
  let testUser: IUserHasId;

  beforeAll(async () => {
    crowi = await getInstance();
    testUser = await crowi.models.User.create({
      name: 'Update Page Conflict Check User',
      username: TEST_USERNAME,
      email: 'update-page-conflict-check@example.com',
    });
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const Revision = mongoose.model('Revision');
    await Revision.deleteMany({ author: testUser._id });
    await Page.deleteMany({ path: new RegExp(`^${PAGE_PATH_PREFIX}`) });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
  });

  // Seeds a real page whose latest revision has the given origin, then runs the
  // real terminal handler with `origin: editor` and no `revisionId`.
  const saveWithoutRevisionId = async (
    latestRevisionOrigin: Origin | undefined,
  ) => {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const Revision = mongoose.model('Revision');

    const pageId = new Types.ObjectId();
    const revisionId = new Types.ObjectId();
    await Revision.create({
      _id: revisionId,
      pageId,
      body: 'latest body',
      format: 'markdown',
      author: testUser._id,
      ...(latestRevisionOrigin != null ? { origin: latestRevisionOrigin } : {}),
    });
    await Page.create({
      _id: pageId,
      path: `${PAGE_PATH_PREFIX}-${pageId.toString()}`,
      grant: 1,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      revision: revisionId,
    });

    const updatePageSpy = vi
      .spyOn(crowi.pageService, 'updatePage')
      .mockResolvedValue({
        _id: pageId,
        path: `${PAGE_PATH_PREFIX}-${pageId.toString()}`,
        creator: testUser._id,
        revision: {
          _id: new Types.ObjectId(),
          body: 'new body',
          author: testUser._id,
        },
        // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the page update
      } as any);

    const res = {
      locals: {},
      apiv3: vi.fn(),
      apiv3Err: vi.fn(),
    } as unknown as ApiV3Response;
    const req = {
      method: 'PUT',
      user: testUser,
      body: {
        pageId: pageId.toString(),
        body: 'new body',
        origin: Origin.Editor,
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal Express request shape
    } as any;

    const handlers = updatePageHandlersFactory(crowi);
    await (handlers[handlers.length - 1] as RequestHandler)(req, res, () => {});

    return { res, updatePageSpy };
  };

  it('rejects an editor save without revisionId with 409 conflict when the latest revision has an empty origin', async () => {
    const { res, updatePageSpy } = await saveWithoutRevisionId(undefined);

    expect(res.apiv3Err).toHaveBeenCalledTimes(1);
    const [error, status] = vi.mocked(res.apiv3Err).mock.calls[0];
    expect(status).toBe(409);
    expect(error).toMatchObject({ code: 'conflict' });
    expect(updatePageSpy).not.toHaveBeenCalled();
    expect(res.apiv3).not.toHaveBeenCalled();
  });

  it.each([
    Origin.Editor,
    Origin.View,
  ])('skips the check and saves an editor save without revisionId when the latest revision origin is %s', async (latestOrigin) => {
    const { res, updatePageSpy } = await saveWithoutRevisionId(latestOrigin);

    expect(res.apiv3Err).not.toHaveBeenCalled();
    expect(updatePageSpy).toHaveBeenCalledTimes(1);
    expect(res.apiv3).toHaveBeenCalledWith(expect.anything(), 201);
  });
});
