import * as fs from 'fs';
import path from 'path';

import { getIdStringForRef, type IUser } from '@growi/core';
import { DevidedPagePath } from '@growi/core/dist/models';
// eslint-disable-next-line no-restricted-imports
import axios from 'axios';
import type {
  Request, Response, NextFunction,
} from 'express';
import type { ValidationError } from 'express-validator';
import { param, validationResult } from 'express-validator';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { projectRoot } from '~/server/util/project-dir-utils';
import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import { Attachment } from '../models/attachment';
import type { PageDocument, PageModel } from '../models/page';
import { configManager } from '../service/config-manager';
import { convertStreamToBuffer } from '../util/stream';

const logger = loggerFactory('growi:routes:ogp');

const DEFAULT_USER_IMAGE_URL = '/images/icons/user.svg';
const DEFAULT_USER_IMAGE_PATH = `public${DEFAULT_USER_IMAGE_URL}`;

let bufferedDefaultUserImageCache: Buffer = Buffer.from('');
fs.readFile(path.join(projectRoot, DEFAULT_USER_IMAGE_PATH), (err, buffer) => {
  if (err) throw err;
  bufferedDefaultUserImageCache = buffer;
});


module.exports = function(crowi: Crowi) {

  const isUserImageAttachment = (userImageUrlCached: string): boolean => {
    return /^\/attachment\/.+/.test(userImageUrlCached);
  };

  const getBufferedUserImage = async(userImageUrlCached: string): Promise<Buffer | null> => {

    let bufferedUserImage: Buffer;

    if (isUserImageAttachment(userImageUrlCached)) {
      const { fileUploadService } = crowi;
      const attachment = await Attachment.findById(userImageUrlCached);

      if (attachment == null) {
        return null;
      }

      const fileStream = await fileUploadService.findDeliveryFile(attachment);
      bufferedUserImage = await convertStreamToBuffer(fileStream);
      return bufferedUserImage;
    }

    return (await axios.get(
      userImageUrlCached, {
        responseType: 'arraybuffer',
      },
    )).data;

  };

  const renderOgp = async(req: Request, res: Response) => {

    const ogpUri = configManager.getConfig('app:ogpUri');

    if (ogpUri == null) {
      return res.status(501).send('OGP_URI for growi-unique-ogp has not been setup');
    }

    const page: PageDocument = req.body.page; // asserted by ogpValidator

    const title = (new DevidedPagePath(page.path)).latter;

    let user: IUser | null = null;
    let userName = '(unknown)';
    let userImage: Buffer = bufferedDefaultUserImageCache;

    try {
      if (page.creator != null) {
        const User = mongoose.model<IUser>('User');
        user = await User.findById(getIdStringForRef(page.creator));

        if (user != null) {
          userName = user.username;
          userImage = user.imageUrlCached !== DEFAULT_USER_IMAGE_URL
            ? bufferedDefaultUserImageCache
            : await getBufferedUserImage(user.imageUrlCached) ?? bufferedDefaultUserImageCache;
        }
      }
    }
    catch (err) {
      logger.error(err);
      return res.status(500).send(`error: ${err}`);
    }

    let result;
    try {
      result = await axios.post(
        ogpUri, {
          data: {
            title,
            userName,
            userImage,
          },
        }, {
          responseType: 'stream',
        },
      );
    }
    catch (err) {
      logger.error(err);
      return res.status(500).send(`error: ${err}`);
    }

    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
    });
    result.data.pipe(res);

  };

  const pageIdRequired = param('pageId').not().isEmpty().withMessage('page id is not included in the parameter');

  const ogpValidator = async(req:Request, res:Response, next:NextFunction) => {
    const { aclService, fileUploadService, configManager } = crowi;

    const ogpUri = configManager.getConfig('app:ogpUri');

    if (ogpUri == null) return res.status(400).send('OGP URI for GROWI has not been setup');
    if (!fileUploadService.getIsUploadable()) return res.status(501).send('This GROWI can not upload file');
    if (!aclService.isGuestAllowedToRead()) return res.status(501).send('This GROWI is not public');

    const errors = validationResult(req);

    if (errors.isEmpty()) {

      const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>('Page');

      try {
        const page = await Page.findByIdAndViewer(req.params.pageId, null);

        if (page == null || page.status !== Page.STATUS_PUBLISHED || (page.grant !== Page.GRANT_PUBLIC && page.grant !== Page.GRANT_RESTRICTED)) {
          return res.status(400).send('the page does not exist');
        }

        req.body.page = page;
      }
      catch (error) {
        logger.error(error);
        return res.status(500).send(`error: ${error}`);
      }

      return next();
    }

    // errors.array length is one bacause pageIdRequired is used
    const pageIdRequiredError: ValidationError = errors.array()[0];

    return res.status(400).send(pageIdRequiredError.msg);
  };

  return {
    renderOgp,
    pageIdRequired,
    ogpValidator,
  };

};
