import rateLimit from 'express-rate-limit';

import PasswordResetOrder from '~/server/models/password-reset-order';
import ErrorV3 from '~/server/models/vo/error-apiv3';
import injectResetOrderByTokenMiddleware from '~/server/middlewares/inject-reset-order-by-token-middleware';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:forgotPassword'); // eslint-disable-line no-unused-vars

const express = require('express');
const { body } = require('express-validator');
const { serializeUserSecurely } = require('../../models/serializers/user-serializer');

const router = express.Router();

module.exports = (crowi) => {
  const { appService, mailService, configManager } = crowi;
  const User = crowi.model('User');
  const path = require('path');
  const csrf = require('../../middlewares/csrf')(crowi);
  const apiV3FormValidator = require('../../middlewares/apiv3-form-validator')(crowi);

  const validator = {
    password: [
      body('newPassword').isString().not().isEmpty()
        .isLength({ min: 6 })
        .withMessage('password must be at least 6 characters long'),
      // checking if password confirmation matches password
      body('newPasswordConfirm').isString().not().isEmpty()
        .custom((value, { req }) => {
          return (value === req.body.newPassword);
        }),
    ],
  };

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message:
      'Too many requests were sent from this IP. Please try a password reset request again on the password reset request form',
  });

  async function sendPasswordResetEmail(txtFileName, i18n, email, url) {
    return mailService.send({
      to: email,
      subject: txtFileName,
      template: path.join(crowi.localeDir, `${i18n}/notifications/${txtFileName}.txt`),
      vars: {
        appTitle: appService.getAppTitle(),
        email,
        url,
      },
    });
  }

  router.post('/', async(req, res) => {
    const { email } = req.body;
    const grobalLang = configManager.getConfig('crowi', 'app:globalLang');
    const i18n = req.language || grobalLang;
    const appUrl = appService.getSiteUrl();

    try {
      const user = await User.findOne({ email });

      // when the user is not found or active
      if (user == null || user.status !== 2) {
        await sendPasswordResetEmail('notActiveUser', i18n, email, appUrl);
        return res.apiv3();
      }

      const passwordResetOrderData = await PasswordResetOrder.createPasswordResetOrder(email);
      const url = new URL(`/forgot-password/${passwordResetOrderData.token}`, appUrl);
      const oneTimeUrl = url.href;
      await sendPasswordResetEmail('passwordReset', i18n, email, oneTimeUrl);
      return res.apiv3();
    }
    catch (err) {
      const msg = 'Error occurred during password reset request procedure.';
      logger.error(err);
      return res.apiv3Err(`${msg} Cause: ${err}`);
    }
  });

  router.put('/', injectResetOrderByTokenMiddleware, async(req, res) => {
    const { passwordResetOrder } = req;
    const { email } = passwordResetOrder;
    const grobalLang = configManager.getConfig('crowi', 'app:globalLang');
    const i18n = req.language || grobalLang;
    const { newPassword } = req.body;

    const user = await User.findOne({ email });

    // when the user is not found or active
    if (user == null || user.status !== 2) {
      return res.apiv3Err('update-password-failed');
    }

    try {
      const userData = await user.updatePassword(newPassword);
      const serializedUserData = serializeUserSecurely(userData);
      passwordResetOrder.revokeOneTimeToken();
      await sendPasswordResetEmail('passwordResetSuccessful', i18n, email);
      return res.apiv3({ userData: serializedUserData });
    }
    catch (err) {
      logger.error(err);
      return res.apiv3Err('update-password-failed');
    }
  });

  // middleware to handle error
  router.use((error, req, res, next) => {
    if (error != null) {
      return res.apiv3Err(new ErrorV3(error.message, error.code));
    }
    next();
  });

  return router;
};
