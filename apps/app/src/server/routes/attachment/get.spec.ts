import type { IUser } from '@growi/core';
import type { Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type { RequestToAllowShareLink } from '../../middlewares/certify-shared-page-attachment';
import { Attachment, type IAttachmentDocument } from '../../models/attachment';
import { retrieveAttachmentFromIdParam } from './get';

type TestRequest = Request &
  RequestToAllowShareLink & {
    user?: HydratedDocument<IUser>;
  };

vi.mock('../../models/attachment', () => ({
  Attachment: { findById: vi.fn() },
}));

describe('retrieveAttachmentFromIdParam', () => {
  const pageId = '000000000000000000000001';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildAttachment = (hasPage: boolean): IAttachmentDocument =>
    mock<IAttachmentDocument>({
      id: 'attachment1',
      page: hasPage ? pageId : undefined,
    });

  const mockIsAccessiblePageByViewer = (isAccessible: boolean) => {
    const isAccessiblePageByViewer = vi.fn().mockResolvedValue(isAccessible);
    vi.spyOn(mongoose, 'model').mockReturnValue({
      isAccessiblePageByViewer,
    } as unknown as ReturnType<typeof mongoose.model>);
    return isAccessiblePageByViewer;
  };

  const buildReqResNext = (overrides: {
    user?: HydratedDocument<IUser>;
    isSharedPage?: boolean;
  }) => {
    const req = mock<TestRequest>({
      params: { id: 'attachment1' },
      user: overrides.user,
      isSharedPage: overrides.isSharedPage,
    });
    const res = mock<Response>();
    res.locals = {} as never;
    const next = vi.fn();
    return { req, res, next };
  };

  it('denies a guest (no user, no share link) from downloading a private page attachment', async () => {
    // Arrange: guest request, not via a certified share link, page denies anonymous viewers
    vi.mocked(Attachment.findById).mockResolvedValue(buildAttachment(true));
    const isAccessiblePageByViewer = mockIsAccessiblePageByViewer(false);
    const { req, res, next } = buildReqResNext({
      user: undefined,
      isSharedPage: false,
    });

    // Act
    await retrieveAttachmentFromIdParam(req as never, res as never, next);

    // Assert: the viewer check ran for the guest and the request was rejected
    expect(isAccessiblePageByViewer).toHaveBeenCalledWith(pageId, undefined);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a guest through a certified share link without re-running the page-viewer check', async () => {
    // Arrange: certifySharedPageAttachmentMiddleware already bound this fileId
    // to the share link's page, so no separate viewer check should run.
    vi.mocked(Attachment.findById).mockResolvedValue(buildAttachment(true));
    const isAccessiblePageByViewer = mockIsAccessiblePageByViewer(false);
    const { req, res, next } = buildReqResNext({
      user: undefined,
      isSharedPage: true,
    });

    // Act
    await retrieveAttachmentFromIdParam(req as never, res as never, next);

    // Assert
    expect(isAccessiblePageByViewer).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('denies a logged-in user who is not a viewer of the owning page', async () => {
    vi.mocked(Attachment.findById).mockResolvedValue(buildAttachment(true));
    const isAccessiblePageByViewer = mockIsAccessiblePageByViewer(false);
    const { req, res, next } = buildReqResNext({
      user: mock<HydratedDocument<IUser>>(),
      isSharedPage: false,
    });

    await retrieveAttachmentFromIdParam(req as never, res as never, next);

    expect(isAccessiblePageByViewer).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a viewer who has access to the owning page', async () => {
    vi.mocked(Attachment.findById).mockResolvedValue(buildAttachment(true));
    mockIsAccessiblePageByViewer(true);
    const { req, res, next } = buildReqResNext({
      user: mock<HydratedDocument<IUser>>(),
      isSharedPage: false,
    });

    await retrieveAttachmentFromIdParam(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
    expect(res.locals.attachment).toBeDefined();
  });

  it('skips the viewer check for an attachment with no owning page', async () => {
    vi.mocked(Attachment.findById).mockResolvedValue(buildAttachment(false));
    const modelSpy = vi.spyOn(mongoose, 'model');
    const { req, res, next } = buildReqResNext({
      user: undefined,
      isSharedPage: false,
    });

    await retrieveAttachmentFromIdParam(req as never, res as never, next);

    expect(modelSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
