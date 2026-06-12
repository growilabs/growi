import type { Router } from 'express';
import express from 'express';

import { SupportedAction } from '~/interfaces/activity.js';
import type { CrowiRequest } from '~/interfaces/crowi-request.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import loggerFactory from '~/utils/logger/index.js';

import type Crowi from '../../crowi/index.js';
import { certifySharedPageAttachmentMiddleware } from '../../middlewares/certify-shared-page-attachment/index.js';
import type { GetRequest, GetResponse } from './get.js';
import { getActionFactory, retrieveAttachmentFromIdParam } from './get.js';

const logger = loggerFactory('growi:routes:attachment:download');

const generateActivityParameters = (req: CrowiRequest) => {
  return {
    ip: req.ip,
    endpoint: req.originalUrl,
    action: SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
    user: req.user?._id,
    snapshot: {
      username: req.user?.username,
    },
  };
};

export const downloadRouterFactory = (crowi: Crowi): Router => {
  const loginRequired = loginRequiredFactory(crowi, true);

  const router = express.Router();

  // note: retrieveAttachmentFromIdParam requires `req.params.id`
  router.get<{ id: string }>(
    '/:id([0-9a-z]{24})',
    certifySharedPageAttachmentMiddleware,
    loginRequired,
    retrieveAttachmentFromIdParam,

    async (req: GetRequest, res: GetResponse) => {
      const { attachment } = res.locals;

      const activityParameters = generateActivityParameters(req);
      const createActivity = async () => {
        await crowi.activityService.createActivity(activityParameters);
      };

      const getAction = getActionFactory(crowi, attachment);
      await getAction(req, res, { download: true });

      createActivity();
    },
  );

  return router;
};
