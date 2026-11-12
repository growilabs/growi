import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type { AclService } from '~/server/service/acl';
import type { ConfigManager } from '~/server/service/config-manager/config-manager';
import type { FileUploader } from '~/server/service/file-uploader';

import type Crowi from '../crowi';
import type { PageModel } from '../models/page';
import { setup } from './ogp';

// Keep express-validator's `param` real (setup() builds the validator chain with
// it); only stub validationResult so the handler enters its page-lookup branch
// without running the full validation middleware here.
vi.mock('express-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('express-validator')>();
  return {
    ...actual,
    validationResult: vi.fn(() => ({ isEmpty: () => true, array: () => [] })),
  };
});

describe('ogpValidator', () => {
  // Markup an attacker could get into the thrown error's text: a malformed
  // pageId reaches Mongoose ObjectId casting, whose CastError echoes the raw value.
  const XSS_MARKER = '<script>alert(1)</script>';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildCrowi = (): Crowi => {
    const configManager = mock<ConfigManager>();
    configManager.getConfig.mockReturnValue('http://ogp.example');
    const fileUploadService = mock<FileUploader>();
    fileUploadService.getIsUploadable.mockReturnValue(true);
    const aclService = mock<AclService>();
    aclService.isGuestAllowedToRead.mockReturnValue(true);
    return mock<Crowi>({ configManager, fileUploadService, aclService });
  };

  it('does not reflect the thrown error text into the 500 response body', async () => {
    // Arrange: the page lookup throws an error whose message contains markup.
    const pageModel = mock<PageModel>();
    pageModel.findByIdAndViewer.mockRejectedValue(new Error(XSS_MARKER));
    // mongoose.model() is heavily overloaded; a localized cast is needed to
    // return our typed PageModel mock from the spy.
    vi.spyOn(mongoose, 'model').mockReturnValue(
      pageModel as unknown as ReturnType<typeof mongoose.model>,
    );

    const req = mock<Request>({ params: { pageId: XSS_MARKER }, body: {} });
    const res = mock<Response>();
    // res.status(...) returns `this` (Response) in Express; mirror that so the
    // chained .send() can be asserted.
    res.status.mockReturnValue(res);
    const next = vi.fn();

    // Act
    const { ogpValidator } = setup(buildCrowi());
    await ogpValidator(req, res, next);

    // Assert: it still fails with 500, but the body must not echo the error.
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalled();
    const sentBody = String(res.send.mock.calls.at(-1)?.[0]);
    expect(sentBody).not.toContain('<script>');
    expect(sentBody).not.toContain(XSS_MARKER);
    expect(next).not.toHaveBeenCalled();
  });
});
