import { ErrorV3 } from '@growi/core/dist/models';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import { format } from 'date-fns/format';
import { subSeconds } from 'date-fns/subSeconds';
import { join } from 'pathe';

import { SupportedAction } from '~/interfaces/activity';
import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import injectResetOrderByTokenMiddleware from '~/server/middlewares/inject-reset-order-by-token-middleware';
import PasswordResetOrder from '~/server/models/password-reset-order';
import { configManager } from '~/server/service/config-manager';
import { growiInfoService } from '~/server/service/growi-info';
import { processPasswordResetRequest } from '~/server/service/password-reset';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import httpErrorHandler from '../../middlewares/http-error-handler';
import { waitUntil } from '../../util/deadline';
import { resolveLocalePath } from '../../util/safe-path-utils';
import { checkForgotPasswordEnabledMiddlewareFactory } from '../forgot-password';

const logger = loggerFactory('growi:routes:apiv3:forgotPassword');

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

/**
 * Every password reset request is answered exactly this long after it was
 * received, whatever the outcome, so the response time does not reveal
 * whether the email is registered. Delivery not finished by then is a failure.
 */
const PASSWORD_RESET_RESPONSE_DELAY_MS = 18 * 1000;

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const { appService, mailService } = crowi;
  const { User } = crowi.models;

  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.events.activity;

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
  const ALLOWED_TEMPLATE_NAMES = ['passwordReset', 'passwordResetSuccessful'];

  async function sendPasswordResetEmail(
    templateFileName,
    locale,
    email,
    url,
    expiredAt,
  ) {
    if (!ALLOWED_TEMPLATE_NAMES.includes(templateFileName)) {
      throw new Error(`Invalid template name: ${templateFileName}`);
    }
    const templatePath = resolveLocalePath(
      locale,
      crowi.localeDir,
      `notifications/${templateFileName}.ejs`,
    );

    return mailService.send({
      to: email,
      subject: '[GROWI] Password Reset',
      template: templatePath,
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
   *          description: >-
   *            Password reset request accepted. Also returned when the email
   *            does not belong to an active account. Always returned 18
   *            seconds after the request was received.
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *        '500':
   *          description: >-
   *            Sending the password reset email failed or did not finish in
   *            time (error code `password-reset-request-failed`). Always
   *            returned 18 seconds after the request was received.
   */
  router.post(
    '/',
    checkPassportStrategyMiddleware,
    validator.email,
    apiV3FormValidator,
    addActivity,
    async (req, res) => {
      const receivedAt = Date.now();
      const respondAt = receivedAt + PASSWORD_RESET_RESPONSE_DELAY_MS;
      const respondWithFailure = () =>
        res.apiv3Err(
          new ErrorV3(
            'Failed to process the password reset request.',
            forgotPasswordErrorCode.PASSWORD_RESET_REQUEST_FAILED,
          ),
          500,
        );

      // Express 4 does not turn a rejected async handler into an error
      // response, so any unexpected error must be handled here; otherwise the
      // request would hang and the client would never see the failure.
      try {
        const { email } = req.body;
        const locale = configManager.getConfig('app:globalLang');
        const appUrl = growiInfoService.getSiteUrl();
        // The activity is absent when add-activity failed to create it; it is
        // only for the audit log, so the reset itself goes on without it.
        const activityId = res.locals.activity?._id;

        const sendPasswordResetMail = async (targetEmail) => {
          const passwordResetOrderData =
            await PasswordResetOrder.createPasswordResetOrder(targetEmail);
          const url = new URL(
            `/forgot-password/${passwordResetOrderData.token}`,
            appUrl,
          );
          const grwTzoffsetSec = crowi.appService.getTzoffset() * 60;
          const expiredAt = subSeconds(
            passwordResetOrderData.expiredAt,
            grwTzoffsetSec,
          );
          const formattedExpiredAt = format(expiredAt, 'yyyy/MM/dd HH:mm');
          await sendPasswordResetEmail(
            'passwordReset',
            locale,
            targetEmail,
            url.href,
            formattedExpiredAt,
          );
        };

        const outcome = await processPasswordResetRequest(
          email,
          {
            isResettableAccount: async (targetEmail) => {
              const user = await User.findOne({ email: { $eq: targetEmail } });
              // Do not send emails to non GROWI user or inactive user
              return user != null && user.status === 2;
            },
            sendPasswordResetMail,
            // No log on success or for unknown/inactive accounts: both must
            // leave the same trace (the access log only). Errors are logged as
            // soon as they occur; only the response is held until the fixed
            // time.
            onMailSent: () => {
              if (activityId == null) {
                return;
              }
              activityEvent.emit('update', activityId, {
                action: SupportedAction.ACTION_USER_FOGOT_PASSWORD,
              });
            },
            onError: (err) => {
              logger.error(
                { err },
                'Error occurred during password reset request procedure.',
              );
            },
            onDeadlineExceeded: () => {
              logger.error(
                `Password reset request was not completed within ${PASSWORD_RESET_RESPONSE_DELAY_MS}ms; responding with a failure.`,
              );
            },
          },
          respondAt,
        );

        if (outcome === 'failed') {
          return respondWithFailure();
        }
        return res.apiv3();
      } catch (err) {
        logger.error(
          { err },
          'Unexpected error occurred during password reset request procedure.',
        );
        await waitUntil(respondAt);
        return respondWithFailure();
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
