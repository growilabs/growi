import {
  getIdStringForRef, type IPage, type IUser,
} from '@growi/core';
import express from 'express';
import type {
  NextFunction, Request, Response, Router,
} from 'express';
import mongoose from 'mongoose';

import type { CrowiProperties, CrowiRequest } from '~/interfaces/crowi-request';
import { ResponseMode, type ExpressHttpHeader, type RespondOptions } from '~/server/interfaces/attachment';
import {
  type FileUploader,
  toExpressHttpHeaders, ContentHeaders, applyHeaders,
} from '~/server/service/file-uploader';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { certifySharedPageAttachmentMiddleware } from '../../middlewares/certify-shared-page-attachment';
import { Attachment, type IAttachmentDocument } from '../../models/attachment';
import ApiResponse from '../../util/apiResponse';


const logger = loggerFactory('growi:routes:attachment:get');


// TODO: remove this local interface when models/page has typescriptized
interface PageModel {
  isAccessiblePageByViewer: (pageId: string, user: IUser | undefined) => Promise<boolean>
}

type LocalsAfterDataInjection = { attachment: IAttachmentDocument };

type RetrieveAttachmentFromIdParamRequest = CrowiProperties & Request<
  { id: string },
  any, any, any,
  LocalsAfterDataInjection
>;

type RetrieveAttachmentFromIdParamResponse = Response<
  any,
  LocalsAfterDataInjection
>;

export const retrieveAttachmentFromIdParam = async(
    req: RetrieveAttachmentFromIdParamRequest, res: RetrieveAttachmentFromIdParamResponse, next: NextFunction,
): Promise<void> => {

  const id = req.params.id;
  const attachment = await Attachment.findById(id);

  if (attachment == null) {
    res.json(ApiResponse.error('attachment not found'));
    return;
  }

  const user = req.user;

  // check viewer has permission
  if (user != null && attachment.page != null) {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const isAccessible = await Page.isAccessiblePageByViewer(getIdStringForRef(attachment.page), user);
    if (!isAccessible) {
      res.json(ApiResponse.error(`Forbidden to access to the attachment '${attachment.id}'. This attachment might belong to other pages.`));
      return;
    }
  }

  res.locals.attachment = attachment;

  return next();
};


export const generateHeadersForFresh = (attachment: IAttachmentDocument): ExpressHttpHeader[] => {
  return toExpressHttpHeaders({
    ETag: `Attachment-${attachment._id}`,
    'Last-Modified': attachment.createdAt.toUTCString(),
  });
};


const respondForRedirectMode = async(res: Response, fileUploadService: FileUploader, attachment: IAttachmentDocument, opts?: RespondOptions): Promise<void> => {
  const isDownload = opts?.download ?? false;

  if (!isDownload) {
    const temporaryUrl = attachment.getValidTemporaryUrl();
    if (temporaryUrl != null) {
      res.redirect(temporaryUrl);
      return;
    }
  }

  const temporaryUrl = await fileUploadService.generateTemporaryUrl(attachment, opts);

  res.redirect(temporaryUrl.url);

  // persist temporaryUrl
  if (!isDownload) {
    try {
      attachment.cashTemporaryUrlByProvideSec(temporaryUrl.url, temporaryUrl.lifetimeSec);
      return;
    }
    catch (err) {
      logger.error(err);
    }
  }
};

const respondForRelayMode = async(res: Response, fileUploadService: FileUploader, attachment: IAttachmentDocument, opts?: RespondOptions): Promise<void> => {
  // apply content-* headers before response
  const isDownload = opts?.download ?? false;
  const contentHeaders = new ContentHeaders(attachment, { inline: !isDownload });
  applyHeaders(res, contentHeaders.toExpressHttpHeaders());

  try {
    const readable = await fileUploadService.findDeliveryFile(attachment);
    readable.pipe(res);
  }
  catch (e) {
    logger.error(e);
    res.json(ApiResponse.error(e.message));
    return;
  }
};

export const getActionFactory = (crowi: Crowi, attachment: IAttachmentDocument) => {
  return async(req: CrowiRequest, res: Response, opts?: RespondOptions): Promise<void> => {

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


export type GetRequest = CrowiProperties & Request<
  { id: string },
  any, any, any,
  LocalsAfterDataInjection
>;

export type GetResponse = Response<
  any,
  LocalsAfterDataInjection
>

export const getRouterFactory = (crowi: Crowi): Router => {

  const loginRequired = require('../../middlewares/login-required')(crowi, true);

  const router = express.Router();

  // note: retrieveAttachmentFromIdParam requires `req.params.id`
  router.get<{ id: string }>('/:id([0-9a-z]{24})',
    certifySharedPageAttachmentMiddleware,
    loginRequired,
    retrieveAttachmentFromIdParam,

    (req: GetRequest, res: GetResponse) => {
      const { attachment } = res.locals;
      const getAction = getActionFactory(crowi, attachment);
      getAction(req, res);
    });

  return router;
};
