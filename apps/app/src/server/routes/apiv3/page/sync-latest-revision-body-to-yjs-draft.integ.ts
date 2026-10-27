/**
 * Security regression test — a read-only user must not be able to force a
 * sync of a page's yjs collaborative draft to its latest revision body.
 *
 * Root cause: like publish-page.ts / unpublish-page.ts before their fix,
 * this route's middleware chain omits `excludeReadOnlyUser`. The terminal
 * handler only checks *view* accessibility (`Page.isAccessiblePageByViewer`),
 * which has no notion of edit permission, so a logged-in read-only user who
 * knows a pageId could call this endpoint directly and overwrite another
 * user's in-progress, unsaved collaborative draft with the latest saved
 * revision.
 *
 * This test drives the REAL middleware array returned by
 * `syncLatestRevisionBodyToYjsDraftHandlerFactory` (not just the terminal
 * handler), because the bug is about which middleware is present in the
 * chain, not about the terminal handler's own logic.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup).
 */

import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { syncLatestRevisionBodyToYjsDraftHandlerFactory } from './sync-latest-revision-body-to-yjs-draft';
import { runMiddlewareChain } from './test-utils/run-middleware-chain';

const TEST_USERNAME = 'sync-yjs-draft-integ-readonly-user';

describe('sync-latest-revision-body-to-yjs-draft — a read-only user must not be able to force-sync a page draft', () => {
  let crowi: Crowi;
  let readOnlyUser: IUserHasId;
  let normalUser: IUserHasId;

  beforeAll(async () => {
    crowi = await getInstance();

    readOnlyUser = await crowi.models.User.create({
      name: 'Sync Yjs Draft Integ Read Only User',
      username: TEST_USERNAME,
      email: 'sync-yjs-draft-integ-readonly@example.com',
      readOnly: true,
    });

    normalUser = await crowi.models.User.create({
      name: 'Sync Yjs Draft Integ Normal User',
      username: `${TEST_USERNAME}-normal`,
      email: 'sync-yjs-draft-integ-normal@example.com',
      readOnly: false,
    });
  }, 120_000);

  afterAll(async () => {
    await crowi.models.User.deleteMany({
      username: { $in: [TEST_USERNAME, `${TEST_USERNAME}-normal`] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a read-only user with "This user is read only user" and never checks page accessibility', async () => {
    const pageId = new mongoose.Types.ObjectId().toString();

    const Page = mongoose.model<unknown, PageModel>('Page');
    const isAccessiblePageByViewerSpy = vi.spyOn(
      Page,
      'isAccessiblePageByViewer',
    );

    const req = {
      params: { pageId },
      query: {},
      body: {},
      headers: {},
      user: readOnlyUser,
    };

    const apiv3 = vi.fn();
    const apiv3Err = vi.fn();
    const res = mock<ApiV3Response>({ apiv3, apiv3Err });

    const handlers = syncLatestRevisionBodyToYjsDraftHandlerFactory(crowi);
    await runMiddlewareChain(handlers, req, res);

    // The read-only user must be rejected by excludeReadOnlyUser specifically...
    expect(apiv3Err).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'This user is read only user',
        code: 'validation_failed',
      }),
    );
    expect(apiv3).not.toHaveBeenCalled();

    // ...and the request must never even reach the terminal handler's own
    // accessibility check, let alone force a yjs draft sync.
    expect(isAccessiblePageByViewerSpy).not.toHaveBeenCalled();
  });

  it('lets a non-read-only user pass through excludeReadOnlyUser to the terminal handler', async () => {
    const pageId = new mongoose.Types.ObjectId().toString();

    const Page = mongoose.model<unknown, PageModel>('Page');
    const isAccessiblePageByViewerSpy = vi
      .spyOn(Page, 'isAccessiblePageByViewer')
      .mockResolvedValue(false);

    const req = {
      params: { pageId },
      query: {},
      body: {},
      headers: {},
      cookies: {},
      user: normalUser,
    };

    const apiv3 = vi.fn();
    const apiv3Err = vi.fn();
    const res = mock<ApiV3Response>({ apiv3, apiv3Err });

    const handlers = syncLatestRevisionBodyToYjsDraftHandlerFactory(crowi);
    await runMiddlewareChain(handlers, req, res);

    // A regular user is not blocked by excludeReadOnlyUser — the request
    // reaches the terminal handler's own accessibility check.
    expect(isAccessiblePageByViewerSpy).toHaveBeenCalledWith(
      pageId,
      normalUser,
    );
  });
});
