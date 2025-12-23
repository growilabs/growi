import type { Response } from 'express';
import { mock } from 'vitest-mock-extended';

import type { ShareLinkDocument } from '~/server/models/share-link';

import {
  certifySharedPageAttachmentMiddleware,
  type RequestToAllowShareLink,
} from './certify-shared-page-attachment';
import type { ValidReferer } from './interfaces';

const mocks = vi.hoisted(() => {
  return {
    validateRefererMock: vi.fn(),
    retrieveValidShareLinkByRefererMock: vi.fn(),
    validateAttachmentMock: vi.fn(),
  };
});

vi.mock('./validate-referer', () => ({
  validateReferer: mocks.validateRefererMock,
}));
vi.mock('./retrieve-valid-share-link', () => ({
  retrieveValidShareLinkByReferer: mocks.retrieveValidShareLinkByRefererMock,
}));
vi.mock('./validate-attachment', () => ({
  validateAttachment: mocks.validateAttachmentMock,
}));

describe('certifySharedPageAttachmentMiddleware', () => {
  const res = mock<Response>();
  const next = vi.fn();

  describe('should called next() without req.isSharedPage set', () => {
    it('when the fileId param is null', async () => {
      // setup
      const req = mock<RequestToAllowShareLink>();
      req.params = {}; // id: undefined
      req.headers = {};

      // when
      await certifySharedPageAttachmentMiddleware(req, res, next);

      // then
      expect(mocks.validateRefererMock).not.toHaveBeenCalled();
      expect(req.isSharedPage === true).toBeFalsy();
      expect(next).toHaveBeenCalledOnce();
    });

    it('when validateReferer returns null', async () => {
      // setup
      const req = mock<RequestToAllowShareLink>();
      req.params = { id: 'file id string' };
      req.headers = { referer: 'referer string' };

      // when
      await certifySharedPageAttachmentMiddleware(req, res, next);

      // then
      expect(mocks.validateRefererMock).toHaveBeenCalledOnce();
      expect(mocks.validateRefererMock).toHaveBeenCalledWith('referer string');
      expect(req.isSharedPage === true).toBeFalsy();
      expect(next).toHaveBeenCalledOnce();
    });

    it('when retrieveValidShareLinkByReferer returns null', async () => {
      // setup
      const req = mock<RequestToAllowShareLink>();
      req.params = { id: 'file id string' };
      req.headers = { referer: 'referer string' };

      const validReferer: ValidReferer = {
        referer: 'referer string',
        shareLinkId: 'ffffffffffffffffffffffff',
      };
      mocks.validateRefererMock.mockImplementation(() => validReferer);

      mocks.retrieveValidShareLinkByRefererMock.mockResolvedValue(null);

      // when
      await certifySharedPageAttachmentMiddleware(req, res, next);

      // then
      expect(mocks.validateRefererMock).toHaveBeenCalledOnce();
      expect(mocks.validateRefererMock).toHaveBeenCalledWith('referer string');
      expect(mocks.retrieveValidShareLinkByRefererMock).toHaveBeenCalledOnce();
      expect(mocks.retrieveValidShareLinkByRefererMock).toHaveBeenCalledWith(
        validReferer,
      );
      expect(req.isSharedPage === true).toBeFalsy();
      expect(next).toHaveBeenCalledOnce();
    });

    it('when validateAttachment returns false', async () => {
      // setup
      const req = mock<RequestToAllowShareLink>();
      req.params = { id: 'file id string' };
      req.headers = { referer: 'referer string' };

      const validReferer = vi.fn();
      mocks.validateRefererMock.mockImplementation(() => validReferer);

      const shareLinkMock = mock<ShareLinkDocument>();
      mocks.retrieveValidShareLinkByRefererMock.mockResolvedValue(
        shareLinkMock,
      );

      mocks.validateAttachmentMock.mockResolvedValue(false);

      // when
      await certifySharedPageAttachmentMiddleware(req, res, next);

      // then
      expect(mocks.validateRefererMock).toHaveBeenCalledOnce();
      expect(mocks.validateRefererMock).toHaveBeenCalledWith('referer string');
      expect(mocks.retrieveValidShareLinkByRefererMock).toHaveBeenCalledOnce();
      expect(mocks.retrieveValidShareLinkByRefererMock).toHaveBeenCalledWith(
        validReferer,
      );
      expect(mocks.validateAttachmentMock).toHaveBeenCalledOnce();
      expect(mocks.validateAttachmentMock).toHaveBeenCalledWith(
        'file id string',
        shareLinkMock,
      );
      expect(req.isSharedPage === true).toBeFalsy();
      expect(next).toHaveBeenCalledOnce();
    });
  });

  it('should set req.isSharedPage true', async () => {
    // setup
    const req = mock<RequestToAllowShareLink>();
    req.params = { id: 'file id string' };
    req.headers = { referer: 'referer string' };

    const validReferer = vi.fn();
    mocks.validateRefererMock.mockImplementation(() => validReferer);

    const shareLinkMock = mock<ShareLinkDocument>();
    mocks.retrieveValidShareLinkByRefererMock.mockResolvedValue(shareLinkMock);

    mocks.validateAttachmentMock.mockResolvedValue(true);

    // when
    await certifySharedPageAttachmentMiddleware(req, res, next);

    // then
    expect(mocks.validateRefererMock).toHaveBeenCalledOnce();
    expect(mocks.validateRefererMock).toHaveBeenCalledWith('referer string');
    expect(mocks.retrieveValidShareLinkByRefererMock).toHaveBeenCalledOnce();
    expect(mocks.retrieveValidShareLinkByRefererMock).toHaveBeenCalledWith(
      validReferer,
    );
    expect(mocks.validateAttachmentMock).toHaveBeenCalledOnce();
    expect(mocks.validateAttachmentMock).toHaveBeenCalledWith(
      'file id string',
      shareLinkMock,
    );

    expect(req.isSharedPage === true).toBeTruthy();

    expect(next).toHaveBeenCalledOnce();
  });
});
