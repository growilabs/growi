import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';

import type { CrowiProperties, CrowiRequest } from '~/interfaces/crowi-request';
import {
  type ExpressHttpHeader,
  type RespondOptions,
  ResponseMode,
} from '~/server/interfaces/attachment';
import loginRequiredFactory from '~/server/middlewares/login-required';
import {
  applyHeaders,
  createContentHeaders,
  type FileUploader,
  toExpressHttpHeaders,
} from '~/server/service/file-uploader';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import {
  certifySharedPageAttachmentMiddleware,
  type RequestToAllowShareLink,
} from '../../middlewares/certify-shared-page-attachment';
import type { IAttachmentDocument } from '../../models/attachment';
import { resolveAccessibleAttachment } from '../../service/attachment/resolve-accessible-attachment';
import ApiResponse from '../../util/apiResponse';

const logger = loggerFactory('growi:routes:attachment:get');

type LocalsAfterDataInjection = { attachment: IAttachmentDocument };

type RetrieveAttachmentFromIdParamRequest = CrowiProperties &
  RequestToAllowShareLink &
  Request<{ id: string }, any, any, any, LocalsAfterDataInjection>;

type RetrieveAttachmentFromIdParamResponse = Response<
  any,
  LocalsAfterDataInjection
>;

export const retrieveAttachmentFromIdParam = async (
  req: RetrieveAttachmentFromIdParamRequest,
  res: RetrieveAttachmentFromIdParamResponse,
  next: NextFunction,
): Promise<void> => {
  const id = req.params.id;

  // Skip the viewer check only when the request is already certified via a
  // valid share link: certifySharedPageAttachmentMiddleware binds the fileId
  // to that share link's page (see validateAttachment), so re-running the
  // viewer check here would incorrectly reject a non-member share-link viewer.
  const result = await resolveAccessibleAttachment(
    id,
    req.user,
    req.isSharedPage ?? false,
  );

  if ('errorCode' in result) {
    const message =
      result.errorCode === 'not_found'
        ? 'attachment not found'
        : `Forbidden to access to the attachment '${id}'. This attachment might belong to other pages.`;
    res.json(ApiResponse.error(message));
    return;
  }

  res.locals.attachment = result.attachment;

  return next();
};

export const generateHeadersForFresh = (
  attachment: IAttachmentDocument,
): ExpressHttpHeader[] => {
  return toExpressHttpHeaders({
    ETag: `Attachment-${attachment._id}`,
    'Last-Modified': attachment.createdAt.toUTCString(),
  });
};

const respondForRedirectMode = async (
  res: Response,
  fileUploadService: FileUploader,
  attachment: IAttachmentDocument,
  opts?: RespondOptions,
): Promise<void> => {
  const isDownload = opts?.download ?? false;

  if (!isDownload) {
    const temporaryUrl = attachment.getValidTemporaryUrl();
    if (temporaryUrl != null) {
      res.redirect(temporaryUrl);
      return;
    }
  }

  const temporaryUrl = await fileUploadService.generateTemporaryUrl(
    attachment,
    opts,
  );

  res.redirect(temporaryUrl.url);

  // persist temporaryUrl
  if (!isDownload) {
    try {
      attachment.cashTemporaryUrlByProvideSec(
        temporaryUrl.url,
        temporaryUrl.lifetimeSec,
      );
      return;
    } catch (err) {
      logger.error(err);
    }
  }
};

const respondForRelayMode = async (
  res: Response,
  fileUploadService: FileUploader,
  attachment: IAttachmentDocument,
  opts?: RespondOptions,
): Promise<void> => {
  // apply content-* headers before response
  const isDownload = opts?.download ?? false;
  const contentHeaders = createContentHeaders(attachment, {
    forceAttachment: isDownload,
  });
  applyHeaders(res, contentHeaders);

  try {
    const readable = await fileUploadService.findDeliveryFile(attachment);
    readable.pipe(res);
  } catch (e) {
    logger.error(e);
    res.json(ApiResponse.error(e.message));
    return;
  }
};

export const getActionFactory = (
  crowi: Crowi,
  attachment: IAttachmentDocument,
) => {
  return async (
    req: CrowiRequest,
    res: Response,
    opts?: RespondOptions,
  ): Promise<void> => {
    // add headers before evaluating 'req.fresh'
    applyHeaders(res, generateHeadersForFresh(attachment));

    // return 304 if request is "fresh"
    // see: http://expressjs.com/en/5x/api.html#req.fresh
    if (req.fresh) {
      res.sendStatus(304);
      return;
    }

    const { fileUploadService } = crowi;

    const responseMode = fileUploadService.determineResponseMode();
    switch (responseMode) {
      case ResponseMode.DELEGATE:
        fileUploadService.respond(res, attachment, opts);
        return;
      case ResponseMode.REDIRECT:
        respondForRedirectMode(res, fileUploadService, attachment, opts);
        return;
      case ResponseMode.RELAY:
        respondForRelayMode(res, fileUploadService, attachment, opts);
        return;
    }
  };
};

export type GetRequest = CrowiProperties &
  Request<{ id: string }, any, any, any, LocalsAfterDataInjection>;

export type GetResponse = Response<any, LocalsAfterDataInjection>;

export const getRouterFactory = (crowi: Crowi): Router => {
  const loginRequired = loginRequiredFactory(crowi, true);

  const router = express.Router();

  // note: retrieveAttachmentFromIdParam requires `req.params.id`
  router.get<{ id: string }>(
    '/:id([0-9a-z]{24})',
    certifySharedPageAttachmentMiddleware,
    loginRequired,
    retrieveAttachmentFromIdParam,

    (req: GetRequest, res: GetResponse) => {
      const { attachment } = res.locals;
      const getAction = getActionFactory(crowi, attachment);
      getAction(req, res);
    },
  );

  return router;
};
