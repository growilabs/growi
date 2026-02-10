import { SCOPE } from '@growi/core/dist/interfaces';
import type { Request, Router } from 'express';
import express from 'express';
import { query } from 'express-validator';

import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import Activity from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:activity');

const validator = {
  list: [
    query('limit')
      .optional()
      .isInt({ max: 100 })
      .withMessage('limit must be a number less than or equal to 100'),
    query('offset').optional().isInt().withMessage('page must be a number'),
    query('searchFilter')
      .optional()
      .isString()
      .withMessage('query must be a string'),
  ],
};

module.exports = (crowi: Crowi): Router => {
  const adminRequired = adminRequiredFactory(crowi);
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const router = express.Router();

  router.get(
    '/',
    accessTokenParser([SCOPE.READ.ADMIN.AUDIT_LOG], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    validator.list,
    apiV3FormValidator,
    async (req: Request, res: ApiV3Response) => {
      // const auditLogEnabled = configManager.getConfig('app:auditLogEnabled');
      // if (!auditLogEnabled) {
      //   const msg = 'AuditLog is not enabled';
      //   logger.error(msg);
      //   return res.apiv3Err(msg, 405);
      // }
    },
  );

  return router;
};
