import type { IPage, IUserHasId } from '@growi/core';
import type { RequestHandler } from 'express';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { updatePageHandlersFactory } from './update-page';

const TEST_USERNAME = 'update-page-previous-revision-user';

describe('update-page — previous revision lookup', () => {
  let crowi: Crowi;
  let testUser: IUserHasId;

  const pageId = new Types.ObjectId();
  const ownRevisionId = new Types.ObjectId();
  const foreignPageId = new Types.ObjectId();
  const foreignRevisionId = new Types.ObjectId();

  beforeAll(async () => {
    crowi = await getInstance();

    testUser = await crowi.models.User.create({
      name: 'Update Page Previous Revision User',
      username: TEST_USERNAME,
      email: 'update-page-previous-revision@example.com',
    });

    await prisma.revisions.create({
      data: {
        id: ownRevisionId.toString(),
        pageId: pageId.toString(),
        body: 'OWN PREVIOUS BODY',
        format: 'markdown',
        authorId: testUser._id.toString(),
      },
    });
    await prisma.revisions.create({
      data: {
        id: foreignRevisionId.toString(),
        pageId: foreignPageId.toString(),
        body: 'FOREIGN PRIVATE BODY',
        format: 'markdown',
        authorId: testUser._id.toString(),
      },
    });
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.revisions.deleteMany({
      where: {
        id: { in: [ownRevisionId.toString(), foreignRevisionId.toString()] },
      },
    });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
  });

  const runUpdate = async (revisionId: string): Promise<string | null> => {
    const Page = mongoose.model<IPage, PageModel>('Page');

    const currentPage = {
      _id: pageId,
      path: '/update-page-previous-revision-target',
      grant: 1,
      revision: ownRevisionId,
      isUpdatable: vi.fn().mockResolvedValue(true),
    };
    vi.spyOn(Page, 'count').mockResolvedValue(1);
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the viewer lookup
    vi.spyOn(Page, 'findByIdAndViewer').mockResolvedValue(currentPage as any);
    const updatePageSpy = vi
      .spyOn(crowi.pageService, 'updatePage')
      .mockResolvedValue({
        _id: pageId,
        path: currentPage.path,
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
        origin: 'editor',
        revisionId,
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal Express request shape
    } as any;

    const handlers = updatePageHandlersFactory(crowi);
    await (handlers[handlers.length - 1] as RequestHandler)(req, res, () => {});

    expect(updatePageSpy).toHaveBeenCalledTimes(1);
    return updatePageSpy.mock.calls[0][2];
  };

  it('uses the body of the revision when it belongs to the page', async () => {
    expect(await runUpdate(ownRevisionId.toString())).toBe('OWN PREVIOUS BODY');
  });

  it('does not use the body of a revision that belongs to another page', async () => {
    const previousBody = await runUpdate(foreignRevisionId.toString());

    expect(previousBody).toBe('OWN PREVIOUS BODY');
  });
});
