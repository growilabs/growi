import { ErrorV3 } from '@growi/core/dist/models';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import { format, subSeconds } from 'date-fns';

import { SupportedAction } from '~/interfaces/activity';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import injectResetOrderByTokenMiddleware from '~/server/middlewares/inject-reset-order-by-token-middleware';
import PasswordResetOrder from '~/server/models/password-reset-order';
import { configManager } from '~/server/service/config-manager';
import { growiInfoService } from '~/server/service/growi-info';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import httpErrorHandler from '../../middlewares/http-error-handler';
import { checkForgotPasswordEnabledMiddlewareFactory } from '../forgot-password';

const logger = loggerFactory('growi:routes:apiv3:forgotPassword'); // eslint-disable-line no-unused-vars

const express = require('express');
const { body } = require('express-validator');

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     PasswordResetRequest:
 *       type: object
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *     PasswordResetResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         error:
 *           type: string
 */

const router = express.Router();

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const { appService, mailService } = crowi;
  const User = crowi.model('User');
  const path = require('path');

  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.event('activity');

  const minPasswordLength = configManager.getConfig('app:minPasswordLength');

  const validator = {
    password: [
      body('newPassword')
        .isString()
        .not()
        .isEmpty()
        .isLength({ min: minPasswordLength })
        .withMessage(
          `password must be at least ${minPasswordLength} characters long`,
        ),
      // checking if password confirmation matches password
      body('newPasswordConfirm')
        .isString()
        .not()
        .isEmpty()
        .custom((value, { req }) => {
          return value === req.body.newPassword;
        }),
    ],
    email: [
      body('email')
        .isEmail()
        .escape()
        .withMessage('message.Email format is invalid')
        .notEmpty()
        .withMessage('message.Email field is required'),
    ],
  };

  const checkPassportStrategyMiddleware =
    checkForgotPasswordEnabledMiddlewareFactory(crowi, true);

  async function sendPasswordResetEmail(
    templateFileName,
    locale,
    email,
    url,
    expiredAt,
  ) {
    return mailService.send({
      to: email,
      subject: '[GROWI] Password Reset',
      template: path.join(
        crowi.localeDir,
        `${locale}/notifications/${templateFileName}.ejs`,
      ),
      vars: {
        appTitle: appService.getAppTitle(),
        email,
        url,
        expiredAt,
      },
    });
  }

  /**
   * @swagger
   *
   *  /forgot-password:
   *    post:
   *      summary: Request password reset
   *      tags: [Users]
   *      security:
   *        - cookieAuth: []
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              type: object
   *              properties:
   *                email:
   *                  type: string
   *                  format: email
   *                  description: Email address of the user requesting password reset
   *      responses:
   *        '200':
   *          description: Password reset request processed
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   */
  router.post(
    '/',
    checkPassportStrategyMiddleware,
    validator.email,
    apiV3FormValidator,
    addActivity,
    async (req, res) => {
      const { email } = req.body;
      const locale = configManager.getConfig('app:globalLang');
      const appUrl = growiInfoService.getSiteUrl();

      try {
        const user = await User.findOne({ email });

        // when the user is not found or active
        if (user == null || user.status !== 2) {
          // Do not send emails to non GROWI user
          // For security reason, do not use error messages like "Email does not exist"
          return res.apiv3();
        }

        const passwordResetOrderData =
          await PasswordResetOrder.createPasswordResetOrder(email);
        const url = new URL(
          `/forgot-password/${passwordResetOrderData.token}`,
          appUrl,
        );
        const oneTimeUrl = url.href;
        const grwTzoffsetSec = crowi.appService.getTzoffset() * 60;
        const expiredAt = subSeconds(
          passwordResetOrderData.expiredAt,
          grwTzoffsetSec,
        );
        const formattedExpiredAt = format(expiredAt, 'yyyy/MM/dd HH:mm');
        await sendPasswordResetEmail(
          'passwordReset',
          locale,
          email,
          oneTimeUrl,
          formattedExpiredAt,
        );

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_USER_FOGOT_PASSWORD,
        });

        return res.apiv3();
      } catch (err) {
        const msg = 'Error occurred during password reset request procedure.';
        logger.error(err);
        return res.apiv3Err(`${msg} Cause: ${err}`);
      }
    },
  );

  /**
   * @swagger
   *
   *  /forgot-password:
   *    put:
   *      summary: Reset password
   *      tags: [Users]
   *      security:
   *        - cookieAuth: []
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              type: object
   *              properties:
   *                newPassword:
   *                  type: string
   *                  format: password
   *                  description: New password
   *      responses:
   *        '200':
   *          description: Password reset successful
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  userData:
   *                    $ref: '#/components/schemas/User'
   */
  // eslint-disable-next-line max-len
  router.put(
    '/',
    checkPassportStrategyMiddleware,
    injectResetOrderByTokenMiddleware,
    validator.password,
    apiV3FormValidator,
    addActivity,
    async (req, res) => {
      const { passwordResetOrder } = req;
      const { email } = passwordResetOrder;
      const grobalLang = configManager.getConfig('app:globalLang');
      const i18n = grobalLang || req.language;
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

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_USER_RESET_PASSWORD,
        });

        return res.apiv3({ userData: serializedUserData });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err('update-password-failed');
      }
    },
  );

  // middleware to handle error
  router.use(httpErrorHandler);
  router.use((error, req, res, next) => {
    if (error != null) {
      return res.apiv3Err(new ErrorV3(error.message, error.code));
    }
    next();
  });

  return router;
};
