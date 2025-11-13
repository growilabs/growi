import { ErrorV3 } from '@growi/core/dist/models';
import { body } from 'express-validator';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const express = require('express');

const router = express.Router();

const logger = loggerFactory('growi:routes:apiv3:inline-mime-mode');

const validator = {
  updateInlineMimeMode: [
    body('mode')
      .exists()
      .isIn(['strict', 'lax'])
      .withMessage('`mode` must be one of "strict" or "lax"'),
  ],
};

module.exports = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);
  const adminRequired = require('~/server/middlewares/admin-required')(crowi);
  const { apiV3FormValidator } = require('~/server/middlewares/apiv3-form-validator');


  router.get('/', loginRequiredStrictly, adminRequired, async(req, res) => {
    try {
      const mode = configManager.getConfig('markdown:inlineMimeMode');
      return res.apiv3({ inlineMimeMode: mode });
    }
    catch (err) {
      logger.error('Failed to get inlineMimeMode:', err);
      return res.apiv3Err(new ErrorV3('Failed to get inlineMimeMode', 'get-inline-mime-mode-failed'));
    }
  });


  router.put('/', loginRequiredStrictly, adminRequired, validator.updateInlineMimeMode, apiV3FormValidator, async(req, res) => {
    const { mode } = req.body;

    try {
      await configManager.updateConfigs({ 'markdown:inlineMimeMode': mode });

      return res.apiv3({ inlineMimeMode: mode });
    }
    catch (err) {
      logger.error('Failed to update inlineMimeMode:', err);
      return res.apiv3Err(new ErrorV3('Failed to update inlineMimeMode', 'update-inline-mime-mode-failed'));
    }
  });

  return router;
};
