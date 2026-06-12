import { SCOPE } from '@growi/core/dist/interfaces';
import type { Response, Router } from 'express';
import express from 'express';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi/index.js';
import { AttachmentType } from '../../interfaces/attachment.js';
import { generateCertifyBrandLogoMiddleware } from '../../middlewares/certify-brand-logo.js';
import { Attachment } from '../../models/attachment.js';
import ApiResponse from '../../util/apiResponse.js';
import { getActionFactory } from './get.js';

const logger = loggerFactory('growi:routes:attachment:get-brand-logo');

export const getBrandLogoRouterFactory = (crowi: Crowi): Router => {
  const certifyBrandLogo = generateCertifyBrandLogoMiddleware(crowi);
  const loginRequired = loginRequiredFactory(crowi, true);

  const router = express.Router();

  router.get(
    '/brand-logo',
    certifyBrandLogo,
    accessTokenParser([SCOPE.READ.FEATURES.ATTACHMENT]),
    loginRequired,
    async (req: CrowiRequest, res: Response) => {
      const brandLogoAttachment = await Attachment.findOne({
        attachmentType: AttachmentType.BRAND_LOGO,
      });

      if (brandLogoAttachment == null) {
        return res
          .status(404)
          .json(ApiResponse.error('Brand logo does not exist'));
      }

      const getAction = getActionFactory(crowi, brandLogoAttachment);
      getAction(req, res);
    },
  );

  return router;
};
