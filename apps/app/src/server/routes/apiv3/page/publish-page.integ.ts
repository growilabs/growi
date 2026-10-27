/**
 * Security regression test — a read-only user must not be able to publish
 * (unset the WIP flag on) a page through this endpoint.
 *
 * Root cause: unlike update-page.ts, this route's middleware chain omitted
 * `excludeReadOnlyUser` (compare `loginRequiredStrictly, ...validator` here
 * with `loginRequiredStrictly, excludeReadOnlyUser, addActivity, ...validator`
 * on update-page.ts). `Page.findByIdAndViewer`, used by the terminal handler,
 * only checks view permission -- it has no notion of edit permission -- so a
 * logged-in read-only user who knows a pageId could call this endpoint
 * directly and flip its WIP flag.
 *
 * This test drives the REAL middleware array returned by
 * `publishPageHandlersFactory` (not just the terminal handler), because the
 * bug is about which middleware is present in the chain, not about the
 * terminal handler's own logic.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup).
 */

import type { IUserHasId } from '@growi/core';
import mongoose, { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { publishPageHandlersFactory } from './publish-page';
import { runMiddlewareChain } from './test-utils/run-middleware-chain';

const TEST_USERNAME = 'publish-page-integ-readonly-user';

describe('publish-page — a read-only user must not be able to publish a page', () => {
  let crowi: Crowi;
  let readOnlyUser: IUserHasId;
  let normalUser: IUserHasId;

  beforeAll(async () => {
    crowi = await getInstance();

    readOnlyUser = await crowi.models.User.create({
      name: 'Publish Page Integ Read Only User',
      username: TEST_USERNAME,
      email: 'publish-page-integ-readonly@example.com',
      readOnly: true,
    });

    normalUser = await crowi.models.User.create({
      name: 'Publish Page Integ Normal User',
      username: `${TEST_USERNAME}-normal`,
      email: 'publish-page-integ-normal@example.com',
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

  it('rejects the request with "This user is read only user" and never publishes the page', async () => {
    const pageId = new Types.ObjectId();

    const Page = mongoose.model<unknown, PageModel>('Page');
    const publishSpy = vi.fn();
    const fakePage = {
      _id: pageId,
      path: '/publish-page-integ-target',
      publish: publishSpy,
      save: vi.fn().mockResolvedValue(undefined),
    };
    const findByIdAndViewerSpy = vi
      .spyOn(Page, 'findByIdAndViewer')
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the viewer lookup
      .mockResolvedValue(fakePage as any);

    const req = {
      params: { pageId: pageId.toString() },
      query: {},
      body: {},
      headers: {},
      user: readOnlyUser,
    };

    const apiv3 = vi.fn();
    const apiv3Err = vi.fn();
    const res = mock<ApiV3Response>({ apiv3, apiv3Err });

    const handlers = publishPageHandlersFactory(crowi);
    await runMiddlewareChain(handlers, req, res);

    // The read-only user must be rejected by excludeReadOnlyUser specifically,
    // not by some other middleware that happens to also reject...
    expect(apiv3Err).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'This user is read only user',
        code: 'validation_failed',
      }),
    );
    expect(apiv3).not.toHaveBeenCalled();

    // ...and the page must never actually be published.
    expect(findByIdAndViewerSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('lets a non-read-only user pass through to publish the page', async () => {
    const pageId = new Types.ObjectId();

    const Page = mongoose.model<unknown, PageModel>('Page');
    const publishSpy = vi.fn();
    const fakePage = {
      _id: pageId,
      path: '/publish-page-integ-target',
      publish: publishSpy,
      save: vi.fn().mockResolvedValue(undefined),
    };
    const findByIdAndViewerSpy = vi
      .spyOn(Page, 'findByIdAndViewer')
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the viewer lookup
      .mockResolvedValue(fakePage as any);

    const req = {
      params: { pageId: pageId.toString() },
      query: {},
      body: {},
      headers: {},
      cookies: {},
      user: normalUser,
    };

    const apiv3 = vi.fn();
    const apiv3Err = vi.fn();
    const res = mock<ApiV3Response>({ apiv3, apiv3Err });

    const handlers = publishPageHandlersFactory(crowi);
    await runMiddlewareChain(handlers, req, res);

    // A regular user is not blocked by excludeReadOnlyUser — the request
    // reaches the terminal handler and actually publishes the page.
    expect(findByIdAndViewerSpy).toHaveBeenCalledWith(
      pageId.toString(),
      normalUser,
    );
    expect(publishSpy).toHaveBeenCalled();
    expect(apiv3).toHaveBeenCalled();
    expect(apiv3Err).not.toHaveBeenCalled();
  });
});
